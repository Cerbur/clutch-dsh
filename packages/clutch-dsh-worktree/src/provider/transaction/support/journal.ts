import { randomUUID } from 'node:crypto';
import type { WorktreeRecord } from '../../../contract/index.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type {
  CleanWorktreePendingOperation,
  PendingOperation,
  RecoveryIssue,
  RepositoryIdentity,
} from '../../types.js';
import type {
  CreateWorktreeTransactionInput,
  RemoveWorktreeTransactionInput,
  CleanWorktreeTransactionInput,
} from '../types.js';
import { WorktreeProviderError, providerError } from '../../types.js';

export function removeRecoveryIssue(
  issues: readonly RecoveryIssue[] | undefined,
  operationId: string,
  worktreeId?: string,
): readonly RecoveryIssue[] {
  return (issues ?? []).filter(
    (issue) =>
      issue.operationId !== operationId &&
      (worktreeId === undefined || issue.worktreeId !== worktreeId),
  );
}

export function recoveryError(
  message: string,
  details: Record<string, string | number | readonly string[]> = {},
): WorktreeProviderError {
  return providerError('WORKTREE_RECOVERY_REQUIRED', message, details);
}

export function normalizeGitError(
  operation: string,
  workspaceRoot: string,
  targetPath: string,
  error: unknown,
): WorktreeProviderError {
  if (error instanceof WorktreeProviderError) return error;
  return providerError('GIT_OPERATION_FAILED', `Git ${operation} failed: ${String(error)}`, {
    operation,
    workspaceRoot,
    targetPath,
  });
}

export function recordForCreate(input: CreateWorktreeTransactionInput): WorktreeRecord {
  return {
    worktreeId: input.worktreeId,
    workspaceId: input.workspaceId,
    absolutePath: input.targetPath,
    branch: input.targetBranch,
    source: 'plugin',
    status: 'active',
  };
}

export function pendingCreate(
  input: CreateWorktreeTransactionInput,
  repository: RepositoryIdentity,
): PendingOperation {
  return {
    id: randomUUID(),
    type: 'create-worktree',
    phase: 'executing',
    workspaceId: input.workspaceId,
    worktreeId: input.worktreeId,
    targetPath: input.targetPath,
    branch: input.targetBranch,
    ...(input.newBranch !== undefined ? { baseRef: input.baseBranch } : {}),
    repositoryFingerprint: createRepositoryFingerprint(repository),
    startedAt: new Date().toISOString(),
  };
}

export function pendingRemove(
  input: RemoveWorktreeTransactionInput,
  record: WorktreeRecord,
  repository: RepositoryIdentity,
): PendingOperation {
  return {
    id: randomUUID(),
    type: 'remove-worktree',
    phase: 'executing',
    workspaceId: input.workspaceId,
    worktreeId: input.worktreeId,
    targetPath: record.absolutePath,
    branch: record.branch,
    source: record.source,
    repositoryFingerprint: createRepositoryFingerprint(repository),
    startedAt: new Date().toISOString(),
  };
}

export function pendingClean(
  input: CleanWorktreeTransactionInput,
  record: WorktreeRecord,
  repository: RepositoryIdentity,
): CleanWorktreePendingOperation {
  return {
    id: randomUUID(),
    type: 'clean-worktree',
    phase: 'executing',
    workspaceId: input.workspaceId,
    worktreeId: input.worktreeId,
    targetPath: record.absolutePath,
    branch: record.branch,
    source: record.source,
    repositoryFingerprint: createRepositoryFingerprint(repository),
    startedAt: new Date().toISOString(),
  };
}
