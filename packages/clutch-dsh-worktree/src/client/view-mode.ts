import type { ActionsDecl } from '@deepseek-ai/dsh-client-ui-slots';

/** Peer navigation modes owned by this browser Consumer. */
export type WorktreeViewMode = 'workspace-session' | 'worktree';

/** Browser-local storage key; it is never sent to DSH or the sidecar. */
export const WORKTREE_VIEW_MODE_STORAGE_KEY = 'clutch-dsh-worktree.view-mode';

/** The only durable Client preference introduced by Phase 4. */
export interface WorktreeViewState {
  viewMode: WorktreeViewMode;
}

/** A browser-local Worktree → DSH Workspace membership projection. */
export interface VirtualWorkspaceBinding {
  readonly workspaceId: string;
  readonly sessionId: string;
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

/** Keep the Main bucket scoped to the selected DSH Workspace before filtering bindings. */
export function workspaceSessionIds(
  workspaces: WorkspaceListLike,
  workspaceId: string | undefined,
  sessionIds: readonly string[],
): readonly string[] {
  if (workspaceId === undefined) return [];
  const workspace = workspaces.items.find((candidate) => candidate.workspaceId === workspaceId);
  if (workspace === undefined) return [];
  const listed = new Set(sessionIds);
  return workspace.sessionIds.filter((sessionId) => listed.has(sessionId));
}

export function unboundSessionIds(
  sessionIds: readonly string[],
  boundSessionIds: readonly string[],
): readonly string[] {
  const bound = new Set(boundSessionIds);
  return sessionIds.filter((sessionId) => !bound.has(sessionId));
}

/**
 * Apply a browser-only membership delta to a DSH Workspace list snapshot.
 * `previousBindings` are removed first so the same function can also undo a
 * projection after a binding is deleted or the plugin is disposed.
 */
export function projectVirtualWorkspaceMembership<
  T extends { readonly items: readonly WorkspaceLike[] },
>(
  snapshot: T,
  previousBindings: readonly VirtualWorkspaceBinding[],
  nextBindings: readonly VirtualWorkspaceBinding[],
): T {
  const previousSessionIds = new Set(previousBindings.map((binding) => binding.sessionId));
  const nextByWorkspace = new Map<string, string[]>();
  for (const binding of nextBindings) {
    const sessionIds = nextByWorkspace.get(binding.workspaceId) ?? [];
    if (!sessionIds.includes(binding.sessionId)) sessionIds.push(binding.sessionId);
    nextByWorkspace.set(binding.workspaceId, sessionIds);
  }

  const items = snapshot.items.map((workspace) => {
    const nativeSessionIds = workspace.sessionIds.filter(
      (sessionId) => !previousSessionIds.has(sessionId),
    );
    const virtualSessionIds = nextByWorkspace.get(workspace.workspaceId) ?? [];
    const sessionIds = [
      ...nativeSessionIds,
      ...virtualSessionIds.filter((sessionId) => !nativeSessionIds.includes(sessionId)),
    ];
    if (
      sessionIds.length === workspace.sessionIds.length &&
      sessionIds.every((sessionId, index) => sessionId === workspace.sessionIds[index])
    ) {
      return workspace;
    }
    return { ...workspace, sessionIds };
  });

  if (items.every((workspace, index) => workspace === snapshot.items[index])) return snapshot;
  return { ...snapshot, items } as T;
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
