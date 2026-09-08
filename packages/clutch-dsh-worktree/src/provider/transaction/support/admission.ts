import type { WorktreeRecord } from '../../../contract/index.js';
import { createWorktreeMutationToken } from '../../mutation-token.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type {
  LockedSidecarStore,
  RecoveryIssue,
  RepositoryIdentity,
  SidecarSnapshot,
} from '../../types.js';
import { sameRepository } from './paths.js';
import { recoveryError } from './journal.js';
import { providerError } from '../../types.js';

/** Only legacy observations of known, uncleaned records may be retired. */
function recoveryBlocker(worktrees: readonly WorktreeRecord[]): (issue: RecoveryIssue) => boolean {
  const records = new Map<string, WorktreeRecord>();
  for (const record of worktrees) {
    // Preserve the previous first-match lookup even for an injected legacy store.
    if (!records.has(record.worktreeId)) records.set(record.worktreeId, record);
  }
  return (issue) => {
    const record = issue.worktreeId === undefined ? undefined : records.get(issue.worktreeId);
    return !(
      issue.operationId === undefined &&
      issue.code === 'WORKTREE_RECOVERY_REQUIRED' &&
      record !== undefined &&
      record.diskCleanup !== 'completed'
    );
  };
}

export async function cleanLegacyObservations(locked: LockedSidecarStore): Promise<void> {
  const snapshot = await locked.read();
  if (
    snapshot.pendingOperation !== undefined ||
    !snapshot.recoveryIssues ||
    snapshot.recoveryIssues.length === 0
  ) {
    return;
  }
  const remainingIssues = snapshot.recoveryIssues.filter(recoveryBlocker(snapshot.worktrees));
  if (remainingIssues.length !== snapshot.recoveryIssues.length) {
    await locked.mutate((current) => {
      const { repository: _repository, recoveryIssues: _oldRecovery, ...stableFields } = current;
      void _repository;
      void _oldRecovery;
      return {
        result: undefined,
        changed: true,
        snapshot: {
          ...stableFields,
          ...(remainingIssues.length > 0 ? { recoveryIssues: remainingIssues } : {}),
        },
      };
    });
  }
}

export function assertMutationAdmitted(snapshot: SidecarSnapshot, workspaceId: string): void {
  if (snapshot.pendingOperation) {
    throw recoveryError(
      `Workspace has a pending Worktree operation: ${snapshot.pendingOperation.id}`,
      {
        workspaceId,
        operationId: snapshot.pendingOperation.id,
      },
    );
  }
  if (snapshot.recoveryIssues && snapshot.recoveryIssues.length > 0) {
    if (snapshot.recoveryIssues.some(recoveryBlocker(snapshot.worktrees))) {
      throw recoveryError(`Workspace has unresolved Worktree recovery issues: ${workspaceId}`, {
        workspaceId,
      });
    }
  }
}

export function assertMutationToken(
  snapshot: Pick<SidecarSnapshot, 'schemaVersion' | 'workspaceId' | 'revision'>,
  record: WorktreeRecord,
  token: string | undefined,
): void {
  const expected = createWorktreeMutationToken(snapshot, record);
  if (token === undefined || token !== expected) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Worktree state changed after it was loaded', {
      workspaceId: record.workspaceId,
      worktreeId: record.worktreeId,
    });
  }
}

export function assertRepositoryCompatible(
  snapshot: SidecarSnapshot,
  identity: RepositoryIdentity,
  workspaceId: string,
  allowMissing = false,
): void {
  const actualFingerprint = createRepositoryFingerprint(identity);
  if (snapshot.repositoryFingerprint && snapshot.repositoryFingerprint !== actualFingerprint) {
    throw providerError('WORKTREE_IDENTITY_CHANGED', 'Workspace repository identity changed', {
      workspaceId,
      expectedFingerprint: snapshot.repositoryFingerprint,
      actualFingerprint,
    });
  }
  if (snapshot.repository && !sameRepository(snapshot.repository, identity)) {
    throw providerError('WORKTREE_IDENTITY_CHANGED', 'Workspace repository identity changed', {
      workspaceId,
      expectedCommonDirectory: snapshot.repository.commonDirectory,
      actualCommonDirectory: identity.commonDirectory,
    });
  }
  if (!allowMissing && !identity.commonDirectory) {
    throw providerError(
      'WORKTREE_IDENTITY_CHANGED',
      'Unable to resolve Workspace repository identity',
      { workspaceId },
    );
  }
}
