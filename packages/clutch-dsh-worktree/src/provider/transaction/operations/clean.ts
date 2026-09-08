import path from 'node:path';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type { GitWorktreeInfo } from '../../types.js';
import { completeWorktreeCleanup } from '../../worktree-lifecycle.js';
import type { CleanWorktreeTransactionInput } from '../types.js';
import { pathExists, pathEntryMissing, samePhysicalPath } from '../support/paths.js';
import { recoveryError, pendingClean } from '../support/journal.js';
import { reconcileCleanFailure } from '../recovery/failure-recovery.js';
import { withShardLock } from '../support/locking.js';
import { resolveRepository, findExactWorktree, findWorktreeByPhysicalPath } from '../support/inspection.js';
import {
  cleanLegacyObservations,
  assertMutationAdmitted,
  assertMutationToken,
  assertRepositoryCompatible,
} from '../support/admission.js';
import { assertSafeRemovalPath } from '../support/path-safety.js';
import { publishCleaned, markRecovery } from '../support/publication.js';
import type { TransactionDependencies } from '../dependencies.js';
import { providerError } from '../../types.js';

export async function cleanWorktreeTransaction(
  dependencies: Pick<TransactionDependencies, 'dshHome' | 'git' | 'repositoryLock' | 'sidecar'>,
  input: CleanWorktreeTransactionInput,
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
        if (record.status === 'active') {
          throw providerError(
            'WORKTREE_STATE_CONFLICT',
            'Worktree must be archived before cleaning disk',
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
            },
          );
        }
        assertMutationToken(current, record, input.mutationToken);
        if (record.diskCleanup === 'completed') {
          return;
        }
        if (await samePhysicalPath(record.absolutePath, gitRoot)) {
          throw providerError('WORKTREE_STATE_CONFLICT', 'The main Worktree cannot be cleaned', {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            targetPath: record.absolutePath,
          });
        }

        const liveBefore = await dependencies.git.listWorktrees(gitRoot);
        const exactBefore = await findExactWorktree(liveBefore, record.absolutePath, record.branch);
        await assertSafeRemovalPath(dependencies, record, input.workspaceRoot);
        if (await pathEntryMissing(path.join(record.absolutePath, '.git'))) {
          const pathRegistration = await findWorktreeByPhysicalPath(
            liveBefore,
            record.absolutePath,
          );
          if (pathRegistration && !exactBefore) {
            throw providerError(
              'WORKTREE_IDENTITY_CHANGED',
              'Missing Worktree path has a different Git registration',
              {
                workspaceId: input.workspaceId,
                worktreeId: input.worktreeId,
                targetPath: record.absolutePath,
              },
            );
          }
          // An absent directory or .git entry is already removed as a Worktree.
          // Preserve residual files and registration; only reconcile the sidecar.
          lock.assertHeld();
          await locked.mutate((snapshot) => {
            const { repository: _repository, ...stableFields } = snapshot;
            void _repository;
            return {
              result: undefined,
              snapshot: completeWorktreeCleanup(
                {
                  ...stableFields,
                  repositoryFingerprint: createRepositoryFingerprint(repository.identity),
                },
                record.worktreeId,
              ),
            };
          });
          return;
        }
        if (!exactBefore) {
          throw providerError(
            'WORKTREE_IDENTITY_CHANGED',
            `Worktree is not registered in Git: ${record.absolutePath}`,
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              targetPath: record.absolutePath,
            },
          );
        }

        const pending = pendingClean(input, record, repository.identity);
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
          return reconcileCleanFailure(dependencies, {
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
          throw recoveryError(`Unable to verify Git after clean: ${record.absolutePath}`, {
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
            `Unable to verify the cleaned Worktree path: ${record.absolutePath}`,
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
        try {
          await publishCleaned(locked, pending.id, input.worktreeId, repository.identity);
        } catch (error) {
          const sidecarError = error instanceof Error ? error : new Error(String(error));
          throw providerError(
            'SIDECAR_SYNC_REQUIRED',
            `Git removed Worktree ${input.worktreeId}, but sidecar synchronization failed`,
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              workspaceRoot: input.workspaceRoot,
              sidecarError: sidecarError.message,
            },
          );
        }
      },
    );
  });
}
