import { gitWorktreeRoot } from '../../../contract/index.js';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import type { WorktreeRecord } from '../../../contract/index.js';
import type { PendingOperation } from '../../types.js';
import type { CreateWorktreeTransactionInput } from '../types.js';
import { isMissing } from './paths.js';
import { assertGeneratedPath, generatedPathAncestors } from '../../generated-path.js';
import type { TransactionDependencies } from '../dependencies.js';
import { providerError } from '../../types.js';

export function assertGeneratedTarget(
  dependencies: Pick<TransactionDependencies, 'dshHome'>,
  input: CreateWorktreeTransactionInput,
): void {
  if (
    !path.isAbsolute(input.targetPath) ||
    !generatedPathAncestors(dependencies.dshHome, input.workspaceRoot, input.targetPath)
  ) {
    throw providerError(
      'WORKTREE_STATE_CONFLICT',
      'Generated Worktree path is outside the managed boundary',
      {
        workspaceId: input.workspaceId,
        targetPath: input.targetPath,
      },
    );
  }
}

export async function assertSafeRemovalPath(
  dependencies: Pick<TransactionDependencies, 'dshHome'>,
  record: WorktreeRecord,
  workspaceRoot: string,
): Promise<void> {
  const targetPath = path.resolve(gitWorktreeRoot(record));
  if (record.source === 'plugin') {
    await assertGeneratedPath(dependencies.dshHome, workspaceRoot, targetPath);
    return;
  }

  // Imported records are canonicalized at registration time. Refusing a
  // symlink here prevents a later path replacement from redirecting Git's
  // destructive command to an unrelated directory.
  await assertNotSymlink(targetPath, record);
}

export async function assertRecoverableCreatePath(
  dependencies: Pick<TransactionDependencies, 'dshHome'>,
  pending: Extract<PendingOperation, { readonly type: 'create-worktree' }>,
  workspaceRoot: string,
): Promise<void> {
  await assertGeneratedPath(dependencies.dshHome, workspaceRoot, path.resolve(pending.targetPath));
}

export async function assertNotSymlink(pathname: string, record: WorktreeRecord): Promise<void> {
  try {
    if ((await lstat(pathname)).isSymbolicLink()) {
      throw providerError('WORKTREE_IDENTITY_CHANGED', `Worktree path is a symlink: ${pathname}`, {
        worktreeId: record.worktreeId,
        targetPath: gitWorktreeRoot(record),
      });
    }
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}
