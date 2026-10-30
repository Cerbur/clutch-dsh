import type { WorktreeWorkspaceView } from '../view/worktree-view.js';
import type { WorkspaceListLike } from '../surface/types.js';
import { workspaceSessionIds } from '../view/view-mode.js';
import type { SessionListLike, SessionPresentation } from './session-view.js';

export interface ActiveSession {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly workspaceTitle: string;
  /** Undefined while relationship facts are unavailable; null means Local/Main. */
  readonly worktree: string | null | undefined;
  readonly presentation: SessionPresentation;
}

/** Join existing ready facts only, independently of tree search, folding and row limits. */
export function activeSessions(
  sessions: SessionListLike,
  presentations: Readonly<Record<string, SessionPresentation>>,
  workspaces: WorkspaceListLike,
  views: readonly WorktreeWorkspaceView[],
): readonly ActiveSession[] {
  const archived = new Set(workspaces.archivedSessionIds ?? []);
  const listed = new Set(sessions.ids);
  const seen = new Set<string>();
  const result: ActiveSession[] = [];
  for (const workspace of workspaces.items) {
    const view = views.find((item) => item.workspaceId === workspace.workspaceId);
    const members = new Set([
      ...workspaceSessionIds(workspaces, workspace.workspaceId, sessions.ids),
      ...(view?.bindings.map((binding) => binding.sessionId) ?? []),
    ]);
    for (const sessionId of members) {
      const presentation = presentations[sessionId];
      if (
        seen.has(sessionId) ||
        !listed.has(sessionId) ||
        archived.has(sessionId) ||
        sessions.byId[sessionId]?.blank === true ||
        presentation === undefined ||
        (!presentation.ongoing &&
          !presentation.completed &&
          presentation.status.state !== 'warning')
      )
        continue;
      seen.add(sessionId);
      const binding = view?.bindings.find((item) => item.sessionId === sessionId);
      const record = view?.worktrees.find((item) => item.worktreeId === binding?.worktreeId);
      result.push({
        sessionId,
        workspaceId: workspace.workspaceId,
        workspaceTitle: workspace.title,
        worktree: binding === undefined ? (view === undefined ? undefined : null) : record?.branch,
        presentation,
      });
    }
  }
  return result.sort((a, b) => (b.presentation.updatedAt ?? 0) - (a.presentation.updatedAt ?? 0));
}

export interface ActivityClock {
  readonly ongoing: boolean;
  readonly updatedAt: number | undefined;
  readonly since: number | undefined;
}

/** Ephemeral display clocks, never an unread owner or persisted Session fact. */
export function activityClocks(
  previous: ReadonlyMap<string, ActivityClock>,
  presentations: Readonly<Record<string, SessionPresentation>>,
  now: number,
): ReadonlyMap<string, ActivityClock> {
  return new Map(
    Object.entries(presentations).map(([id, presentation]) => {
      const old = previous.get(id);
      const transitioned = old !== undefined && old.ongoing !== presentation.ongoing;
      const newPrompt =
        presentation.ongoing &&
        presentation.updatedAt !== undefined &&
        (old?.updatedAt === undefined || presentation.updatedAt > old.updatedAt);
      return [
        id,
        {
          ongoing: presentation.ongoing,
          updatedAt: presentation.updatedAt,
          since: transitioned
            ? now
            : newPrompt
              ? presentation.updatedAt
              : (old?.since ?? presentation.updatedAt),
        },
      ];
    }),
  );
}
