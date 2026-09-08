import type { WorktreeRecord } from '../../../contract/index.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type { GitWorktreeInfo } from '../../types.js';
import type { CreateWorktreeTransactionInput } from '../types.js';
import { pathExists } from '../support/paths.js';
import { recoveryError, recordForCreate, pendingCreate } from '../support/journal.js';
import { reconcileCreateFailure } from '../recovery/failure-recovery.js';
import { withShardLock } from '../support/locking.js';
import {
  resolveRepository,
  findActiveBranchConflict,
  isExactCreatedWorktree,
} from '../support/inspection.js';
import {
  cleanLegacyObservations,
  assertMutationAdmitted,
  assertRepositoryCompatible,
} from '../support/admission.js';
import { assertGeneratedTarget } from '../support/path-safety.js';
import { publishCreated, markRecovery } from '../support/publication.js';
import type { TransactionDependencies } from '../dependencies.js';
import { providerError } from '../../types.js';

export async function createWorktreeTransaction(
  dependencies: Pick<TransactionDependencies, 'dshHome' | 'git' | 'repositoryLock' | 'sidecar'>,
  input: CreateWorktreeTransactionInput,
): Promise<WorktreeRecord> {
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
        assertGeneratedTarget(dependencies, input);

        if (dependencies.git.listBranchesWithWorktreePaths) {
          const branches = await dependencies.git.listBranchesWithWorktreePaths(gitRoot);
          const baseBranch = branches.find((branch) => branch.name === input.baseBranch);
          if (!baseBranch) {
            throw providerError(
              'GIT_OPERATION_FAILED',
              `Local branch does not exist: ${input.baseBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.baseBranch,
              },
            );
          }
          if (
            input.newBranch !== undefined &&
            branches.some((branch) => branch.name === input.newBranch)
          ) {
            throw providerError(
              'WORKTREE_BRANCH_CONFLICT',
              `New branch already exists: ${input.newBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.newBranch,
                baseBranch: input.baseBranch,
              },
            );
          }
          if (
            branches.some(
              (branch) => branch.name === input.targetBranch && branch.worktreePath !== undefined,
            )
          ) {
            throw providerError(
              'WORKTREE_BRANCH_CONFLICT',
              `Branch is already checked out: ${input.targetBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.targetBranch,
                baseBranch: input.baseBranch,
              },
            );
          }
        } else {
          const branches = await dependencies.git.listBranches(gitRoot);
          if (!branches.includes(input.baseBranch)) {
            throw providerError(
              'GIT_OPERATION_FAILED',
              `Local branch does not exist: ${input.baseBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.baseBranch,
              },
            );
          }
          if (input.newBranch !== undefined && branches.includes(input.newBranch)) {
            throw providerError(
              'WORKTREE_BRANCH_CONFLICT',
              `New branch already exists: ${input.newBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.newBranch,
                baseBranch: input.baseBranch,
              },
            );
          }
          const gitWorktrees = await dependencies.git.listWorktrees(gitRoot);
          if (gitWorktrees.some((worktree) => worktree.branch === input.targetBranch)) {
            throw providerError(
              'WORKTREE_BRANCH_CONFLICT',
              `Branch is already checked out: ${input.targetBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.targetBranch,
                baseBranch: input.baseBranch,
              },
            );
          }
        }
        if (await pathExists(input.targetPath)) {
          throw providerError(
            'GIT_OPERATION_FAILED',
            `Generated Worktree path already exists: ${input.targetPath}`,
            {
              workspaceRoot: input.workspaceRoot,
              targetPath: input.targetPath,
              worktreeId: input.worktreeId,
            },
          );
        }
        if (current.worktrees.some((record) => record.worktreeId === input.worktreeId)) {
          throw providerError(
            'SIDECAR_CORRUPT',
            `Generated Worktree ID is already recorded: ${input.worktreeId}`,
            {
              worktreeId: input.worktreeId,
            },
          );
        }
        const sidecarConflict = await findActiveBranchConflict(
          dependencies,
          current,
          input.targetBranch,
          gitRoot,
        );
        if (sidecarConflict) {
          throw providerError(
            'WORKTREE_BRANCH_CONFLICT',
            `Branch is already recorded as active: ${input.targetBranch}`,
            {
              branch: input.targetBranch,
              worktreeId: sidecarConflict.worktreeId,
            },
          );
        }

        const record = recordForCreate(input);
        const pending = pendingCreate(input, repository.identity);
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
          await dependencies.git.createWorktree(
            input.workspaceRoot,
            input.targetPath,
            input.baseBranch,
            input.newBranch,
          );
        } catch (error) {
          return reconcileCreateFailure(dependencies, {
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
        let live: readonly GitWorktreeInfo[];
        try {
          live = await dependencies.git.listWorktrees(gitRoot);
        } catch (inspectionError) {
          await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(`Unable to verify Git after create: ${input.targetPath}`, {
            workspaceId: input.workspaceId,
            operationId: pending.id,
            targetPath: input.targetPath,
            cause: String(inspectionError),
          });
        }
        if (!(await isExactCreatedWorktree(live, input))) {
          await markRecovery(locked, pending, 'WORKTREE_RECOVERY_REQUIRED');
          throw recoveryError(
            `Git create completed without the expected Worktree: ${input.targetPath}`,
            {
              workspaceId: input.workspaceId,
              worktreeId: input.worktreeId,
              targetPath: input.targetPath,
            },
          );
        }
        await publishCreated(dependencies, locked, pending.id, record, repository.identity);
        return record;
      },
    );
  }) as Promise<WorktreeRecord>;
}
