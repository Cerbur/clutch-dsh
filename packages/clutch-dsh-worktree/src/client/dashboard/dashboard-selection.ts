import type { WorktreeRecord } from '../../contract/index.js';

/** Navigation identity only; the ready view remains the source of display facts. */
export interface DashboardSelection {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string | undefined;
}

export function resolveDashboardRecord(
  selection: DashboardSelection | undefined,
  mode: string,
  currentSessionId: string | undefined,
  workspaceIds: readonly string[],
  records: readonly WorktreeRecord[] | undefined,
): WorktreeRecord | undefined {
  if (
    selection === undefined ||
    mode !== 'worktree' ||
    selection.sessionId !== currentSessionId ||
    !workspaceIds.includes(selection.workspaceId)
  )
    return undefined;
  return records?.find(
    (record) =>
      record.workspaceId === selection.workspaceId && record.worktreeId === selection.worktreeId,
  );
}

