import type { WorktreeRecord } from '../../../contract/index.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type { GitWorktreeInfo } from '../../types.js';
import type { RecoverWorktreesInput } from '../types.js';
import { pathExists } from '../support/paths.js';
import { recoveryError } from '../support/journal.js';
import { withShardLock } from '../support/locking.js';
import { resolveRepository, findExactWorktree, isExactCreatedWorktree } from '../support/inspection.js';
import { cleanLegacyObservations, assertRepositoryCompatible } from '../support/admission.js';
import { assertRecoverableCreatePath } from '../support/path-safety.js';
import { publishCreated, publishCleaned, clearPending, markRecovery } from '../support/publication.js';
import type { TransactionDependencies } from '../dependencies.js';
import { WorktreeProviderError, providerError } from '../../types.js';

export async function recoverWorktreeTransaction(
  dependencies: Pick<TransactionDependencies, 'dshHome' | 'git' | 'repositoryLock' | 'sidecar'>,
  input: RecoverWorktreesInput,
): Promise<void> {
  return withShardLock(dependencies, input.workspaceId, async (locked) => {
    await cleanLegacyObservations(locked);
    await dependencies.git.validateRepository(input.workspaceRoot);
    const repository = await resolveRepository(dependencies, input.workspaceRoot);
    return dependencies.repositoryLock.run(
      `repository:${createRepositoryFingerprint(repository.identity)}`,
      async (lock) => {
        lock.assertHeld();
        const gitRoot = repository.identity.topLevel;
        const current = await locked.read();
        assertRepositoryCompatible(current, repository.identity, input.workspaceId, true);
        const pending = current.pendingOperation;
        let live: readonly GitWorktreeInfo[];
        try {
          live = await dependencies.git.listWorktrees(gitRoot);
        } catch (inspectionError) {
          if (pending) await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to inspect Git during Worktree recovery`, {
            workspaceId: input.workspaceId,
            ...(pending ? { operationId: pending.id } : {}),
            cause: String(inspectionError),
          });
        }

        // Without a journal there is no interrupted mutation to recover. Missing
        // registrations remain runtime repair facts, including active records.
        if (!pending) return;
        const pendingFingerprint =
          pending.repositoryFingerprint ??
          (pending.repository ? createRepositoryFingerprint(pending.repository) : undefined);
        if (pendingFingerprint !== createRepositoryFingerprint(repository.identity)) {
          await markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
          throw providerError(
            'WORKTREE_IDENTITY_CHANGED',
            'Pending operation belongs to another repository',
            {
              workspaceId: input.workspaceId,
              operationId: pending.id,
            },
          );
        }

        if (pending.type === 'create-worktree') {
          try {
            await assertRecoverableCreatePath(dependencies, pending, input.workspaceRoot);
          } catch (error) {
            await markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
            if (error instanceof WorktreeProviderError) throw error;
            throw recoveryError(
              `Unable to validate the pending Worktree path: ${pending.targetPath}`,
              {
                workspaceId: input.workspaceId,
                operationId: pending.id,
                targetPath: pending.targetPath,
                cause: String(error),
              },
            );
          }
          const exact = await isExactCreatedWorktree(live, {
            workspaceId: input.workspaceId,
            workspaceRoot: input.workspaceRoot,
            targetPath: pending.targetPath,
            worktreeId: pending.worktreeId,
            baseBranch: pending.baseRef ?? pending.branch,
            newBranch: pending.baseRef !== undefined ? pending.branch : undefined,
            targetBranch: pending.branch,
          });
          if (exact) {
            const record: WorktreeRecord = {
              worktreeId: pending.worktreeId,
              workspaceId: input.workspaceId,
              absolutePath: pending.targetPath,
              branch: pending.branch,
              source: 'plugin',
              status: 'active',
            };
            await publishCreated(dependencies, locked, pending.id, record, repository.identity);
            return;
          }
          let branches: readonly string[];
          try {
            branches = await dependencies.git.listBranches(gitRoot);
          } catch (inspectionError) {
            await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
            throw recoveryError(`Unable to inspect branches during pending create recovery`, {
              workspaceId: input.workspaceId,
              operationId: pending.id,
              targetPath: pending.targetPath,
              cause: String(inspectionError),
            });
          }
          const ambiguousNewBranch =
            pending.baseRef !== undefined && branches.includes(pending.branch);
          let pendingTargetExists: boolean;
          try {
            pendingTargetExists = await pathExists(pending.targetPath);
          } catch (inspectionError) {
            await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
            throw recoveryError(
              `Unable to inspect the pending Worktree path: ${pending.targetPath}`,
              {
                workspaceId: input.workspaceId,
                operationId: pending.id,
                targetPath: pending.targetPath,
                cause: String(inspectionError),
              },
            );
          }
          if (!ambiguousNewBranch && !pendingTargetExists) {
            await clearPending(locked, pending.id);
            return;
          }
          await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to reconcile pending create: ${pending.targetPath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: pending.targetPath,
          });
        }

        const exact = await findExactWorktree(live, pending.targetPath, pending.branch);
        let pendingTargetExists: boolean;
        try {
          pendingTargetExists = await pathExists(pending.targetPath);
        } catch (inspectionError) {
          await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(
            `Unable to inspect the pending Worktree path: ${pending.targetPath}`,
            {
              workspaceId: input.workspaceId,
              operationId: pending.id,
              targetPath: pending.targetPath,
              cause: String(inspectionError),
            },
          );
        }
        if (
          pending.type === 'clean-worktree' &&
          pending.phase === 'recovery-needed' &&
          !exact &&
          !pendingTargetExists
        ) {
          throw recoveryError('Clean operation lacks sufficient completion evidence', {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            worktreeId: pending.worktreeId,
          });
        }
        if (!exact && !pendingTargetExists) {
          await publishCleaned(locked, pending.id, pending.worktreeId, repository.identity);
          return;
        }
        if (exact) {
          await clearPending(locked, pending.id);
          return;
        }
        await markRecovery(locked, pending, 'WORKTREE_IDENTITY_CHANGED');
        throw providerError(
          'WORKTREE_IDENTITY_CHANGED',
          `Unable to reconcile pending ${pending.type}: ${pending.targetPath}`,
          {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: pending.targetPath,
          },
        );
      },
    );
  });
}
