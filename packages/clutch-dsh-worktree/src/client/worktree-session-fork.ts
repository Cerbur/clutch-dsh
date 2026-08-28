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
}

export interface WorktreeForkRecoveryStore {
  getSnapshot(): WorktreeForkRecoverySnapshot;
  subscribe(listener: () => void): () => void;
}

export interface WorktreeForkCoordinatorOptions {
  /** The unwrapped DSH fork method. */
  readonly fork: (input: WorktreeForkInput) => Promise<string>;
  /** Find the parent's active sidecar binding across all native Workspaces. */
  readonly findBinding: (sessionId: string) => Promise<SessionBinding | undefined>;
  /** Existing Worktree sidecar mutation; it remains the only binding writer. */
  readonly bindSession: (input: {
    workspaceId: string;
    worktreeId: string;
    sessionId: string;
  }) => Promise<unknown>;
  /** Existing browser-local native Workspace membership projection. */
  readonly ensureSessionWorkspace: (workspaceId: string, sessionId: string) => void;
  readonly sessions?: WorktreeForkSessionListReader;
  /** Called after a child binding has been committed and projected. */
  readonly onBound?: (binding: SessionBinding) => void;
}

export interface WorktreeForkCoordinator {
  readonly recovery: WorktreeForkRecoveryStore;
  fork(input: WorktreeForkInput): Promise<string>;
  reconcile(): Promise<void>;
  retry(key: string): Promise<boolean>;
  dispose(): void;
}

interface BindingAttempt {
  readonly bound: boolean;
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
  let recoverySnapshot: WorktreeForkRecoverySnapshot = { revision: 0, pending: [] };
  const subscribers = new Set<() => void>();
  const boundChildren = new Set<string>();
  const bindingInFlight = new Map<string, Promise<BindingAttempt>>();
  let reconciliationInFlight: Promise<void> | undefined;
  let reconciliationAgain = false;

  const publish = (): void => {
    revision += 1;
    recoverySnapshot = { revision, pending: [...pending.values()] };
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
    publish();
  };

  const clearRecovery = (sourceSessionId: string, childSessionId: string): void => {
    const key = recoveryKey(sourceSessionId, childSessionId);
    if (!pending.has(key)) return;
    const next = new Map(pending);
    next.delete(key);
    pending = next;
    publish();
  };

  const attemptBinding = async (
    sourceSessionId: string,
    childSessionId: string,
  ): Promise<BindingAttempt> => {
    if (disposed || boundChildren.has(childSessionId)) return { bound: false };

    let target: SessionBinding | undefined;
    try {
      target = await options.findBinding(sourceSessionId);
    } catch (error) {
      setRecovery(sourceSessionId, childSessionId, error);
      return { bound: false };
    }
    if (disposed) return { bound: false };
    if (target === undefined || target.status !== 'active') {
      clearRecovery(sourceSessionId, childSessionId);
      return { bound: false };
    }

    try {
      await options.bindSession({
        workspaceId: target.workspaceId,
        worktreeId: target.worktreeId,
        sessionId: childSessionId,
      });
      if (disposed) return { bound: false };
      options.ensureSessionWorkspace(target.workspaceId, childSessionId);
      const childBinding: SessionBinding = {
        workspaceId: target.workspaceId,
        worktreeId: target.worktreeId,
        sessionId: childSessionId,
        status: 'active',
      };
      boundChildren.add(childSessionId);
      clearRecovery(sourceSessionId, childSessionId);
      options.onBound?.(childBinding);
      publish();
      return { bound: true };
    } catch (error) {
      setRecovery(sourceSessionId, childSessionId, error, target);
      return { bound: false };
    }
  };

  const bindChild = (
    sourceSessionId: string,
    childSessionId: string,
  ): Promise<BindingAttempt> => {
    if (disposed || boundChildren.has(childSessionId)) {
      return Promise.resolve({ bound: false });
    }
    const key = recoveryKey(sourceSessionId, childSessionId);
    const current = bindingInFlight.get(key);
    if (current !== undefined) return current;
    const promise = attemptBinding(sourceSessionId, childSessionId).finally(() => {
      if (bindingInFlight.get(key) === promise) bindingInFlight.delete(key);
    });
    bindingInFlight.set(key, promise);
    return promise;
  };

  const reconcileNow = async (): Promise<void> => {
    if (disposed || options.sessions === undefined) return;
    const snapshot = options.sessions.getSnapshot();
    if (snapshot.phase === 'pending') return;
    if (!Array.isArray(snapshot.ids) || typeof snapshot.byId !== 'object' || snapshot.byId === null) {
      return;
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
    await Promise.all(
      candidates.map(({ childSessionId, sourceSessionId }) =>
        bindChild(sourceSessionId, childSessionId).then(() => undefined),
      ),
    );
  };

  const reconcile = (): Promise<void> => {
    if (reconciliationInFlight !== undefined) {
      reconciliationAgain = true;
      return reconciliationInFlight;
    }
    const run = async (): Promise<void> => {
      do {
        reconciliationAgain = false;
        await reconcileNow();
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
      return (await bindChild(item.sourceSessionId, item.childSessionId)).bound;
    },
    dispose() {
      disposed = true;
      bindingInFlight.clear();
      subscribers.clear();
    },
  };
}
