import type { WorktreeRecord } from '../../contract/index.js';

/** Navigation identity only; the ready view remains the source of display facts. */
export interface DashboardSelection {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string | undefined;
}

export function isMainWorktreeId(worktreeId: string): boolean {
  return worktreeId === 'main' || worktreeId.startsWith('main:');
}

export function createMainWorktreeRecord(
  workspace: { readonly workspaceId: string; readonly path: string },
  currentBranch?: string | null,
): WorktreeRecord {
  const branchName = currentBranch ?? 'main';
  return {
    worktreeId: `main:${workspace.workspaceId}`,
    workspaceId: workspace.workspaceId,
    branch: branchName,
    currentBranch: currentBranch ?? null,
    absolutePath: workspace.path,
    status: 'active',
    source: 'plugin',
    health: 'ready',
  };
}

export function resolveDashboardRecord(
  selection: DashboardSelection | undefined,
  mode: string,
  currentSessionId: string | undefined,
  workspaceIds: readonly string[],
  records: readonly WorktreeRecord[] | undefined,
  mainRecord?: WorktreeRecord,
): WorktreeRecord | undefined {
  if (
    selection === undefined ||
    mode !== 'worktree' ||
    selection.sessionId !== currentSessionId ||
    !workspaceIds.includes(selection.workspaceId)
  )
    return undefined;
  if (
    mainRecord !== undefined &&
    (isMainWorktreeId(selection.worktreeId) || selection.worktreeId === mainRecord.worktreeId)
  ) {
    return mainRecord;
  }
  return records?.find(
    (record) =>
      record.workspaceId === selection.workspaceId && record.worktreeId === selection.worktreeId,
  );
}
