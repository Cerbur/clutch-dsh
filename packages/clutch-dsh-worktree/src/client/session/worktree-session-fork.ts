import { worktreeNotifications } from '../surface/notification-center.js';
import { toWorktreeViewError, type ReportId, type WorktreeViewError } from '../view/worktree-view-errors.js';
import type { SessionBinding } from '../../contract/index.js';

/** The public options accepted by the native DSH Session fork service. */
export interface WorktreeForkInput {
  readonly sessionId: string;
  readonly atSeq?: number;
  readonly increaseTitle?: boolean;
}

/** The lineage facts exposed by DSH's browser Session list. */
export interface WorktreeForkSessionSummary {
  readonly blank?: boolean;
  readonly parentId?: string;
  readonly origin?: string;
}

export interface WorktreeForkSessionListSnapshot {
  readonly phase?: 'pending' | 'ready';
  readonly ids: readonly string[];
  readonly byId: Readonly<Record<string, WorktreeForkSessionSummary | undefined>>;
}

export interface WorktreeForkSessionListReader {
  getSnapshot(): WorktreeForkSessionListSnapshot;
}

export interface WorktreeForkRecovery {
  readonly reportId: ReportId;
  readonly key: string;
  readonly sourceSessionId: string;
  readonly childSessionId: string;
  /** The child was already listed when the Client started, and no user action requested this bind. */
  readonly historical: boolean;
  readonly binding?: SessionBinding;
  readonly error: unknown;
}

export function forkRecoveryError(recovery: Pick<WorktreeForkRecovery, 'error' | 'childSessionId'>): WorktreeViewError {
  const error = toWorktreeViewError(recovery.error);
  return {
    ...error,
    message: typeof recovery.error === 'object' && recovery.error !== null ? error.message : String(recovery.error),
    code: error.code === 'WORKTREE_VIEW_FAILED' ? 'SESSION_BINDING_FAILED' : error.code,
    details: { ...error.details, sessionId: recovery.childSessionId },
  };
}

export interface WorktreeForkRecoverySnapshot {
  readonly revision: number;
  readonly pending: readonly WorktreeForkRecovery[];
  readonly affectedWorkspaceIds: readonly string[];
}

export interface WorktreeForkRecoveryStore {
  getSnapshot(): WorktreeForkRecoverySnapshot;
  subscribe(listener: () => void): () => void;
}

export type WorktreeForkBindingLookupResult =
  | { readonly status: 'found'; readonly binding: SessionBinding }
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly error: unknown };

export interface WorktreeForkBindingIndex {
  readonly bySessionId: ReadonlyMap<string, WorktreeForkBindingLookupResult>;
}

export interface WorktreeForkCoordinatorOptions {
  /** The unwrapped DSH fork method. */
  readonly fork: (input: WorktreeForkInput) => Promise<string>;
  /** Find active sidecar bindings across all native Workspaces. */
  readonly findBindings: (sessionIds: readonly string[]) => Promise<WorktreeForkBindingIndex>;
  /** Existing Worktree sidecar mutation; it remains the only binding writer. */
  readonly bindSession: (input: {
    workspaceId: string;
    worktreeId: string;
    sessionId: string;
  }) => Promise<unknown>;
  readonly sessions?: WorktreeForkSessionListReader;
  /** Called after a child binding has been committed and before the view refresh. */
  readonly onBound?: (binding: SessionBinding) => void;
}

export interface ForgottenWorktree {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionIds: readonly string[];
}

export interface WorktreeForkCoordinator {
  readonly recovery: WorktreeForkRecoveryStore;
  fork(input: WorktreeForkInput): Promise<string>;
  reconcile(options?: { readonly force?: boolean }): Promise<void>;
  retry(key: string): Promise<boolean>;
  forgetWorktree(input: ForgottenWorktree): void;
  dispose(): void;
}

interface BindingAttempt {
  readonly bound: boolean;
}

