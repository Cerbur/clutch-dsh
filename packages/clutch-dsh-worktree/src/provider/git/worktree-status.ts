import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { GitWorktreeInfo } from '../types.js';

/** Runtime observation shared by managed health and import admission, never persisted. */
export type WorktreeRuntimeStatus =
  'ready' | 'missing' | 'prunable' | 'bare' | 'detached' | 'unavailable';

export async function readWorktreeStatus(
  worktree: GitWorktreeInfo | undefined,
): Promise<WorktreeRuntimeStatus> {
  if (!worktree) return 'missing';
  if (worktree.prunable) return 'prunable';
  if (worktree.bare) return 'bare';
  try {
    if (!(await stat(worktree.absolutePath)).isDirectory()) return 'missing';
    await stat(path.join(worktree.absolutePath, '.git'));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable';
  }
  if (worktree.detached || !worktree.branch) return 'detached';
  // A Git lock protects against removal/pruning, not reading or importing.
  return 'ready';
}
