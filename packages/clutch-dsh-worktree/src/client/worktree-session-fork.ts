import type { SessionBinding } from '../contract/index.js';

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
  readonly key: string;
  readonly sourceSessionId: string;
  readonly childSessionId: string;
  readonly binding?: SessionBinding;
  readonly error: unknown;
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

export interface WorktreeForkCoordinator {
  readonly recovery: WorktreeForkRecoveryStore;
  fork(input: WorktreeForkInput): Promise<string>;
  reconcile(options?: { readonly force?: boolean }): Promise<void>;
  retry(key: string): Promise<boolean>;
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
  ): void => {
    if (disposed) return;
    const key = recoveryKey(sourceSessionId, childSessionId);
    pending = new Map(pending).set(key, {
      key,
      sourceSessionId,
      childSessionId,
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
  ): Promise<BindingAttempt> => {
    if (disposed || boundChildren.has(childSessionId)) return { bound: false };

    const lookup = providedLookup ?? (await lookupBinding(sourceSessionId));
    if (lookup.status === 'error') {
      setRecovery(sourceSessionId, childSessionId, lookup.error);
      return { bound: false };
    }
    if (disposed) return { bound: false };
    if (lookup.status === 'missing' || lookup.binding.status !== 'active') {
      const cleared = clearRecovery(sourceSessionId, childSessionId);
      if (cleared.cleared) {
        publish(cleared.workspaceId === undefined ? [] : [cleared.workspaceId]);
      }
      return { bound: false };
    }
    const target = lookup.binding;

    try {
      await options.bindSession({
        workspaceId: target.workspaceId,
        worktreeId: target.worktreeId,
        sessionId: childSessionId,
      });
      if (disposed) return { bound: false };
      const childBinding: SessionBinding = {
        workspaceId: target.workspaceId,
        worktreeId: target.worktreeId,
        sessionId: childSessionId,
        status: 'active',
      };
      boundChildren.add(childSessionId);
      const { workspaceId: previousWorkspaceId } = clearRecovery(sourceSessionId, childSessionId);
      options.onBound?.(childBinding);
      publish([target.workspaceId, ...(previousWorkspaceId === undefined ? [] : [previousWorkspaceId])]);
      return { bound: true };
    } catch (error) {
      setRecovery(sourceSessionId, childSessionId, error, target);
      return { bound: false };
    }
  };

  const bindChild = (
    sourceSessionId: string,
    childSessionId: string,
    providedLookup?: WorktreeForkBindingLookupResult,
  ): Promise<BindingAttempt> => {
    if (disposed || boundChildren.has(childSessionId)) {
      return Promise.resolve({ bound: false });
    }
    const key = recoveryKey(sourceSessionId, childSessionId);
    const current = bindingInFlight.get(key);
    if (current !== undefined) return current;
    const promise = attemptBinding(sourceSessionId, childSessionId, providedLookup).finally(() => {
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
    if (!force && normalized.signature === lastSessionLineageSignature) return;
    lastSessionLineageSignature = normalized.signature;
    const candidates = normalized.candidates.filter(
      ({ childSessionId }) => !boundChildren.has(childSessionId),
    );
    if (candidates.length === 0) return;
    const sourceSessionIds = [...new Set(candidates.map(({ sourceSessionId }) => sourceSessionId))];
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
      candidates.map(({ childSessionId, sourceSessionId }) =>
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
      const childSessionId = await options.fork(input);
      if (!disposed) await bindChild(input.sessionId, childSessionId);
      return childSessionId;
    },
    reconcile,
    async retry(key) {
      const item = pending.get(key);
      if (item === undefined || disposed) return false;
      const providedLookup = item.binding === undefined
        ? undefined
        : { status: 'found' as const, binding: item.binding };
      return (await bindChild(item.sourceSessionId, item.childSessionId, providedLookup)).bound;
    },
    dispose() {
      disposed = true;
      bindingInFlight.clear();
      subscribers.clear();
    },
  };
}
