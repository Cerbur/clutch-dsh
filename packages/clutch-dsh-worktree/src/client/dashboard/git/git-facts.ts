import type { WorktreeGitChangedFile } from '../../../contract/index.js';

/**
 * Shared Git-tab facts. These helpers stay free of React and DOM APIs so the
 * Dashboard's branch, Main, and line-total rules have one definition.
 */

/** Main (Local) Worktree ids never carry a Worktree-relative Git comparison. */
export function isMainWorktreeId(worktreeId: string): boolean {
  return worktreeId === 'main' || worktreeId.startsWith('main:');
}

/** Trim a branch value and drop empty strings. */
export function normalizeBranch(branch: string | undefined): string | undefined {
  const normalized = branch?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

/** A baseline equal to the current Worktree branch is not a usable default. */
export function normalizeBaselineBranch(
  value: string | undefined,
  currentBranch: string | undefined,
): string | undefined {
  const baseline = normalizeBranch(value);
  return baseline === undefined || baseline === currentBranch ? undefined : baseline;
}

export interface GitLineTotals {
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Sum the known text-file additions/deletions. Binary files have no line
 * counts, so they are ignored when a target also contains readable files;
 * binary-only targets remain explicitly unknown.
 */
export function sumLineTotals(files: readonly WorktreeGitChangedFile[]): GitLineTotals | undefined {
  let additions = 0;
  let deletions = 0;
  let knownFiles = 0;
  for (const file of files) {
    if (file.additions === undefined || file.deletions === undefined) continue;
    additions += file.additions;
    deletions += file.deletions;
    knownFiles += 1;
  }
  return files.length === 0 || knownFiles > 0 ? { additions, deletions } : undefined;
}
