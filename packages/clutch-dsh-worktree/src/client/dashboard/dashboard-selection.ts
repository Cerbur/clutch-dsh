import type { WorktreeRecord, WorkspaceCheckout, GitCheckoutHead } from '../../contract/index.js';

/** Navigation identity only; an undefined Session id denotes a page-level Dashboard. */
export interface DashboardSelection {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string | undefined;
}

/** Browser-only Main projection; it is not a persisted WorktreeRecord. */
export interface MainDashboardRecord {
  readonly gitRootPath?: string;
  readonly currentHead?: GitCheckoutHead;
  readonly worktreeId: string;
  readonly workspaceId: string;
  readonly branch: string;
  readonly currentBranch?: string | null;
  readonly absolutePath: string;
  readonly status: 'active';
  readonly source?: never;
  readonly health?: never;
  readonly diskCleanup?: never;
  /** Workspace-root guidance stored in the plugin sidecar, shared by Main sessions. */
  readonly instructions: string;
  readonly createdAt?: never;
  readonly importedAt?: never;
  readonly baseBranch?: never;
  readonly baseCommit?: never;
}

export type DashboardRecord = WorktreeRecord | MainDashboardRecord;

function localBranch(record: DashboardRecord): string | undefined {
  if (record.currentBranch === null ||
    (record.currentHead !== undefined && record.currentHead.kind !== 'branch')) return undefined;
  const branch = record.currentHead?.name ?? record.currentBranch ?? record.branch;
  return branch ? branch.replace(/^refs\/heads\//u, '') : undefined;
}

function matchesBaseline(baseBranch: string | undefined, branch: string | undefined): boolean {
  return branch !== undefined && (baseBranch === branch || baseBranch === `refs/heads/${branch}`);
}

/** Direct baseline relationships from the current Workspace projection, never Git ancestry. */
export function selectDerivedWorktrees(
  parent: DashboardRecord,
  records: readonly WorktreeRecord[],
): readonly WorktreeRecord[] {
  const branch = localBranch(parent);
  return records.filter((candidate) =>
    candidate.workspaceId === parent.workspaceId && candidate.worktreeId !== parent.worktreeId &&
    matchesBaseline(candidate.baseBranch, branch));
}

/** Navigate only when the saved baseline identifies one checkout in this Workspace. */
export function selectBaseWorktree(
  child: DashboardRecord,
  records: readonly WorktreeRecord[],
  mainRecord?: MainDashboardRecord,
  baseBranch = child.baseBranch,
): DashboardRecord | undefined {
  const candidates: readonly DashboardRecord[] = mainRecord === undefined ? records : [...records, mainRecord];
  const matches = candidates.filter((candidate) =>
    candidate.workspaceId === child.workspaceId && candidate.worktreeId !== child.worktreeId &&
    matchesBaseline(baseBranch, localBranch(candidate)));
  return matches.length === 1 ? matches[0] : undefined;
}

export function isMainWorktreeId(worktreeId: string): boolean {
  return worktreeId === 'main' || worktreeId.startsWith('main:');
}

export function isManagedDashboardRecord(record: DashboardRecord): record is WorktreeRecord {
  return !isMainWorktreeId(record.worktreeId);
}

export function createMainWorktreeRecord(
  workspace: { readonly workspaceId: string; readonly path: string },
  currentBranch?: string | null,
  instructions = '',
  checkout?: WorkspaceCheckout,
): MainDashboardRecord {
  return {
    worktreeId: `main:${workspace.workspaceId}`,
    workspaceId: workspace.workspaceId,
    // Main is a browser-local projection, not a plugin-managed Worktree. Keep
    // unavailable branch and health facts empty instead of inventing values.
    branch: checkout?.currentHead?.name ?? currentBranch ?? '',
    currentBranch: checkout?.currentHead === undefined ? currentBranch
      : checkout.currentHead.kind === 'branch' ? checkout.currentHead.name : null,
    ...(checkout === undefined ? {} : { gitRootPath: checkout.gitRootPath, currentHead: checkout.currentHead }),
    absolutePath: checkout?.workspacePath ?? workspace.path,
    status: 'active',
    instructions,
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
    (selection.sessionId !== undefined && selection.sessionId !== currentSessionId) ||
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
