import type { WorktreeRecord } from '../../contract/index.js';

/**
 * Dashboard-facing acquisition facts from the Worktree management record.
 *
 * Git's live worktree listing reports the current checkout, but it does not
 * reliably retain when a Worktree was acquired or which branch was selected as
 * its original base. Keep those historical facts separate from live Git
 * projections and leave missing facts unknown.
 */
export interface WorktreeAcquisitionFacts {
  readonly timestampKind: 'created' | 'imported';
  readonly timestamp?: string;
  readonly baseBranch?: string;
}

export function selectWorktreeAcquisitionFacts(
  record: Pick<WorktreeRecord, 'source' | 'createdAt' | 'importedAt' | 'baseBranch'>,
): WorktreeAcquisitionFacts {
  return {
    timestampKind: record.source === 'external' ? 'imported' : 'created',
    ...(record.source === 'external'
      ? record.importedAt === undefined
        ? {}
        : { timestamp: record.importedAt }
      : record.createdAt === undefined
        ? {}
        : { timestamp: record.createdAt }),
    ...(record.baseBranch === undefined ? {} : { baseBranch: record.baseBranch }),
  };
}