interface ReconciliationSnapshot {
  readonly signature: string;
  readonly candidates: readonly {
    readonly childSessionId: string;
    readonly sourceSessionId: string;
  }[];
}

function reconciliationSnapshot(
  snapshot: WorktreeForkSessionListSnapshot,
): ReconciliationSnapshot | undefined {
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    snapshot.phase === 'pending' ||
    (snapshot.phase !== undefined && snapshot.phase !== 'ready') ||
    !Array.isArray(snapshot.ids) ||
    typeof snapshot.byId !== 'object' ||
    snapshot.byId === null ||
    Array.isArray(snapshot.byId)
  ) {
    return undefined;
  }

  for (const sessionId of snapshot.ids) {
    if (typeof sessionId !== 'string') return undefined;
    const summary = snapshot.byId[sessionId];
    if (
      summary !== undefined &&
      (typeof summary !== 'object' || summary === null || Array.isArray(summary))
    ) {
      return undefined;
    }
    const parentId = summary?.parentId;
    const origin = summary?.origin;
    const blank = summary?.blank;
    if (
      (parentId !== undefined && typeof parentId !== 'string') ||
      (origin !== undefined && typeof origin !== 'string') ||
      (blank !== undefined && typeof blank !== 'boolean')
    ) {
      return undefined;
    }
  }

  const candidates = snapshot.ids.flatMap((childSessionId) => {
    const summary = snapshot.byId[childSessionId];
    if (
      summary?.parentId === undefined ||
      summary.parentId === childSessionId ||
      summary.blank === true ||
      summary.origin === 'subagent' ||
      snapshot.byId[summary.parentId] === undefined
    ) {
      return [];
    }
    return [{ childSessionId, sourceSessionId: summary.parentId }];
  });
  const candidateFacts = candidates
    .map(({ childSessionId, sourceSessionId }) => [childSessionId, sourceSessionId] as const)
    .sort(([leftChild, leftSource], [rightChild, rightSource]) =>
      leftChild < rightChild || (leftChild === rightChild && leftSource < rightSource)
        ? -1
        : leftChild === rightChild && leftSource === rightSource
          ? 0
          : 1,
    );

  return {
    // Ordinary Session notifications must not invalidate persisted Fork candidates.
    signature: JSON.stringify([snapshot.phase ?? 'ready', candidateFacts]),
    candidates,
  };
}

function recoveryKey(sourceSessionId: string, childSessionId: string): string {
  return `${sourceSessionId}\u0000${childSessionId}`;
}

/**
 * Coordinate native Session fork with the plugin-owned Worktree relation.
 * Native Session creation always wins: plugin lookup/bind failures are kept as
 * recovery state and never turn an already-created child into a failed fork.
 */
