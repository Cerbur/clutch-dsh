import { isWorktreeGitCommit, type WorktreeRecord } from '../../../contract/index.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type { GitWorktreeInfo } from '../../types.js';
import type { CreateWorktreeTransactionInput } from '../types.js';
import { assertGeneratedNameAvailable } from '../../generated-name.js';
import { recoveryError, recordForCreate, pendingCreate } from '../support/journal.js';
import { reconcileCreateFailure } from '../recovery/failure-recovery.js';
import { withShardLock } from '../support/locking.js';
import {
  resolveRepository,
  findActiveBranchConflict,
  findExactWorktree,
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
import { workspacePathInWorktree } from '../../worktree-path.js';
import { isSafeBranchName } from '../../git/branch-name.js';
import { assertLocalWorktreeBranch, localBranchExists } from '../../git/branches.js';

export async function createWorktreeTransaction(
  dependencies: Pick<TransactionDependencies, 'dshHome' | 'git' | 'repositoryLock' | 'sidecar'>,
  input: CreateWorktreeTransactionInput,
): Promise<WorktreeRecord> {
  if (input.baseBranch === undefined && (!isWorktreeGitCommit(input.baseCommit) || input.newBranch === undefined)) {
    throw providerError('GIT_OPERATION_FAILED', 'Commit-based creation requires a full Git hash and a new branch', {});
  }
  if ((input.baseBranch !== undefined && !isSafeBranchName(input.baseBranch)) ||
    (input.newBranch !== undefined && !isSafeBranchName(input.newBranch))) {
    throw providerError('GIT_OPERATION_FAILED', 'A valid branch short name is required', {});
  }
  let baseRef = input.baseCommit ?? input.baseBranch!;
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

        let existingGitWorktrees: readonly GitWorktreeInfo[] | undefined;
        if (dependencies.git.listBranchesWithWorktreePaths) {
          const branches = await dependencies.git.listBranchesWithWorktreePaths(gitRoot);
          const baseBranch = branches.find((branch) => branch.name === input.baseBranch);
          if (input.baseBranch !== undefined && !baseBranch) {
            throw providerError(
              'GIT_OPERATION_FAILED',
              `Branch does not exist: ${input.baseBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.baseBranch,
              },
            );
          }
          assertLocalWorktreeBranch(baseBranch, input.newBranch);
          baseRef = input.baseCommit ?? baseBranch?.ref ?? baseRef;
          if (
            input.newBranch !== undefined &&
            localBranchExists(branches, input.newBranch)
          ) {
            throw providerError(
              'WORKTREE_BRANCH_CONFLICT',
              `New branch already exists: ${input.newBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.newBranch,
                baseBranch: input.baseBranch ?? baseRef,
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
                baseBranch: input.baseBranch ?? baseRef,
              },
            );
          }
        } else {
          const branches = await dependencies.git.listBranches(gitRoot);
          if (input.baseBranch !== undefined && !branches.includes(input.baseBranch)) {
            throw providerError(
              'GIT_OPERATION_FAILED',
              `Branch does not exist: ${input.baseBranch}`,
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
                baseBranch: input.baseBranch ?? baseRef,
              },
            );
          }
          existingGitWorktrees = await dependencies.git.listWorktrees(gitRoot);
          if (existingGitWorktrees.some((worktree) => worktree.branch === input.targetBranch)) {
            throw providerError(
              'WORKTREE_BRANCH_CONFLICT',
              `Branch is already checked out: ${input.targetBranch}`,
              {
                workspaceRoot: input.workspaceRoot,
                branch: input.targetBranch,
                baseBranch: input.baseBranch ?? baseRef,
              },
            );
          }
        }
        await assertGeneratedNameAvailable(
          input.worktreeId,
          input.targetPath,
          current,
          existingGitWorktrees ?? (await dependencies.git.listWorktrees(gitRoot)),
        );
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

        // Capture the branch's current commit before Git creates the linked
        // Worktree. The capture is authoritative: the post-create inspection below
        // only fills the acquisition commit when the adapter could not resolve it,
        // so a Worktree that already advanced past its creation point is never
        // recorded as its own baseline.
        const capturedBaseCommit = dependencies.git.resolveCommit
          ? await dependencies.git.resolveCommit(gitRoot, baseRef)
          : input.baseCommit;
        const transactionInput = {
          ...input,
          workspacePath: await workspacePathInWorktree(
            input.workspaceRoot,
            gitRoot,
            input.targetPath,
          ),
          ...(capturedBaseCommit === undefined ? {} : { baseCommit: capturedBaseCommit }),
        };
        const record = recordForCreate(transactionInput);
        const pending = pendingCreate(transactionInput, repository.identity);
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
            input.newBranch === undefined
              ? input.baseBranch!
              : (capturedBaseCommit ?? baseRef),
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
        const exact = await findExactWorktree(live, input.targetPath, input.targetBranch);
        if (!exact || exact.detached === true) {
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
        const publishedRecord =
          record.baseCommit !== undefined || exact.headCommit === undefined
            ? record
            : { ...record, baseCommit: exact.headCommit };
        await publishCreated(
          dependencies,
          locked,
          pending.id,
          publishedRecord,
          repository.identity,
        );
        return publishedRecord;
      },
    );
  }) as Promise<WorktreeRecord>;
}
