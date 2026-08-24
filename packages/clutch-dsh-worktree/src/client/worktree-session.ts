import type {
  SessionBinding,
  WorktreeHealth,
  WorktreeManager,
  WorktreeStatus,
} from '../contract/index.js';
import {
  createSessionForWorktree,
  WorktreeSessionBindingError,
  type CreateSessionForWorktreeInput,
} from './worktree-view.js';

export interface WorktreeSessionSummary {
  readonly blank?: boolean;
  readonly cwd?: string;
}

export interface WorktreeSessionListSnapshot {
  readonly phase: 'pending' | 'ready';
  readonly ids: readonly string[];
  readonly byId: Readonly<Record<string, WorktreeSessionSummary | undefined>>;
}

export interface WorktreeSessionTarget {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly absolutePath: string;
  readonly status: WorktreeStatus;
  readonly health?: WorktreeHealth;
}

export type WorktreeSessionAction =
  | { readonly kind: 'open-bound'; readonly sessionId: string }
  | { readonly kind: 'bind-existing'; readonly sessionId: string }
  | { readonly kind: 'create' }
  | { readonly kind: 'wait'; readonly reason: string }
  | { readonly kind: 'repair'; readonly reason: string; readonly sessionId?: string }
  | { readonly kind: 'reject'; readonly reason: string };

export interface ResolveWorktreeSessionActionInput {
  readonly target: WorktreeSessionTarget;
  readonly sessions: WorktreeSessionListSnapshot;
  readonly archivedSessionIds: readonly string[];
  readonly bindings: readonly SessionBinding[];
}

export class WorktreeSessionActionError extends Error {
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'WorktreeSessionActionError';
    this.details = details;
  }
}

export interface WorktreeSessionSnapshotReader {
  getSnapshot(): WorktreeSessionListSnapshot;
}

export interface WorktreeSessionConnectorOptions {
  readonly manager: Pick<WorktreeManager, 'listWorktrees' | 'listBindings' | 'bindSession'>;
  readonly sessions: WorktreeSessionSnapshotReader;
  readonly archivedSessionIds: () => readonly string[];
  readonly createSession: (input: { readonly cwd: string }) => Promise<string>;
  readonly ensureSessionWorkspace: (workspaceId: string, sessionId: string) => void;
  readonly openSession: (sessionId: string) => void;
}

export interface WorktreeSessionConnector {
  create(input: CreateSessionForWorktreeInput): Promise<string>;
  dispose(): void;
}

export interface PendingWorktreeSessionBinding extends CreateSessionForWorktreeInput {
  readonly sessionId: string;
}

export function resolveWorktreeSessionAction(
  input: ResolveWorktreeSessionActionInput,
): WorktreeSessionAction {
  if (input.target.status !== 'active' || input.target.health === 'repair') {
    return { kind: 'reject', reason: 'worktree-not-available' };
  }
  if (input.sessions.phase !== 'ready') {
    return { kind: 'wait', reason: 'sessions-not-ready' };
  }
  const targetBinding = input.bindings.find(
    (binding) => binding.worktreeId === input.target.worktreeId && binding.status === 'active',
  );
  if (targetBinding !== undefined) {
    const summary = input.sessions.byId[targetBinding.sessionId];
    if (summary === undefined) {
      return {
        kind: 'repair',
        reason: 'active-binding-session-missing',
        sessionId: targetBinding.sessionId,
      };
    }
    if (summary.cwd !== input.target.absolutePath) {
      return {
        kind: 'repair',
        reason: 'active-binding-cwd-mismatch',
        sessionId: targetBinding.sessionId,
      };
    }
    if (
      summary.blank === true &&
      !input.archivedSessionIds.includes(targetBinding.sessionId)
    ) {
      return { kind: 'open-bound', sessionId: targetBinding.sessionId };
    }
  }

  for (const sessionId of input.sessions.ids) {
    const summary = input.sessions.byId[sessionId];
    if (
      summary === undefined ||
      summary.blank === undefined ||
      (summary.blank === true && summary.cwd === undefined)
    ) {
      return { kind: 'wait', reason: 'session-facts-incomplete' };
    }
  }

  for (const sessionId of input.sessions.ids) {
    const summary = input.sessions.byId[sessionId];
    if (
      summary?.blank !== true ||
      summary.cwd !== input.target.absolutePath ||
      input.archivedSessionIds.includes(sessionId)
    ) {
      continue;
    }
    if (!input.bindings.some((binding) => binding.sessionId === sessionId)) {
      return { kind: 'bind-existing', sessionId };
    }
  }
  return { kind: 'create' };
}

