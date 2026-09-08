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
interface WorkspaceMembershipLike {
  readonly workspaceId: string;
  readonly sessionIds: readonly string[];
}

export function projectVirtualWorkspaceMembership<
  T extends { readonly items: readonly WorkspaceMembershipLike[] },
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

export interface WorkspaceLike {
  readonly workspaceId: string;
  readonly sessionIds: readonly string[];
  readonly createdAt: string;
}

export interface WorkspaceListLike {
  readonly items: readonly WorkspaceLike[];
}

export interface SessionLike {
  readonly updatedAt?: number;
}

export interface SessionListLike {
  readonly current?: string;
  readonly byId: Readonly<Record<string, SessionLike | undefined>>;
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function createdAtTimestamp(createdAt: string): number | undefined {
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Derive the most recent Workspace from rc.1 Session/Workspace metadata.
 * Host order is retained when timestamps tie, so equal activity never causes
 * the native Workspace order to oscillate.
 */
export function deriveRecentWorkspaceId(
  workspaces: WorkspaceListLike,
  sessionsById: Readonly<Record<string, SessionLike | undefined>>,
): string | undefined {
  let recentWorkspaceId: string | undefined;
  let recentTimestamp = Number.NEGATIVE_INFINITY;
  for (const workspace of workspaces.items) {
    let workspaceTimestamp: number | undefined;
    for (const sessionId of workspace.sessionIds) {
      const updatedAt = sessionsById[sessionId]?.updatedAt;
      if (validTimestamp(updatedAt)) {
        workspaceTimestamp = Math.max(workspaceTimestamp ?? updatedAt, updatedAt);
      }
    }
    workspaceTimestamp ??= createdAtTimestamp(workspace.createdAt);
    if (workspaceTimestamp === undefined || workspaceTimestamp <= recentTimestamp) continue;
    recentWorkspaceId = workspace.workspaceId;
    recentTimestamp = workspaceTimestamp;
  }
  return recentWorkspaceId;
}

/**
 * Select the initial Worktree surface Workspace without navigating DSH:
 * current Session membership wins, then derived DSH recency, then the first available
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
  const recentWorkspaceId = deriveRecentWorkspaceId(workspaces, sessions.byId);
  if (recentWorkspaceId !== undefined) return recentWorkspaceId;
  return workspaces.items[0]?.workspaceId;
}
