import type { BranchRecord, SessionBinding, WorktreeRecord } from '../contract/index.js';

export type WorktreeSessionContextReason =
  | 'no-session'
  | 'not-ready'
  | 'unbound'
  | 'detached'
  | 'repair'
  | 'stale'
  | 'workspace-mismatch';

export type WorktreeSessionContext =
  | {
      readonly kind: 'main';
      readonly workspaceId: string;
      readonly label: string;
      readonly source: 'current-branch';
    }
  | {
      readonly kind: 'worktree';
      readonly workspaceId: string;
      readonly worktreeId: string;
      readonly label: string;
      readonly source: 'active-binding';
    }
  | {
      readonly kind: 'none';
      readonly reason: WorktreeSessionContextReason;
    };

export interface WorktreeContextInput {
  readonly currentSessionId?: string;
  /** Selected Workspace used by the blank Hero before a Session exists. */
  readonly currentWorkspaceId?: string;
  readonly workspaces: readonly {
    readonly workspaceId: string;
    readonly sessionIds: readonly string[];
  }[];
  readonly branches: readonly BranchRecord[];
  readonly worktrees: readonly WorktreeRecord[];
  readonly bindings: readonly SessionBinding[];
}

const none = (reason: WorktreeSessionContextReason): WorktreeSessionContext => ({
  kind: 'none',
  reason,
});

/** Resolve the branch or active Worktree label for one current DSH Session. */
export function resolveWorktreeSessionContext(
  input: WorktreeContextInput,
): WorktreeSessionContext {
  const sessionId = input.currentSessionId;
  if (sessionId === undefined && input.currentWorkspaceId === undefined) return none('no-session');

  const workspace = sessionId === undefined
    ? input.workspaces.find(({ workspaceId }) => workspaceId === input.currentWorkspaceId)
    : input.workspaces.find(({ sessionIds }) => sessionIds.includes(sessionId));
  if (workspace === undefined) return none('unbound');

  const binding = sessionId === undefined
    ? undefined
    : input.bindings.find((candidate) => candidate.sessionId === sessionId);
  if (binding !== undefined) {
    if (binding.workspaceId !== workspace.workspaceId) return none('workspace-mismatch');
    if (binding.status === 'detached') return none('detached');

    const record = input.worktrees.find(
      (candidate) => candidate.worktreeId === binding.worktreeId,
    );
    if (record === undefined || record.workspaceId !== workspace.workspaceId) {
      return none(record === undefined ? 'stale' : 'workspace-mismatch');
    }
    if (record.status !== 'active') return none('stale');
    if (record.health === 'repair') return none('repair');
    if (record.branch.length === 0) return none('not-ready');

    return {
      kind: 'worktree',
      workspaceId: workspace.workspaceId,
      worktreeId: record.worktreeId,
      label: record.branch,
      source: 'active-binding',
    };
  }

  const currentBranch = input.branches.find(({ isCurrent }) => isCurrent);
  if (currentBranch === undefined || currentBranch.name.length === 0) return none('not-ready');

  return {
    kind: 'main',
    workspaceId: workspace.workspaceId,
    label: currentBranch.name,
    source: 'current-branch',
  };
}
