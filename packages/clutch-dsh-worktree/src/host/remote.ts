import {
  WORKTREE_ERROR_CODES,
  createWorktreeError,
  type WorktreeError,
  type WorktreeManager,
  type WorktreeRemoteManager,
  type WorktreeRemoteResult,
} from '../contract/index.js';

const worktreeErrorCodes = new Set<string>(WORKTREE_ERROR_CODES);

function isWorktreeError(error: unknown): error is WorktreeError {
  if (typeof error !== 'object' || error === null || Array.isArray(error)) return false;
  const candidate = error as Partial<WorktreeError>;
  return (
    typeof candidate.code === 'string' &&
    worktreeErrorCodes.has(candidate.code) &&
    typeof candidate.message === 'string' &&
    typeof candidate.details === 'object' &&
    candidate.details !== null &&
    !Array.isArray(candidate.details)
  );
}

async function project<Value>(operation: () => Promise<Value>): Promise<WorktreeRemoteResult<Value>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    if (!isWorktreeError(error)) throw error;
    return {
      ok: false,
      error: createWorktreeError(error.code, error.message, error.details),
    };
  }
}

/** Project Manage operations into plain JSON values for DSH's generated Remote boundary. */
export function createWorktreeRemoteProjection(manager: WorktreeManager): WorktreeRemoteManager {
  return {
    listWorktrees: (input) => project(() => manager.listWorktrees(input)),
    listBranches: (input) => project(() => manager.listBranches(input)),
    createWorktree: (input) => project(() => manager.createWorktree(input)),
    removeWorktree: (input) =>
      project(async () => {
        await manager.removeWorktree(input);
        return null;
      }),
    listBindings: (input) => project(() => manager.listBindings(input)),
    bindSession: (input) => project(() => manager.bindSession(input)),
  };
}
