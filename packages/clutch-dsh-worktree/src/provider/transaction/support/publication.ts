import type { WorktreeRecord } from '../../../contract/index.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type { LockedSidecarStore, PendingOperation, RepositoryIdentity } from '../../types.js';
import { completeWorktreeCleanup } from '../../worktree-lifecycle.js';
import { removeRecoveryIssue, recoveryError } from './journal.js';
import { findActiveBranchConflict } from './inspection.js';
import type { TransactionDependencies } from '../dependencies.js';

export async function publishCreated(
  dependencies: Pick<TransactionDependencies, 'git'>,
  locked: LockedSidecarStore,
  operationId: string,
  record: WorktreeRecord,
  repository: RepositoryIdentity,
): Promise<void> {
  await locked.mutate(async (snapshot) => {
    const existing = snapshot.worktrees.find(
      (candidate) => candidate.worktreeId === record.worktreeId,
    );
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) {
      throw recoveryError(
        `Pending create conflicts with existing Worktree record: ${record.worktreeId}`,
        {
          worktreeId: record.worktreeId,
          operationId,
        },
      );
    }
    const conflict = await findActiveBranchConflict(
      dependencies,
      snapshot,
      record.branch,
      repository.topLevel,
      record.worktreeId,
    );
    if (conflict) {
      throw recoveryError(`Pending create conflicts with active branch: ${record.branch}`, {
        worktreeId: record.worktreeId,
        operationId,
      });
    }
    const recoveryIssues = removeRecoveryIssue(
      snapshot.recoveryIssues,
      operationId,
      record.worktreeId,
    );
    const { repository: _repository, recoveryIssues: _oldRecovery, ...stableFields } = snapshot;
    void _repository;
    void _oldRecovery;
    return {
      result: undefined,
      snapshot: {
        ...stableFields,
        repositoryFingerprint: createRepositoryFingerprint(repository),
        worktrees: existing ? snapshot.worktrees : [record, ...snapshot.worktrees],
        pendingOperation: undefined,
        ...(recoveryIssues.length > 0 ? { recoveryIssues } : {}),
      },
    };
  });
}

export async function publishCleaned(
  locked: LockedSidecarStore,
  operationId: string,
  worktreeId: string,
  repository: RepositoryIdentity,
): Promise<void> {
  await locked.mutate((snapshot) => {
    const recoveryIssues = removeRecoveryIssue(snapshot.recoveryIssues, operationId, worktreeId);
    const { repository: _repository, recoveryIssues: _oldRecovery, ...stableFields } = snapshot;
    void _repository;
    void _oldRecovery;
    const cleaned = completeWorktreeCleanup(
      {
        ...stableFields,
        repositoryFingerprint: createRepositoryFingerprint(repository),
        pendingOperation: undefined,
        ...(recoveryIssues.length > 0 ? { recoveryIssues } : {}),
      },
      worktreeId,
    );
    return {
      result: undefined,
      snapshot: cleaned,
    };
  });
}

export async function publishRemoved(
  locked: LockedSidecarStore,
  operationId: string,
  worktreeId: string,
  repository: RepositoryIdentity,
): Promise<void> {
  return publishCleaned(locked, operationId, worktreeId, repository);
}

export async function clearPending(locked: LockedSidecarStore, operationId: string): Promise<void> {
  await locked.mutate((snapshot) => {
    const recoveryIssues = removeRecoveryIssue(snapshot.recoveryIssues, operationId);
    const { repository: _repository, recoveryIssues: _oldRecovery, ...stableFields } = snapshot;
    void _repository;
    void _oldRecovery;
    return {
      result: undefined,
      snapshot: {
        ...stableFields,
        pendingOperation: undefined,
        ...(recoveryIssues.length > 0 ? { recoveryIssues } : {}),
      },
    };
  });
}

export async function markRecovery(
  locked: LockedSidecarStore,
  pending: PendingOperation,
  code: 'WORKTREE_RECOVERY_REQUIRED' | 'WORKTREE_IDENTITY_CHANGED',
): Promise<void> {
  await locked.mutate((snapshot) => ({
    result: undefined,
    snapshot: {
      ...snapshot,
      pendingOperation: { ...pending, phase: 'recovery-needed' },
      recoveryIssues: [
        ...(snapshot.recoveryIssues ?? []).filter((issue) => issue.operationId !== pending.id),
        {
          code,
          operationId: pending.id,
          worktreeId: pending.worktreeId,
          observedAt: new Date().toISOString(),
        },
      ],
    },
  }));
}
