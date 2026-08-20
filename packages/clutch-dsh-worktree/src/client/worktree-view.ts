import type {
  BranchRecord,
  SessionBinding,
  WorktreeManager,
  WorktreeRecord,
} from '../contract/index.js';

/** A DSH Session exists even when the external Worktree binding needs repair. */
export class WorktreeSessionBindingError extends Error {
  readonly code = 'SESSION_BINDING_FAILED';
  readonly retryable = true;
  readonly sessionId: string;
  readonly cause: unknown;

  constructor(sessionId: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Session ${sessionId} was created, but Worktree binding failed: ${reason}`);
    this.name = 'WorktreeSessionBindingError';
    this.sessionId = sessionId;
    this.cause = cause;
  }
}

export interface WorktreeViewData {
  readonly worktrees: readonly WorktreeRecord[];
  readonly branches: readonly BranchRecord[];
  readonly bindings: readonly SessionBinding[];
}

export interface WorktreeWorkspaceView extends WorktreeViewData {
  readonly workspaceId: string;
}

export interface CreateSessionForWorktreeInput {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly cwd: string;
}

export interface WorktreeViewError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

export type WorktreeViewAction =
  | {
      readonly type: 'createWorktree';
      readonly input: Parameters<WorktreeManager['createWorktree']>[0];
    }
  | {
      readonly type: 'removeWorktree';
      readonly input: Parameters<WorktreeManager['removeWorktree']>[0];
    };

/** Read all three Worktree projections needed by the surface in one refresh. */
export async function loadWorktreeView(
  manager: WorktreeManager,
  workspaceId: string,
): Promise<WorktreeViewData> {
  const [worktrees, branches, bindings] = await Promise.all([
    manager.listWorktrees({ workspaceId }),
    manager.listBranches({ workspaceId }),
    manager.listBindings({ workspaceId }),
  ]);
  return { worktrees, branches, bindings };
}

/** Load one independent projection per DSH Workspace for the flat sidebar hierarchy. */
export async function loadWorktreeViews(
  manager: WorktreeManager,
  workspaceIds: readonly string[],
): Promise<readonly WorktreeWorkspaceView[]> {
  return Promise.all(
    workspaceIds.map(async (workspaceId) => ({
      workspaceId,
      ...(await loadWorktreeView(manager, workspaceId)),
    })),
  );
}

/** Keep mutation routing in the browser Consumer while leaving wire details to the adapter. */
export async function executeWorktreeAction(
  manager: WorktreeManager,
  action: WorktreeViewAction,
): Promise<void> {
  if (action.type === 'createWorktree') {
    await manager.createWorktree(action.input);
    return;
  }
  if (action.type === 'removeWorktree') {
    await manager.removeWorktree(action.input);
    return;
  }
}

/**
 * Create a normal DSH Session at a Worktree cwd, then add the external binding.
 * A binding failure deliberately leaves the DSH-created Session intact.
 */
export async function createSessionForWorktree(input: CreateSessionForWorktreeInput & {
  readonly createSession: (input: { cwd: string }) => Promise<string>;
  readonly manager: Pick<WorktreeManager, 'bindSession'>;
  readonly openSession: (sessionId: string) => void;
}): Promise<string> {
  const sessionId = await input.createSession({ cwd: input.cwd });
  try {
    await input.manager.bindSession({
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      sessionId,
    });
  } catch (error) {
    throw new WorktreeSessionBindingError(sessionId, error);
  }
  input.openSession(sessionId);
  return sessionId;
}

/** Convert any adapter/Gateway failure into renderable, retry-aware UI data. */
export function toWorktreeViewError(error: unknown): WorktreeViewError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as {
      readonly code?: unknown;
      readonly message?: unknown;
      readonly retryable?: unknown;
    };
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'WORKTREE_VIEW_FAILED',
      message:
        typeof candidate.message === 'string'
          ? candidate.message
          : 'Worktree data is unavailable. Retry the request.',
      retryable: candidate.retryable !== false,
    };
  }
  return {
    code: 'WORKTREE_VIEW_FAILED',
    message: 'Worktree data is unavailable. Retry the request.',
    retryable: true,
  };
}
