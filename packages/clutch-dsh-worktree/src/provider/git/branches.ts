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

/** Resolve exact refs or unambiguous legacy names; never let a new local ref steal a baseline. */
export function findBranchIdentity(
  branches: readonly GitBranchWorktreeInfo[],
  identity: string,
): GitBranchWorktreeInfo | undefined {
  const matches = branches.filter((branch) => identity.startsWith('refs/')
    ? branch.ref === identity
    : branch.name === identity || (branch.kind === 'remote' && 'remotes/' + branch.name === identity));
  if (matches.length > 1) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Baseline branch identity is ambiguous; select an exact branch ref', {
      baseBranch: identity,
      refs: matches.map((branch) => branch.ref ?? branch.name).join(', '),
    });
  }
  return matches[0];
}

/** Normalize remote aliases when writing new baseline facts; leave legacy local names compatible. */
export function canonicalBranchIdentity(branch: GitBranchWorktreeInfo, requested: string): string {
  return branch.kind === 'remote' ? branch.ref ?? requested : requested;
}
