import { randomUUID } from 'node:crypto';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type { GitWorktreeInfo } from '../../types.js';
import type { RemoveWorktreeTransactionInput } from '../types.js';
import { pathExists, samePhysicalPath } from '../support/paths.js';
import { recoveryError, pendingRemove } from '../support/journal.js';
import { reconcileRemoveFailure } from '../recovery/failure-recovery.js';
import { withShardLock } from '../support/locking.js';
import { resolveRepository, findExactWorktree, findWorktreeByPhysicalPath } from '../support/inspection.js';
import {
  cleanLegacyObservations,
  assertMutationAdmitted,
  assertMutationToken,
  assertRepositoryCompatible,
} from '../support/admission.js';
import { assertSafeRemovalPath } from '../support/path-safety.js';
import { publishRemoved, markRecovery } from '../support/publication.js';
import type { TransactionDependencies } from '../dependencies.js';
import { providerError } from '../../types.js';

export async function removeWorktreeTransaction(
  dependencies: Pick<TransactionDependencies, 'dshHome' | 'git' | 'repositoryLock' | 'sidecar'>,
  input: RemoveWorktreeTransactionInput,
): Promise<void> {
  return withShardLock(dependencies, input.workspaceId, async (locked) => {
    await dependencies.git.validateRepository(input.workspaceRoot);
    const repository = await resolveRepository(dependencies, input.workspaceRoot);
    return dependencies.repositoryLock.run(
      `repository:${createRepositoryFingerprint(repository.identity)}`,
      async (lock) => {
        lock.assertHeld();
        const gitRoot = repository.identity.topLevel;
        await cleanLegacyObservations(locked);
        const current = await locked.read();
        assertMutationAdmitted(current, input.workspaceId);
        assertRepositoryCompatible(current, repository.identity, input.workspaceId);
        const record = current.worktrees.find(
          (candidate) => candidate.worktreeId === input.worktreeId,
        );
        if (!record) {
          throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
          });
        }
        if (record.status === 'removed') {
          throw providerError(
            'WORKTREE_REMOVED',
            `Worktree has already been removed: ${input.worktreeId}`,
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
            },
          );
        }
        assertMutationToken(current, record, input.mutationToken);
        if (await samePhysicalPath(record.absolutePath, gitRoot)) {
          throw providerError('WORKTREE_STATE_CONFLICT', 'The main Worktree cannot be removed', {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: record.absolutePath,
          });
        }

        const liveBefore = await dependencies.git.listWorktrees(gitRoot);
        const exactBefore = await findExactWorktree(liveBefore, record.absolutePath, record.branch);
        if (!exactBefore) {
          const pathRegistration = await findWorktreeByPhysicalPath(
            liveBefore,
            record.absolutePath,
          );
          const branchRegistration = liveBefore.find(
            (worktree) => worktree.branch === record.branch,
          );
          if (
            !pathRegistration &&
            !branchRegistration &&
            !(await pathExists(record.absolutePath))
          ) {
            // A legacy caller may have completed Git removal before the v3
            // journal was introduced. With no path or matching registration
            // left to delete, finalizing the relation is safe and idempotent.
            const pending = pendingRemove(input, record, repository.identity);
            await locked.mutate((snapshot) => {
              const { repository: _repository, ...withoutRepository } = snapshot;
              void _repository;
              return {
                result: undefined,
                snapshot: {
                  ...withoutRepository,
                  repositoryFingerprint: createRepositoryFingerprint(repository.identity),
                  pendingOperation: pending,
                },
              };
            });
            await publishRemoved(locked, pending.id, input.worktreeId, repository.identity);
            return;
          }
          await markRecovery(
            locked,
            {
              id: randomUUID(),
              type: 'remove-worktree',
              phase: 'recovery-needed',
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              targetPath: record.absolutePath,
              branch: record.branch,
              source: record.source,
              repositoryFingerprint: createRepositoryFingerprint(repository.identity),
              startedAt: new Date().toISOString(),
            },
            'WORKTREE_IDENTITY_CHANGED',
          );
          throw providerError(
            'WORKTREE_IDENTITY_CHANGED',
            `Worktree identity changed: ${record.absolutePath}`,
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              targetPath: record.absolutePath,
            },
          );
        }
        await assertSafeRemovalPath(dependencies, record, input.workspaceRoot);
        const pending = pendingRemove(input, record, repository.identity);
        await locked.mutate((snapshot) => {
          const { repository: _repository, ...withoutRepository } = snapshot;
          void _repository;
          return {
            result: undefined,
            snapshot: {
              ...withoutRepository,
              repositoryFingerprint: createRepositoryFingerprint(repository.identity),
              pendingOperation: pending,
            },
          };
        });

        try {
          await dependencies.git.removeWorktree(input.workspaceRoot, record.absolutePath);
        } catch (error) {
          return reconcileRemoveFailure(dependencies, {
            locked,
            input,
            record,
            pending,
            repository: repository.identity,
            gitRoot,
            error,
          });
        }

        lock.assertHeld();
        let liveAfter: readonly GitWorktreeInfo[];
        try {
          liveAfter = await dependencies.git.listWorktrees(gitRoot);
        } catch (inspectionError) {
          await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to verify Git after remove: ${record.absolutePath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: record.absolutePath,
            cause: String(inspectionError),
          });
        }
        if (await findExactWorktree(liveAfter, record.absolutePath, record.branch)) {
          await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(
            `Git remove did not remove the registered Worktree: ${record.absolutePath}`,
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              targetPath: record.absolutePath,
            },
          );
        }
        let targetExists: boolean;
        try {
          targetExists = await pathExists(record.absolutePath);
        } catch (inspectionError) {
          await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(
            `Unable to verify the removed Worktree path: ${record.absolutePath}`,
            {
              workspaceId: input.workspaceId,
              operationId: pending.id,
              targetPath: record.absolutePath,
              cause: String(inspectionError),
            },
          );
        }
        if (targetExists) {
          await markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
          throw providerError(
            'WORKTREE_IDENTITY_CHANGED',
            `Worktree path remains after Git removal: ${record.absolutePath}`,
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              targetPath: record.absolutePath,
            },
          );
        }
        await publishRemoved(locked, pending.id, input.worktreeId, repository.identity);
      },
    );
  });
}
