import type {
  BranchRecord,
  SessionBinding,
  WorktreeManager,
  WorktreeRecord,
} from '../contract/index.js';

export interface WorktreeViewData {
  readonly worktrees: readonly WorktreeRecord[];
  readonly branches: readonly BranchRecord[];
  readonly bindings: readonly SessionBinding[];
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
    }
  | {
      readonly type: 'bindSession';
      readonly input: Parameters<WorktreeManager['bindSession']>[0];
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
  await manager.bindSession(action.input);
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
