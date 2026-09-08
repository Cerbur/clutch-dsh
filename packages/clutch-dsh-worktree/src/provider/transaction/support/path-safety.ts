import path from 'node:path';
import { lstat } from 'node:fs/promises';
import type { WorktreeRecord } from '../../../contract/index.js';
import type { PendingOperation } from '../../types.js';
import type { CreateWorktreeTransactionInput } from '../types.js';
import { isMissing, isInside } from './paths.js';
import type { TransactionDependencies } from '../dependencies.js';
import { providerError } from '../../types.js';

export function assertGeneratedTarget(
  dependencies: Pick<TransactionDependencies, 'dshHome'>,
  input: CreateWorktreeTransactionInput,
): void {
  const generatedRoot = path.join(dependencies.dshHome, 'clutch-dsh-worktree', 'worktree');
  if (
    !path.isAbsolute(input.targetPath) ||
    !isInside(generatedRoot, input.targetPath) ||
    isInside(input.workspaceRoot, input.targetPath)
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
  const targetPath = path.resolve(record.absolutePath);
  if (record.source === 'plugin') {
    const generatedRoot = path.join(dependencies.dshHome, 'clutch-dsh-worktree', 'worktree');
    if (!isInside(generatedRoot, targetPath) || isInside(workspaceRoot, targetPath)) {
      throw providerError(
        'WORKTREE_IDENTITY_CHANGED',
        'Managed Worktree path moved outside its trusted root',
        {
          worktreeId: record.worktreeId,
          targetPath: record.absolutePath,
        },
      );
    }
    for (const trustedPath of [
      dependencies.dshHome,
      path.join(dependencies.dshHome, 'clutch-dsh-worktree'),
      generatedRoot,
      targetPath,
    ]) {
      await assertNotSymlink(trustedPath, record);
    }
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
  const targetPath = path.resolve(pending.targetPath);
  const generatedRoot = path.join(dependencies.dshHome, 'clutch-dsh-worktree', 'worktree');
  if (!isInside(generatedRoot, targetPath) || isInside(workspaceRoot, targetPath)) {
    throw providerError(
      'WORKTREE_IDENTITY_CHANGED',
      'Pending Worktree path moved outside its trusted root',
      {
        worktreeId: pending.worktreeId,
        targetPath: pending.targetPath,
      },
    );
  }
  const record: WorktreeRecord = {
    worktreeId: pending.worktreeId,
    workspaceId: pending.workspaceId,
    absolutePath: pending.targetPath,
    branch: pending.branch,
    source: 'plugin',
    status: 'active',
  };
  for (const trustedPath of [
    dependencies.dshHome,
    path.join(dependencies.dshHome, 'clutch-dsh-worktree'),
    generatedRoot,
    targetPath,
  ]) {
    await assertNotSymlink(trustedPath, record);
  }
}

export async function assertNotSymlink(pathname: string, record: WorktreeRecord): Promise<void> {
  try {
    if ((await lstat(pathname)).isSymbolicLink()) {
      throw providerError('WORKTREE_IDENTITY_CHANGED', `Worktree path is a symlink: ${pathname}`, {
        worktreeId: record.worktreeId,
        targetPath: record.absolutePath,
      });
    }
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}