export function createWorktreeSessionForkCoordinator(
  options: WorktreeForkCoordinatorOptions,
): WorktreeForkCoordinator {
  let disposed = false;
  let revision = 0;
  let pending = new Map<string, WorktreeForkRecovery>();
  const pendingReportIds = new Map<string, ReportId[]>();
  let recoverySnapshot: WorktreeForkRecoverySnapshot = {
    revision: 0,
    pending: [],
    affectedWorkspaceIds: [],
  };
  const subscribers = new Set<() => void>();
  const boundChildren = new Set<string>();
  const bindingInFlight = new Map<string, Promise<BindingAttempt>>();
  let reconciliationInFlight: Promise<void> | undefined;
  let reconciliationAgain = false;
  let reconciliationForce = false;
  let lastSessionLineageSignature: string | undefined;
  let restoredSessionIds: Set<string> | undefined;
  const interactiveBeforeRestore = new Set<string>();
  const markInteractive = (childSessionId: string): void => {
    if (restoredSessionIds) restoredSessionIds.delete(childSessionId);
    else if (options.sessions) interactiveBeforeRestore.add(childSessionId);
  };
  const sourceGeneration = new Map<string, number>();
  const worktreeGeneration = new Map<string, number>();
  const keyOf = (workspaceId: string, worktreeId: string): string =>
    JSON.stringify([workspaceId, worktreeId]);
  const versionOf = (versions: Map<string, number>, key: string): number =>
    versions.get(key) ?? 0;

  const publish = (affectedWorkspaceIds: readonly string[] = []): void => {
    revision += 1;
    recoverySnapshot = {
      revision,
      pending: [...pending.values()],
      affectedWorkspaceIds: [...new Set(affectedWorkspaceIds)],
    };
    for (const subscriber of subscribers) subscriber();
  };

  const setRecovery = (
    sourceSessionId: string,
    childSessionId: string,
    error: unknown,
    target?: SessionBinding,
    explicit = false,
  ): void => {
    if (disposed) return;
    const key = recoveryKey(sourceSessionId, childSessionId);
    const existing = pending.get(key);
    if (!explicit && existing !== undefined) {
      const targetChanged =
        existing.binding?.workspaceId !== target?.workspaceId ||
        existing.binding?.worktreeId !== target?.worktreeId;
      pending = new Map(pending).set(key, {
        ...existing,
        ...(target === undefined ? {} : { binding: target }),
        error,
      });
      if (targetChanged) publish(target === undefined ? [] : [target.workspaceId]);
      return;
    }
    const historical = restoredSessionIds?.has(childSessionId) === true;
    const reported = worktreeNotifications.reportError(forkRecoveryError({ error, childSessionId }), {
      origin: historical ? 'restored-fork' : undefined, context: childSessionId,
    });
    const reportIds = pendingReportIds.get(key) ?? [];
    reportIds.push(reported.reportId);
    pendingReportIds.set(key, reportIds);
    pending = new Map(pending).set(key, {
      reportId: reported.reportId,
      key,
      sourceSessionId,
      childSessionId,
      historical,
      ...(target === undefined ? {} : { binding: target }),
      error,
    });
    publish(target === undefined ? [] : [target.workspaceId]);
  };

  const clearRecovery = (
    sourceSessionId: string,
    childSessionId: string,
  ): { cleared: boolean; workspaceId?: string } => {
    const key = recoveryKey(sourceSessionId, childSessionId);
    pendingReportIds.delete(key);
    const current = pending.get(key);
    if (current === undefined) return { cleared: false };
    const next = new Map(pending);
    next.delete(key);
    pending = next;
    return { cleared: true, workspaceId: current.binding?.workspaceId };
  };

  const lookupBinding = async (
    sourceSessionId: string,
  ): Promise<WorktreeForkBindingLookupResult> => {
    try {
      const index = await options.findBindings([sourceSessionId]);
      return index.bySessionId.get(sourceSessionId) ?? { status: 'missing' };
    } catch (error) {
      return { status: 'error', error };
    }
  };

  const attemptBinding = async (
    sourceSessionId: string,
    childSessionId: string,
    providedLookup?: WorktreeForkBindingLookupResult,
    explicit = false,
  ): Promise<BindingAttempt> => {
    if (disposed || boundChildren.has(childSessionId)) return { bound: false };
    const initialSourceGen = versionOf(sourceGeneration, sourceSessionId);

    const lookup = providedLookup ?? (await lookupBinding(sourceSessionId));
    if (disposed || versionOf(sourceGeneration, sourceSessionId) !== initialSourceGen) {
      if (lookup.status === 'error') {
        worktreeNotifications.reportError(forkRecoveryError({ error: lookup.error, childSessionId }), {
          origin: 'retired',
          context: childSessionId,
        });
      }
      return { bound: false };
    }
    if (lookup.status === 'error') {
      setRecovery(sourceSessionId, childSessionId, lookup.error, undefined, explicit);
      return { bound: false };
    }
    if (lookup.status === 'missing' || lookup.binding.status !== 'active') {
      const cleared = clearRecovery(sourceSessionId, childSessionId);
      if (cleared.cleared) {
        publish(cleared.workspaceId === undefined ? [] : [cleared.workspaceId]);
      }
      return { bound: false };
    }
    const target = lookup.binding;
    const wtKey = keyOf(target.workspaceId, target.worktreeId);
    const initialWtGen = versionOf(worktreeGeneration, wtKey);

    try {
      await options.bindSession({
        workspaceId: target.workspaceId,
        worktreeId: target.worktreeId,
        sessionId: childSessionId,
      });
      if (disposed) return { bound: false };
      if (
        versionOf(sourceGeneration, sourceSessionId) !== initialSourceGen ||
        versionOf(worktreeGeneration, wtKey) !== initialWtGen
      ) {
        return { bound: false };
      }
      const childBinding: SessionBinding = {
        workspaceId: target.workspaceId,
        worktreeId: target.worktreeId,
        sessionId: childSessionId,
        status: 'active',
      };
      boundChildren.add(childSessionId);
      const key = recoveryKey(sourceSessionId, childSessionId);
      const recovered = [...(pendingReportIds.get(key) ?? [])];
      const pendingEntry = pending.get(key);
      if (pendingEntry && !recovered.includes(pendingEntry.reportId)) recovered.push(pendingEntry.reportId);
      for (const reportId of recovered) worktreeNotifications.resolve(reportId);
      const { workspaceId: previousWorkspaceId } = clearRecovery(sourceSessionId, childSessionId);
      options.onBound?.(childBinding);
      publish([target.workspaceId, ...(previousWorkspaceId === undefined ? [] : [previousWorkspaceId])]);
      return { bound: true };
    } catch (error) {
      if (
        disposed ||
        versionOf(sourceGeneration, sourceSessionId) !== initialSourceGen ||
        versionOf(worktreeGeneration, wtKey) !== initialWtGen
      ) {
        worktreeNotifications.reportError(forkRecoveryError({ error, childSessionId }), {
          origin: 'retired',
          context: childSessionId,
        });
        return { bound: false };
      }
      setRecovery(sourceSessionId, childSessionId, error, target, explicit);
      return { bound: false };
    }
  };

  const bindChild = (
    sourceSessionId: string,
    childSessionId: string,
    providedLookup?: WorktreeForkBindingLookupResult,
    explicit = false,
  ): Promise<BindingAttempt> => {
    if (disposed || boundChildren.has(childSessionId)) {
      return Promise.resolve({ bound: false });
    }
    const key = recoveryKey(sourceSessionId, childSessionId);
    const current = bindingInFlight.get(key);
    if (current !== undefined) return current;
    const promise = attemptBinding(sourceSessionId, childSessionId, providedLookup, explicit).finally(() => {
      if (bindingInFlight.get(key) === promise) bindingInFlight.delete(key);
    });
    bindingInFlight.set(key, promise);
    return promise;
  };

  const reconcileNow = async (force: boolean): Promise<void> => {
    if (disposed || options.sessions === undefined) return;
    const snapshot = options.sessions.getSnapshot();
    const normalized = reconciliationSnapshot(snapshot);
    if (normalized === undefined) return;
    if (!restoredSessionIds) {
      // Native fork completion can precede the first usable list or join a bind already in flight.
      restoredSessionIds = new Set(snapshot.ids.filter((id) => !interactiveBeforeRestore.has(id)));
      interactiveBeforeRestore.clear();
    }
    if (!force && normalized.signature === lastSessionLineageSignature) return;
    lastSessionLineageSignature = normalized.signature;
    const candidates = normalized.candidates.filter(
      ({ childSessionId, sourceSessionId }) =>
        !boundChildren.has(childSessionId) &&
        (force || !pending.has(recoveryKey(sourceSessionId, childSessionId))),
    );
    if (candidates.length === 0) return;
    const sourceSessionIds = [...new Set(candidates.map(({ sourceSessionId }) => sourceSessionId))];
    const lookupGenerations = new Map(
      sourceSessionIds.map((id) => [id, versionOf(sourceGeneration, id)]),
    );
    let index: WorktreeForkBindingIndex;
    try {
      index = await options.findBindings(sourceSessionIds);
    } catch (error) {
      const bySessionId = new Map<string, WorktreeForkBindingLookupResult>();
      for (const sourceSessionId of sourceSessionIds) {
        bySessionId.set(sourceSessionId, { status: 'error', error });
      }
      index = { bySessionId };
    }
    if (disposed) return;
    await Promise.all(
      candidates.filter(({ sourceSessionId }) =>
        lookupGenerations.get(sourceSessionId) === versionOf(sourceGeneration, sourceSessionId),
      ).map(({ childSessionId, sourceSessionId }) =>
        bindChild(
          sourceSessionId,
          childSessionId,
          index.bySessionId.get(sourceSessionId) ?? { status: 'missing' },
        ).then(() => undefined),
      ),
    );
  };

  const reconcile = (input: { readonly force?: boolean } = {}): Promise<void> => {
    const force = input.force === true;
    if (reconciliationInFlight !== undefined) {
      reconciliationAgain = true;
      reconciliationForce ||= force;
      return reconciliationInFlight;
    }
    let nextForce = force;
    const run = async (): Promise<void> => {
      do {
        const forceThisPass = nextForce || reconciliationForce;
        nextForce = false;
        reconciliationForce = false;
        reconciliationAgain = false;
        await reconcileNow(forceThisPass);
      } while (!disposed && reconciliationAgain);
    };
    const promise = run().finally(() => {
      if (reconciliationInFlight === promise) reconciliationInFlight = undefined;
    });
    reconciliationInFlight = promise;
    return promise;
  };

  return {
    recovery: {
      getSnapshot() {
        return recoverySnapshot;
      },
      subscribe(listener) {
        subscribers.add(listener);
        return () => subscribers.delete(listener);
      },
    },
    async fork(input) {
      const generation = versionOf(sourceGeneration, input.sessionId);
      const childSessionId = await options.fork(input);
      if (!disposed && generation === versionOf(sourceGeneration, input.sessionId)) {
        markInteractive(childSessionId);
        await bindChild(input.sessionId, childSessionId, undefined, true);
      }
      return childSessionId;
    },
    reconcile,
    async retry(key) {
      const item = pending.get(key);
      if (item === undefined || disposed) return false;
      markInteractive(item.childSessionId);
      const providedLookup = item.binding === undefined
        ? undefined
        : { status: 'found' as const, binding: item.binding };
      return (await bindChild(item.sourceSessionId, item.childSessionId, providedLookup, true)).bound;
    },
    forgetWorktree(input: ForgottenWorktree): void {
      if (disposed) return;
      const wtKey = keyOf(input.workspaceId, input.worktreeId);
      worktreeGeneration.set(wtKey, versionOf(worktreeGeneration, wtKey) + 1);
      for (const sid of input.sessionIds) {
        sourceGeneration.set(sid, versionOf(sourceGeneration, sid) + 1);
      }
      let changed = false;
      const next = new Map(pending);
      for (const [key, item] of pending.entries()) {
        const matchWorktree =
          item.binding?.workspaceId === input.workspaceId &&
          item.binding?.worktreeId === input.worktreeId;
        const matchSession = input.sessionIds.includes(item.sourceSessionId);
        if (matchWorktree || matchSession) {
          next.delete(key);
          pendingReportIds.delete(key);
          changed = true;
        }
      }
      if (changed) {
        pending = next;
        publish([input.workspaceId]);
      }
    },
    dispose() {
      disposed = true;
      bindingInFlight.clear();
      pendingReportIds.clear();
      subscribers.clear();
    },
  };
}