function actionError(action: WorktreeSessionAction): WorktreeSessionActionError {
  switch (action.kind) {
    case 'wait':
      return new WorktreeSessionActionError(
        action.reason === 'sessions-not-ready' ? 'SESSION_LIST_NOT_READY' : 'SESSION_FACTS_INCOMPLETE',
        '',
        true,
      );
    case 'repair':
      return new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', action.reason, true, {
        ...(action.sessionId === undefined ? {} : { sessionId: action.sessionId }),
      });
    case 'reject':
      return new WorktreeSessionActionError('WORKTREE_SESSION_UNAVAILABLE', action.reason, false);
    default:
      return new WorktreeSessionActionError('WORKTREE_SESSION_ACTION_FAILED', '', true);
  }
}

export async function retryWorktreeSessionBinding(input: {
  readonly manager: Pick<WorktreeManager, 'bindSession'>;
  readonly pending: PendingWorktreeSessionBinding;
  readonly archived: boolean;
  readonly ensureSessionWorkspace: (workspaceId: string, sessionId: string) => void;
  readonly openSession: (sessionId: string) => void;
}): Promise<string> {
  if (input.archived) {
    throw new WorktreeSessionActionError('SESSION_ARCHIVED', '', false, {
      sessionId: input.pending.sessionId,
    });
  }
  try {
    await input.manager.bindSession({
      workspaceId: input.pending.workspaceId,
      worktreeId: input.pending.worktreeId,
      sessionId: input.pending.sessionId,
    });
  } catch (error) {
    throw new WorktreeSessionBindingError(input.pending.sessionId, error);
  }
  input.ensureSessionWorkspace(input.pending.workspaceId, input.pending.sessionId);
  input.openSession(input.pending.sessionId);
  return input.pending.sessionId;
}

/**
 * Browser-only Worktree `+` connector. It owns the read/resolve/bind/create/open
 * sequence and coalesces repeated calls for one Worktree within one Client fiber.
 */
export function createWorktreeSessionConnector(
  options: WorktreeSessionConnectorOptions,
): WorktreeSessionConnector {
  const inFlight = new Map<string, Promise<string>>();
  let disposed = false;

  const run = async (input: CreateSessionForWorktreeInput): Promise<string> => {
    const [worktrees, bindings] = await Promise.all([
      options.manager.listWorktrees({ workspaceId: input.workspaceId }),
      options.manager.listBindings({ workspaceId: input.workspaceId }),
    ]);
    if (disposed) {
      throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
    }
    const target = worktrees.find((record) => record.worktreeId === input.worktreeId);
    if (target === undefined || target.absolutePath !== input.cwd) {
      throw new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', 'worktree target unavailable', true);
    }
    const action = resolveWorktreeSessionAction({
      target,
      sessions: options.sessions.getSnapshot(),
      archivedSessionIds: options.archivedSessionIds(),
      bindings,
    });
    if (action.kind === 'open-bound') {
      options.ensureSessionWorkspace(input.workspaceId, action.sessionId);
      if (!disposed) options.openSession(action.sessionId);
      return action.sessionId;
    }
    if (action.kind === 'bind-existing') {
      try {
        await options.manager.bindSession({
          workspaceId: input.workspaceId,
          worktreeId: input.worktreeId,
          sessionId: action.sessionId,
        });
      } catch (error) {
        throw new WorktreeSessionBindingError(action.sessionId, error);
      }
      if (!disposed) {
        options.ensureSessionWorkspace(input.workspaceId, action.sessionId);
        if (!disposed) options.openSession(action.sessionId);
      }
      return action.sessionId;
    }
    if (action.kind !== 'create') throw actionError(action);
    if (disposed) throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
    return createSessionForWorktree({
      ...input,
      createSession: options.createSession,
      manager: options.manager,
      beforeOpen: (sessionId) => {
        if (disposed) throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
        options.ensureSessionWorkspace(input.workspaceId, sessionId);
      },
      openSession: (sessionId) => {
        if (!disposed) options.openSession(sessionId);
      },
    });
  };

  return {
    create(input) {
      const key = `${input.workspaceId}\u0000${input.worktreeId}`;
      const current = inFlight.get(key);
      if (current !== undefined) return current;
      const promise = run(input).finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
    dispose() {
      disposed = true;
      inFlight.clear();
    },
  };
}
