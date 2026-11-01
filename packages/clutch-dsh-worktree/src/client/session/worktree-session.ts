import type {
  SessionBinding,
  WorktreeHealth,
  WorktreeManager,
  WorktreeStatus,
  WorktreeSessionState,
} from '../../contract/index.js';
import { sameWindowsPath } from '../../contract/windows-path.js';
import type { WorktreeViewReader } from '../view/worktree-view-read.js';
import {
  createSessionForWorktree,
  WorktreeSessionBindingError,
  type CreateSessionForWorktreeInput,
} from '../view/worktree-view.js';
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
  readonly gitRootPath?: string;
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
  /** True when Host will perform authoritative physical cwd validation before opening. */
  readonly hostValidatesPhysicalPath?: boolean;
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
  readonly manager: Pick<WorktreeManager, 'listWorktrees' | 'listBindings' | 'bindSession' | 'readWorktreeSessionState'>;
  readonly viewReader?: Pick<WorktreeViewReader, 'beginSessionChange'>;
  readonly sessions: WorktreeSessionSnapshotReader;
  readonly archivedSessionIds: () => readonly string[];
  readonly createSession: (input: { readonly cwd: string }) => Promise<string>;
  /** The packaged Host owns native Workspace creation, directory entry and binding. */
  readonly createBoundSession?: (input: CreateSessionForWorktreeInput & { readonly requestId: string }) => Promise<{
    readonly sessionId: string; readonly bound: boolean; readonly error?: string; readonly state?: WorktreeSessionState;
  }>;
  readonly ensureSessionWorkspace: (workspaceId: string, sessionId: string) => void;
  readonly openSession: (sessionId: string) => void;

}

export interface WorktreeSessionConnector {
  create(input: CreateSessionForWorktreeInput, beforeOpen?: (sessionId: string, projectionReady?: boolean) => Promise<void>): Promise<string>;
  dispose(): void;
}

export interface PendingWorktreeSessionBinding extends CreateSessionForWorktreeInput {
  readonly sessionId: string;
}

/**
 * Compare paths for browser-side candidate filtering and the no-Host safety fallback.
 * When Host validation is available, it remains authoritative for physical aliases.
 */
function sameWorktreePath(left: string, right: string): boolean {
  return left === right || sameWindowsPath(left, right);
}

export function resolveWorktreeSessionAction(
  input: ResolveWorktreeSessionActionInput,
): WorktreeSessionAction {
  if (
    input.target.status !== 'active' ||
    input.target.health === 'repair' ||
    input.target.health === 'recovery-needed'
  ) {
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
    if (
      summary.cwd === undefined ||
      (!input.hostValidatesPhysicalPath &&
        !sameWorktreePath(summary.cwd, input.target.absolutePath) &&
        (input.target.gitRootPath === undefined || !sameWorktreePath(summary.cwd, input.target.gitRootPath)))
    ) {
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
      summary.cwd === undefined ||
      !sameWorktreePath(summary.cwd, input.target.absolutePath) ||
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
  readonly beforeOpen?: (sessionId: string) => Promise<void>;
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

  await input.beforeOpen?.(input.pending.sessionId);
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
  const creationRequests = new Map<string, string>();
  let disposed = false;

  const run = async (input: CreateSessionForWorktreeInput, beforeOpen?: (sessionId: string, projectionReady?: boolean) => Promise<void>): Promise<string> => {
    const key = JSON.stringify([input.workspaceId, input.worktreeId]);
    const requestId = creationRequests.get(key) ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const commitProjection = options.viewReader?.beginSessionChange?.(input.workspaceId, requestId);
    let minimumRevision = '0';
    const prepareOpen = async (sessionId: string, state?: WorktreeSessionState): Promise<void> => {
      if (disposed) throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
      if (state && (state.workspaceId !== input.workspaceId || state.target?.worktreeId !== input.worktreeId ||
        state.target.status !== 'active' || state.target.diskCleanup === 'completed' ||
        state.target.health === 'repair' || state.target.health === 'recovery-needed' ||
        !state.bindings.some((binding) => binding.sessionId === sessionId && binding.worktreeId === input.worktreeId && binding.status === 'active'))) {
        throw new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', 'binding changed before opening', true);
      }
      const projectionReady = commitProjection?.(state, minimumRevision) ?? false;
      await beforeOpen?.(sessionId, projectionReady);
      if (disposed) throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
    };
    try {
      const initialState = options.manager.readWorktreeSessionState
        ? await options.manager.readWorktreeSessionState(input) : undefined;
      if (initialState) minimumRevision = initialState.revision;
      const [worktrees, bindings] = initialState
        ? [initialState.target ? [initialState.target] : [], initialState.bindings] as const
        : await Promise.all([
        options.manager.listWorktrees({ workspaceId: input.workspaceId }),
        options.manager.listBindings({ workspaceId: input.workspaceId }),
      ]);
      if (disposed) {
        throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
      }
      const target = worktrees.find((record) => record.worktreeId === input.worktreeId);
      if (
        target === undefined ||
        (options.createBoundSession === undefined && !sameWorktreePath(target.absolutePath, input.cwd))
      ) {
        throw new WorktreeSessionActionError('WORKTREE_SESSION_REPAIR_REQUIRED', 'worktree target unavailable', true);
      }
      const action = resolveWorktreeSessionAction({
        target,
        sessions: options.sessions.getSnapshot(),
        archivedSessionIds: options.archivedSessionIds(),
        bindings,
        hostValidatesPhysicalPath: options.createBoundSession !== undefined,
      });
      if (action.kind === 'open-bound') {
        // Revalidate physical cwd and ownership in Host before reusing a blank Session.
        try {
          await options.manager.bindSession({
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            sessionId: action.sessionId,
          });
        } catch (error) {
          throw new WorktreeSessionBindingError(action.sessionId, error);
        }
        if (disposed) throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
        creationRequests.delete(key);
        await prepareOpen(action.sessionId, await options.manager.readWorktreeSessionState?.(input));
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
          creationRequests.delete(key);
          await prepareOpen(action.sessionId, await options.manager.readWorktreeSessionState?.(input));
          options.ensureSessionWorkspace(input.workspaceId, action.sessionId);
          if (!disposed) options.openSession(action.sessionId);
        }
        return action.sessionId;
      }
      if (action.kind !== 'create') throw actionError(action);
      if (disposed) throw new WorktreeSessionActionError('CLIENT_DISPOSED', '', false);
      if (options.createBoundSession) {
        creationRequests.set(key, requestId);
        const created = await options.createBoundSession({ ...input, requestId });
        if (!created.bound) throw new WorktreeSessionBindingError(created.sessionId, new Error(created.error));
        await prepareOpen(created.sessionId, created.state);
        if (!disposed) options.openSession(created.sessionId);
        creationRequests.delete(key);
        return created.sessionId;
      }
      return createSessionForWorktree({
        ...input,
        createSession: options.createSession,
        manager: options.manager,
        beforeOpen: prepareOpen,
        openSession: (sessionId) => {
          if (!disposed) options.openSession(sessionId);
        },
      });
    }
    finally { commitProjection?.(); }
  };

  return {
    create(input, beforeOpen) {
      const key = `${input.workspaceId}\u0000${input.worktreeId}`;
      const current = inFlight.get(key);
      if (current !== undefined) return current;
      const promise = run(input, beforeOpen).finally(() => {
        if (inFlight.get(key) === promise) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
    dispose() {
      disposed = true;
      inFlight.clear();
      creationRequests.clear();
    },
  };
}
