import type { WorktreeRecord } from '../../contract/index.js';

/** Navigation identity only; the ready view remains the source of display facts. */
export interface DashboardSelection {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string | undefined;
}

/** Browser-only Main projection; it is not a persisted WorktreeRecord. */
export interface MainDashboardRecord {
  readonly worktreeId: string;
  readonly workspaceId: string;
  readonly branch: string;
  readonly currentBranch?: string | null;
  readonly absolutePath: string;
  readonly status: 'active';
  readonly source?: never;
  readonly health?: never;
  readonly diskCleanup?: never;
  readonly instructions?: never;
  readonly createdAt?: never;
  readonly importedAt?: never;
  readonly baseBranch?: never;
}

export type DashboardRecord = WorktreeRecord | MainDashboardRecord;

export function isMainWorktreeId(worktreeId: string): boolean {
  return worktreeId === 'main' || worktreeId.startsWith('main:');
}

export function isManagedDashboardRecord(record: DashboardRecord): record is WorktreeRecord {
  return !isMainWorktreeId(record.worktreeId);
}

export function createMainWorktreeRecord(
  workspace: { readonly workspaceId: string; readonly path: string },
  currentBranch?: string | null,
): MainDashboardRecord {
  return {
    worktreeId: `main:${workspace.workspaceId}`,
    workspaceId: workspace.workspaceId,
    // Main is a browser-local projection, not a plugin-managed Worktree. Keep
    // unavailable branch and health facts empty instead of inventing values.
    branch: currentBranch ?? '',
    currentBranch,
    absolutePath: workspace.path,
    status: 'active',
  };
}

export function resolveDashboardRecord(
  selection: DashboardSelection | undefined,
  mode: string,
  currentSessionId: string | undefined,
  workspaceIds: readonly string[],
  records: readonly WorktreeRecord[] | undefined,
  mainRecord?: MainDashboardRecord,
): DashboardRecord | undefined {
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
