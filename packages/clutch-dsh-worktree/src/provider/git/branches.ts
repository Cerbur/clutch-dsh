import type { GitBranchWorktreeInfo, GitCommandOptions, GitWorktreeAdapter } from '../types.js';
import { providerError } from '../types.js';

/** Old injected adapters expose local short names only. */
export async function readBranchFacts(
  git: GitWorktreeAdapter,
  root: string,
  options: GitCommandOptions = {},
): Promise<readonly GitBranchWorktreeInfo[]> {
  if (git.listBranchesWithWorktreePaths) return git.listBranchesWithWorktreePaths(root, options);
  return (await git.listBranches(root, options)).map((name) => ({ name }));
}

/** A remote-tracking ref cannot be the checked-out branch of a managed Worktree. */
export function assertLocalWorktreeBranch(
  base: GitBranchWorktreeInfo | undefined,
  newBranch: string | undefined,
): void {
  if (base?.kind === 'remote' && newBranch === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'A remote base branch requires a new local branch', {
      baseBranch: base.name,
    });
  }
}

export function localBranchExists(branches: readonly GitBranchWorktreeInfo[], name: string): boolean {
  return branches.some((branch) => branch.kind !== 'remote' &&
    (branch.ref === undefined ? branch.name === name : branch.ref === 'refs/heads/' + name));
}
