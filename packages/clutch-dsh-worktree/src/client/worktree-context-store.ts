import type {
  ObservableSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client';

import {
  resolveWorktreeSessionContext,
  type WorktreeSessionContext,
} from './worktree-context.js';
import {
  type WorktreeViewReader,
  toWorktreeViewError,
  type WorktreeViewData,
  type WorktreeViewError,
} from './worktree-view.js';

interface SessionSnapshot {
  readonly current?: string;
}

interface WorkspaceSnapshot {
  readonly items: readonly {
    readonly workspaceId: string;
    readonly title: string;
    readonly sessionIds: readonly string[];
  }[];
  readonly recentWorkspaceId?: string;
}

interface CurrentIdentity {
  readonly sessionId?: string;
  readonly workspaceId?: string;
}

interface ContextRequest {
  readonly sessionId?: string;
  readonly workspaceId: string;
}

export interface WorktreeContextState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly workspaceTitle?: string;
  readonly value: WorktreeSessionContext;
  readonly error?: WorktreeViewError;
}

export interface WorktreeContextProjection {
  readonly store: SnapshotStore<WorktreeContextState>;
  refresh(): Promise<void>;
  invalidate(workspaceId?: string): Promise<void>;
  dispose(): void;
}

/** Browser composition supplies DSH's React-free snapshot-store primitive. */
export type WorktreeContextStoreFactory = <State>(initial: State) => SnapshotStore<State>;

export interface WorktreeContextProjectionInput {
  readonly sessions: ObservableSnapshot<SessionSnapshot>;
  readonly workspaces: ObservableSnapshot<WorkspaceSnapshot>;
  readonly viewReader: WorktreeViewReader;
  readonly storeFactory: WorktreeContextStoreFactory;
}

const notReady = (): WorktreeSessionContext => ({ kind: 'none', reason: 'not-ready' });

interface ScheduledRefresh {
  readonly promise: Promise<void>;
  resolve(): void;
}

