import path from 'node:path';
import type { WorktreeRecord } from '../../../contract/index.js';
import { createRepositoryFingerprint } from '../../git/repository-fingerprint.js';
import type { ImportWorktreeTransactionInput } from '../types.js';
import { isDirectory, canonicalPath, samePhysicalPath } from '../support/paths.js';
import { withShardLock } from '../support/locking.js';
import {
  resolveRepository,
  findWorktreeByPhysicalPath,
  findSidecarWorktreeByPhysicalPath,
} from '../support/inspection.js';
import {
  cleanLegacyObservations,
  assertMutationAdmitted,
  assertRepositoryCompatible,
} from '../support/admission.js';
import type { TransactionDependencies } from '../dependencies.js';
import { providerError } from '../../types.js';

export async function importWorktreeTransaction(
  dependencies: Pick<TransactionDependencies, 'git' | 'repositoryLock' | 'sidecar'>,
  input: ImportWorktreeTransactionInput,
): Promise<WorktreeRecord> {
  if (!path.isAbsolute(input.absolutePath)) {
    throw providerError('WORKTREE_IMPORT_INVALID', 'An absolute Worktree path is required', {
      workspaceId: input.workspaceId,
      absolutePath: input.absolutePath,
    });
  }
  const requestedPath = path.resolve(input.absolutePath);
  if (!(await isDirectory(requestedPath))) {
    throw providerError(
      'WORKTREE_IMPORT_INVALID',
      `Worktree path is not a directory: ${requestedPath}`,
      {
        workspaceId: input.workspaceId,
        absolutePath: requestedPath,
      },
    );
  }

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

        return locked.mutate(async (snapshot) => {
          const repositoryFingerprint = createRepositoryFingerprint(repository.identity);
          const liveWorktree = await findWorktreeByPhysicalPath(
            await dependencies.git.listWorktrees(gitRoot),
            requestedPath,
          );
          if (
            !liveWorktree ||
            !liveWorktree.branch ||
            (await samePhysicalPath(liveWorktree.absolutePath, gitRoot))
          ) {
            throw providerError(
              'WORKTREE_IMPORT_INVALID',
              `Path is not an importable Worktree: ${requestedPath}`,
              {
                workspaceId: input.workspaceId,
                absolutePath: requestedPath,
              },
            );
          }

          const normalizedPath = await canonicalPath(liveWorktree.absolutePath);
          const existing = await findSidecarWorktreeByPhysicalPath(
            snapshot.worktrees,
            normalizedPath,
          );
          if (existing) {
            if (
              existing.status === 'active' &&
              existing.source === 'external' &&
              existing.workspaceId === input.workspaceId
            ) {
              return {
                result: existing,
                snapshot:
                  snapshot.repositoryFingerprint === repositoryFingerprint
                    ? snapshot
                    : { ...snapshot, repositoryFingerprint },
                changed:
                  snapshot.repositoryFingerprint === repositoryFingerprint ? false : undefined,
              };
            }
            throw providerError(
              'WORKTREE_ALREADY_MANAGED',
              `Worktree path is already managed: ${normalizedPath}`,
              {
                workspaceId: input.workspaceId,
                absolutePath: normalizedPath,
                worktreeId: existing.worktreeId,
                source: existing.source,
                status: existing.status,
              },
            );
          }
          if (snapshot.worktrees.some((candidate) => candidate.worktreeId === input.worktreeId)) {
            throw providerError(
              'SIDECAR_CORRUPT',
              `Generated Worktree ID is already recorded: ${input.worktreeId}`,
              {
                worktreeId: input.worktreeId,
              },
            );
          }
          const record: WorktreeRecord = {
            worktreeId: input.worktreeId,
            workspaceId: input.workspaceId,
            absolutePath: normalizedPath,
            branch: liveWorktree.branch,
            source: 'external',
            status: 'active',
          };
          return {
            result: record,
            snapshot: {
              ...snapshot,
              repositoryFingerprint,
              worktrees: [record, ...snapshot.worktrees],
            },
          };
        });
      },
    );
  }) as Promise<WorktreeRecord>;
}
