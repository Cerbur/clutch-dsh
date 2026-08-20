import type { ActionsDecl } from '@deepseek-ai/dsh-client-ui-slots';

/** Peer navigation modes owned by this browser Consumer. */
export type WorktreeViewMode = 'workspace-session' | 'worktree';

/** Browser-local storage key; it is never sent to DSH or the sidecar. */
export const WORKTREE_VIEW_MODE_STORAGE_KEY = 'clutch-dsh-worktree.view-mode';

/** The only durable Client preference introduced by Phase 4. */
export interface WorktreeViewState {
  viewMode: WorktreeViewMode;
}

/** The complete mutation face for the view-mode store. */
export type WorktreeViewActions = ActionsDecl<WorktreeViewState> & {
  setViewMode: (draft: WorktreeViewState, mode: WorktreeViewMode) => void;
};

/** Guard persisted values before they become a visible mode. */
export function isWorktreeViewMode(value: unknown): value is WorktreeViewMode {
  return value === 'workspace-session' || value === 'worktree';
}

/** Degraded/unavailable plugin state always exposes the original DSH view. */
export function effectiveViewMode(
  preferred: unknown,
  worktreeServiceAvailable: boolean,
): WorktreeViewMode {
  if (!worktreeServiceAvailable || !isWorktreeViewMode(preferred)) return 'workspace-session';
  return preferred;
}

/** Keep the Main bucket sourced from DSH's global Session list, not Workspace grouping. */
export function unboundSessionIds(
  sessionIds: readonly string[],
  boundSessionIds: readonly string[],
): readonly string[] {
  const bound = new Set(boundSessionIds);
  return sessionIds.filter((sessionId) => !bound.has(sessionId));
}

interface WorkspaceLike {
  readonly workspaceId: string;
  readonly sessionIds: readonly string[];
}

interface WorkspaceListLike {
  readonly items: readonly WorkspaceLike[];
  readonly recentWorkspaceId?: string;
}

interface SessionListLike {
  readonly current?: string;
}

/**
 * Select the initial Worktree surface Workspace without navigating DSH:
 * current Session membership wins, then DSH recency, then the first available
 * Workspace keeps the surface usable in an empty/reconnecting fixture.
 */
export function initialWorkspaceId(
  workspaces: WorkspaceListLike,
  sessions: SessionListLike,
): string | undefined {
  const currentSessionId = sessions.current;
  if (currentSessionId !== undefined) {
    const currentWorkspace = workspaces.items.find((workspace) =>
      workspace.sessionIds.includes(currentSessionId),
    );
    if (currentWorkspace !== undefined) return currentWorkspace.workspaceId;
  }
  if (
    workspaces.recentWorkspaceId !== undefined &&
    workspaces.items.some((workspace) => workspace.workspaceId === workspaces.recentWorkspaceId)
  ) {
    return workspaces.recentWorkspaceId;
  }
  return workspaces.items[0]?.workspaceId;
}