function scheduledRefresh(): ScheduledRefresh {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function identityFrom(
  sessions: ObservableSnapshot<SessionSnapshot>,
  workspaces: ObservableSnapshot<WorkspaceSnapshot>,
): CurrentIdentity {
  const sessionId = sessions.getSnapshot().current;
  if (sessionId === undefined) {
    return { workspaceId: workspaces.getSnapshot().recentWorkspaceId };
  }
  const workspace = workspaces.getSnapshot().items.find(
    (candidate) => candidate.sessionIds.includes(sessionId),
  );
  return { sessionId, workspaceId: workspace?.workspaceId };
}

/**
 * Build one browser-local current-Session projection shared by the header
 * consumer. Superseded requests may still finish on the transport, but their
 * results never become visible in the current snapshot.
 */
export function createWorktreeContextProjection(
  input: WorktreeContextProjectionInput,
): WorktreeContextProjection {
  const store = input.storeFactory<WorktreeContextState>({
    status: 'idle',
    value: notReady(),
  });
  let disposed = false;
  let generation = 0;
  let scheduled = false;
  let scheduleTicket = 0;
  let scheduledCompletion: ScheduledRefresh | undefined;
  let latestRefresh: Promise<void> = Promise.resolve();
  let lastObservedIdentity: CurrentIdentity | undefined;

  const sameIdentity = (
    left: CurrentIdentity | undefined,
    right: CurrentIdentity,
  ): boolean => left?.sessionId === right.sessionId
    && left?.workspaceId === right.workspaceId;

  const workspaceTitleFor = (workspaceId: string): string | undefined =>
    input.workspaces.getSnapshot().items.find((candidate) => candidate.workspaceId === workspaceId)
      ?.title;

  const valueFrom = (identity: CurrentIdentity, data: WorktreeViewData): WorktreeSessionContext =>
    resolveWorktreeSessionContext({
      currentSessionId: identity.sessionId,
      currentWorkspaceId: identity.workspaceId,
      workspaces: input.workspaces.getSnapshot().items,
      branches: data.branches,
      worktrees: data.worktrees,
      bindings: data.bindings,
    });

  const syncWorkspaceTitle = (identity: CurrentIdentity): void => {
    const current = store.getSnapshot();
    if (
      current.sessionId !== identity.sessionId ||
      current.workspaceId !== identity.workspaceId ||
      identity.workspaceId === undefined
    )
      return;
    const workspaceTitle = workspaceTitleFor(identity.workspaceId);
    if (current.workspaceTitle === workspaceTitle) return;
    store.set({ ...current, workspaceTitle });
  };

  const setPending = (identity: CurrentIdentity): void => {
    if (identity.workspaceId === undefined) {
      store.set({
        status: 'ready',
        value: resolveWorktreeSessionContext({
          currentSessionId: identity.sessionId,
          currentWorkspaceId: identity.workspaceId,
          workspaces: input.workspaces.getSnapshot().items,
          branches: [],
          worktrees: [],
          bindings: [],
        }),
      });
      return;
    }
    const current = store.getSnapshot();
    if (current.status === 'ready' && current.workspaceId === identity.workspaceId) {
      store.set({
        status: 'ready',
        ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
        workspaceId: identity.workspaceId,
        workspaceTitle: workspaceTitleFor(identity.workspaceId),
        value: current.value,
      });
      return;
    }
    store.set({
      status: 'loading',
      ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
      workspaceId: identity.workspaceId,
      workspaceTitle: workspaceTitleFor(identity.workspaceId),
      value: notReady(),
    });
  };

  const matchesCurrent = (
    request: ContextRequest,
    requestGeneration: number,
  ): boolean => {
    if (disposed || generation !== requestGeneration) return false;
    const current = identityFrom(input.sessions, input.workspaces);
    return current.sessionId === request.sessionId && current.workspaceId === request.workspaceId;
  };

  const runRefresh = async (): Promise<void> => {
    if (disposed) return;
    const requestGeneration = ++generation;
    const identity = identityFrom(input.sessions, input.workspaces);
    lastObservedIdentity = identity;
    setPending(identity);
    if (identity.workspaceId === undefined) return;

    const request: ContextRequest = {
      sessionId: identity.sessionId,
      workspaceId: identity.workspaceId,
    };
    try {
      const data = await input.viewReader.read(request.workspaceId);
      if (!matchesCurrent(request, requestGeneration)) return;
      const workspace = input.workspaces.getSnapshot().items.find(
        (candidate) => candidate.workspaceId === request.workspaceId,
      );
      if ('error' in data.readiness) {
        store.set({
          status: 'error',
          ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
          workspaceId: request.workspaceId,
          workspaceTitle: workspace?.title,
          value: notReady(),
          error: data.readiness.error,
        });
        return;
      }
      store.set({
        status: 'ready',
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        workspaceId: request.workspaceId,
        workspaceTitle: workspace?.title,
        value: valueFrom(request, data),
      });
    } catch (error) {
      if (!matchesCurrent(request, requestGeneration)) return;
      store.set({
        status: 'error',
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        workspaceId: request.workspaceId,
        workspaceTitle: input.workspaces.getSnapshot().items.find(
          (candidate) => candidate.workspaceId === request.workspaceId,
        )?.title,
        value: notReady(),
        error: toWorktreeViewError(error),
      });
    }
  };

  const cancelScheduledRefresh = (): void => {
    scheduleTicket += 1;
    scheduled = false;
    const completion = scheduledCompletion;
    scheduledCompletion = undefined;
    completion?.resolve();
  };

  const refresh = (): Promise<void> => {
    cancelScheduledRefresh();
    lastObservedIdentity = identityFrom(input.sessions, input.workspaces);
    const completion = runRefresh();
    latestRefresh = completion;
    return completion;
  };

  const scheduleRefresh = (): void => {
    if (disposed) return;
    const identity = identityFrom(input.sessions, input.workspaces);
    if (sameIdentity(lastObservedIdentity, identity)) {
      syncWorkspaceTitle(identity);
      return;
    }
    lastObservedIdentity = identity;
    generation += 1;
    setPending(identity);
    if (scheduled) return;
    scheduled = true;
    const ticket = ++scheduleTicket;
    const completion = scheduledRefresh();
    scheduledCompletion = completion;
    latestRefresh = completion.promise;
    queueMicrotask(() => {
      if (disposed || ticket !== scheduleTicket) {
        completion.resolve();
        return;
      }
      scheduled = false;
      void runRefresh().finally(() => {
        if (scheduledCompletion === completion) scheduledCompletion = undefined;
        completion.resolve();
      });
    });
  };

  const waitForLatestRefresh = async (workspaceId: string | undefined): Promise<void> => {
    let observed: Promise<void> | undefined;
    while (!disposed) {
      if (
        workspaceId !== undefined
        && identityFrom(input.sessions, input.workspaces).workspaceId !== workspaceId
      ) {
        return;
      }
      const completion = latestRefresh;
      if (completion === observed) return;
      observed = completion;
      await completion;
    }
  };

  const unsubscribeSessions = input.sessions.subscribe(scheduleRefresh);
  const unsubscribeWorkspaces = input.workspaces.subscribe(scheduleRefresh);

  return {
    store,
    refresh,
    async invalidate(workspaceId): Promise<void> {
      if (disposed) return;
      const identity = identityFrom(input.sessions, input.workspaces);
      if (workspaceId !== undefined && workspaceId !== identity.workspaceId) return;
      if (identity.workspaceId === undefined) return;
      input.viewReader.invalidate(identity.workspaceId);
      await refresh();
      await waitForLatestRefresh(workspaceId ?? identity.workspaceId);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      cancelScheduledRefresh();
      unsubscribeSessions();
      unsubscribeWorkspaces();
      store.set({ status: 'idle', value: notReady() });
    },
  };
}
