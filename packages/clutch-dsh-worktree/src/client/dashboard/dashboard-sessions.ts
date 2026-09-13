import type { SessionBinding } from '../../contract/index.js';
import type { DashboardRecord } from './dashboard-selection.js';
import { filterVisibleSessionIds, type SessionListLike } from '../session/session-view.js';
import { filterArchivedSessionIds } from '../view/worktree-view.js';
import { isMainWorktreeId } from './dashboard-selection.js';

/** Join retained snapshots without reading, mutating, or applying Sidebar search. */
export function dashboardSessionIds(
  record: Pick<DashboardRecord, 'workspaceId' | 'worktreeId'>,
  sessions: SessionListLike,
  bindings: readonly SessionBinding[],
  archivedSessionIds: readonly string[],
  orderedIds: readonly string[] = [],
  workspaceSessionIds: readonly string[] = [],
): readonly string[] {
  if (isMainWorktreeId(record.worktreeId)) {
    const boundSessionIds = new Set(
      bindings
        .filter(
          (binding) =>
            binding.workspaceId === record.workspaceId && binding.status !== 'detached',
        )
        .map((binding) => binding.sessionId),
    );
    const visible = filterVisibleSessionIds(
      filterArchivedSessionIds(
        workspaceSessionIds.filter((sessionId) => !boundSessionIds.has(sessionId)),
        archivedSessionIds,
      ),
      sessions,
    );
    const visibleIds = new Set(visible);
    return [...new Set([...orderedIds, ...visible])].filter((id) => visibleIds.has(id));
  }

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
