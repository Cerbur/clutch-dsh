import path from 'node:path';
import type { WorktreeRecord } from '../../../contract/index.js';
import type { GitRepositoryInspection, GitWorktreeInfo, SidecarSnapshot } from '../../types.js';
import type { CreateWorktreeTransactionInput } from '../types.js';
import { canonicalPath, samePhysicalPath } from './paths.js';
import type { TransactionDependencies } from '../dependencies.js';

export async function resolveRepository(
  dependencies: Pick<TransactionDependencies, 'git'>,
  workspaceRoot: string,
): Promise<GitRepositoryInspection> {
  if (dependencies.git.resolveRepositoryIdentity)
    return dependencies.git.resolveRepositoryIdentity(workspaceRoot);
  const topLevel = dependencies.git.resolveRepositoryRoot
    ? await dependencies.git.resolveRepositoryRoot(workspaceRoot)
    : workspaceRoot;
  const canonicalTopLevel = await canonicalPath(topLevel);
  const commonDirectory = await canonicalPath(path.join(canonicalTopLevel, '.git'));
  return { identity: { topLevel: canonicalTopLevel, commonDirectory } };
}

export async function findActiveBranchConflict(
  dependencies: Pick<TransactionDependencies, 'git'>,
  snapshot: SidecarSnapshot,
  branch: string,
  gitRoot: string,
  worktreeId?: string,
): Promise<WorktreeRecord | undefined> {
  const candidates = snapshot.worktrees.filter(
    (record) =>
      record.status === 'active' && record.branch === branch && record.worktreeId !== worktreeId,
  );
  if (candidates.length === 0) return undefined;
  const live = await dependencies.git.listWorktrees(gitRoot);
  for (const candidate of candidates) {
    const actual = await findWorktreeByPhysicalPath(live, candidate.absolutePath);
    // Only positive evidence of a different live branch releases a stale claim.
    if (!actual || (!actual.detached && (!actual.branch || actual.branch === branch)))
      return candidate;
  }
  return undefined;
}

export async function findExactWorktree(
  worktrees: readonly GitWorktreeInfo[],
  targetPath: string,
  branch: string,
): Promise<GitWorktreeInfo | undefined> {
  for (const worktree of worktrees) {
    if (worktree.branch === branch && (await samePhysicalPath(worktree.absolutePath, targetPath)))
      return worktree;
  }
  return undefined;
}

export async function findWorktreeByPhysicalPath(
  worktrees: readonly GitWorktreeInfo[],
  targetPath: string,
): Promise<GitWorktreeInfo | undefined> {
  for (const worktree of worktrees) {
    if (await samePhysicalPath(worktree.absolutePath, targetPath)) return worktree;
  }
  return undefined;
}

export async function findSidecarWorktreeByPhysicalPath(
  worktrees: readonly WorktreeRecord[],
  targetPath: string,
): Promise<WorktreeRecord | undefined> {
  for (const worktree of worktrees) {
    if (await samePhysicalPath(worktree.absolutePath, targetPath)) return worktree;
  }
  return undefined;
}

export async function isExactCreatedWorktree(
  worktrees: readonly GitWorktreeInfo[],
  input: CreateWorktreeTransactionInput,
): Promise<boolean> {
  const exact = await findExactWorktree(worktrees, input.targetPath, input.targetBranch);
  return exact !== undefined && exact.detached !== true;
}
