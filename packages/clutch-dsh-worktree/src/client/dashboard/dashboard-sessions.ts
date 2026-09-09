import type { SessionBinding, WorktreeRecord } from '../../contract/index.js';
import { filterVisibleSessionIds, type SessionListLike } from '../session/session-view.js';
import { filterArchivedSessionIds } from '../view/worktree-view.js';

/** Join retained snapshots without reading, mutating, or applying Sidebar search. */
export function dashboardSessionIds(
  record: Pick<WorktreeRecord, 'workspaceId' | 'worktreeId'>,
  sessions: SessionListLike,
  bindings: readonly SessionBinding[],
  archivedSessionIds: readonly string[],
  orderedIds: readonly string[] = [],
): readonly string[] {
  const members = new Set(
    bindings
      .filter(
        (binding) =>
          binding.workspaceId === record.workspaceId && binding.worktreeId === record.worktreeId,
      )
      .map((binding) => binding.sessionId),
  );
  const visible = filterVisibleSessionIds(
    filterArchivedSessionIds(
      sessions.ids.filter((sessionId) => members.has(sessionId)),
      archivedSessionIds,
    ),
    sessions,
  );
  const visibleIds = new Set(visible);
  return [...new Set([...orderedIds, ...visible])].filter((id) => visibleIds.has(id));
}
