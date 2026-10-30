import type { WorktreeRecord } from '../../contract/index.js';
import { isMainWorktreeId } from './dashboard-selection.js';
import { toWorktreeViewError, type WorktreeViewError } from '../view/worktree-view.js';

export type BatchWorktreeAction = 'archive' | 'clean' | 'forget';
export interface BatchWorktreeResult {
  readonly record: WorktreeRecord;
  readonly error?: WorktreeViewError;
}

export function sameBatchTarget(current: WorktreeRecord, confirmed: WorktreeRecord): boolean {
  return (['workspaceId', 'worktreeId', 'absolutePath', 'gitRootPath', 'branch', 'source', 'status', 'diskCleanup', 'baseCommit'] as const)
    .every((key) => current[key] === confirmed[key]);
}

export function canManageWorktree(record: WorktreeRecord, action: BatchWorktreeAction): boolean {
  if (isMainWorktreeId(record.worktreeId) || !record.mutationToken || record.health === 'recovery-needed') return false;
  if (action === 'archive') return record.status === 'active';
  if (action === 'clean') return record.status === 'removed' && record.diskCleanup !== 'completed' && record.health !== 'branch-drift';
  return record.status === 'removed';
}

/** Freeze confirmed identities; each Host call still validates its mutation token. */
export async function runWorktreeBatch(
  action: BatchWorktreeAction,
  records: readonly WorktreeRecord[],
  execute: (action: BatchWorktreeAction, record: WorktreeRecord, isCurrent: () => boolean) => Promise<void>,
  isCurrent: () => boolean,
  onResult: (result: BatchWorktreeResult) => void,
): Promise<void> {
  for (const record of records) {
    if (!isCurrent()) break;
    try {
      if (!canManageWorktree(record, action)) throw { code: 'WORKTREE_STATE_CONFLICT', retryable: true };
      await execute(action, record, isCurrent);
      if (isCurrent()) onResult({ record });
    } catch (error) {
      if (isCurrent()) onResult({ record, error: toWorktreeViewError(error) });
    }
  }
}
