import path from 'node:path';
import type { GitWorktreeInfo, SidecarSnapshot } from './types.js';
import { WorktreeProviderError } from './types.js';
import { pathEntryMissing, samePhysicalPath } from './transaction/support/paths.js';

/** Internal retry signal, emitted only before Git or journal mutation begins. */
export class GeneratedWorktreeNameCollision extends WorktreeProviderError {
  constructor(worktreeId: string, targetPath: string) {
    super('GIT_OPERATION_FAILED', 'Generated Worktree name is already occupied', {
      worktreeId,
      targetPath,
    });
  }
}

export async function assertGeneratedNameAvailable(
  worktreeId: string,
  targetPath: string,
  snapshot: SidecarSnapshot,
  worktrees: readonly GitWorktreeInfo[],
): Promise<void> {
  if (
    !(await pathEntryMissing(targetPath)) ||
    snapshot.worktrees.some(
      (record) =>
        record.worktreeId === worktreeId ||
        path.resolve(record.absolutePath) === path.resolve(targetPath),
    )
  ) {
    throw new GeneratedWorktreeNameCollision(worktreeId, targetPath);
  }
  // Retained records and prunable registrations still own their missing paths.
  for (const worktree of [...snapshot.worktrees, ...worktrees]) {
    if (
      (await samePhysicalPath(worktree.absolutePath, targetPath)) ||
      (path.basename(worktree.absolutePath).toLowerCase() ===
        path.basename(targetPath).toLowerCase() &&
        (await samePhysicalPath(path.dirname(worktree.absolutePath), path.dirname(targetPath))))
    ) {
      throw new GeneratedWorktreeNameCollision(worktreeId, targetPath);
    }
  }
}
