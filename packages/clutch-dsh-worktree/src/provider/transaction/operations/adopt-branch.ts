import path from 'node:path';
import type { AdoptWorktreeBranchInput } from '../../../contract/index.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import { pathEntryMissing, samePhysicalPath } from '../support/paths.js';
import { withShardLock } from '../support/locking.js';
import { resolveRepository, findWorktreeByPhysicalPath } from '../support/inspection.js';
import {
  assertMutationAdmitted,
  assertMutationToken,
  assertRepositoryCompatible,
} from '../support/admission.js';
import { assertSafeRemovalPath } from '../support/path-safety.js';
import type { TransactionDependencies } from '../dependencies.js';
import { providerError } from '../../types.js';

export async function adoptBranchWorktreeTransaction(
  dependencies: Pick<TransactionDependencies, 'dshHome' | 'git' | 'repositoryLock' | 'sidecar'>,
  input: AdoptWorktreeBranchInput & { readonly workspaceRoot: string },
): Promise<void> {
  return withShardLock(dependencies, input.workspaceId, async (locked) => {
    await dependencies.git.validateRepository(input.workspaceRoot);
    const repository = await resolveRepository(dependencies, input.workspaceRoot);
    return dependencies.repositoryLock.run(
      `repository:${createRepositoryFingerprint(repository.identity)}`,
      async (lock) => {
        lock.assertHeld();
        const current = await locked.read();
        assertMutationAdmitted(current, input.workspaceId);
        assertRepositoryCompatible(current, repository.identity, input.workspaceId);
        const record = current.worktrees.find(
          (candidate) => candidate.worktreeId === input.worktreeId,
        );
        if (!record)
          throw providerError('WORKTREE_NOT_FOUND', 'Worktree not found', {
            worktreeId: input.worktreeId,
          });
        assertMutationToken(current, record, input.mutationToken);
        if (
          record.diskCleanup === 'completed' ||
          typeof input.expectedBranch !== 'string' ||
          !input.expectedBranch
        ) {
          throw providerError(
            'WORKTREE_STATE_CONFLICT',
            'A live branch on an uncleaned Worktree is required',
            { worktreeId: input.worktreeId },
          );
        }
        await assertSafeRemovalPath(dependencies, record, input.workspaceRoot);
        const targetRepository = await resolveRepository(dependencies, record.absolutePath);
        if (
          !(await samePhysicalPath(
            targetRepository.identity.commonDirectory,
            repository.identity.commonDirectory,
          )) ||
          !(await samePhysicalPath(targetRepository.identity.topLevel, record.absolutePath)) ||
          (await samePhysicalPath(record.absolutePath, repository.identity.topLevel)) ||
          (await pathEntryMissing(path.join(record.absolutePath, '.git')))
        ) {
          throw providerError(
            'WORKTREE_IDENTITY_CHANGED',
            'Worktree repository or linked path changed',
            { worktreeId: input.worktreeId },
          );
        }
        const live = await dependencies.git.listWorktrees(repository.identity.topLevel);
        const actual = await findWorktreeByPhysicalPath(live, record.absolutePath);
        if (
          !actual ||
          actual.detached ||
          !actual.branch ||
          actual.branch !== input.expectedBranch
        ) {
          throw providerError(
            'WORKTREE_STATE_CONFLICT',
            'Git branch changed; refresh before confirming again',
            { worktreeId: input.worktreeId },
          );
        }
        lock.assertHeld();
        await locked.mutate((snapshot) => ({
          result: undefined,
          changed: record.branch !== actual.branch,
          snapshot: {
            ...snapshot,
            worktrees: snapshot.worktrees.map((candidate) =>
              candidate.worktreeId === record.worktreeId
                ? { ...candidate, branch: actual.branch! }
                : candidate,
            ),
          },
        }));
      },
    );
  });
}
