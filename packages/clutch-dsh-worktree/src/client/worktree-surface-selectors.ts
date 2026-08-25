import type { SessionBinding } from '../contract/index.js';
import {
  sessionDisplayLabel,
  sessionMatchesQuery,
  type SessionListLike,
} from './session-view.js';
import type { WorktreeWorkspaceView } from './worktree-view.js';
import type {
  WorktreeTranslate,
  WorkspaceLike,
} from './worktree-surface-types.js';

export function sessionLabel(
  sessionId: string,
  sessions: SessionListLike,
  t: WorktreeTranslate,
): string {
  return sessionDisplayLabel(sessionId, sessions, t('session.new'));
}

export function bindingIdsFor(
  bindings: readonly SessionBinding[],
  worktreeId: string,
): readonly string[] {
  return bindings
    .filter((binding) => binding.worktreeId === worktreeId)
    .map((binding) => binding.sessionId);
}

export function includesText(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query);
}

export function workspaceMatches(
  workspace: WorkspaceLike,
  view: WorktreeWorkspaceView | undefined,
  sessions: SessionListLike,
  query: string,
): boolean {
  if (query.length === 0) return true;
  if (includesText(workspace.title, query)) return true;
  if (
    workspace.sessionIds.some((sessionId) => sessionMatchesQuery(sessionId, sessions, query))
  ) {
    return true;
  }
  if (view === undefined) return false;
  if (
    view.worktrees.some(
      (record) =>
        includesText(record.branch, query) || includesText(record.absolutePath, query),
    )
  ) {
    return true;
  }
  return view.bindings.some((binding) =>
    sessionMatchesQuery(binding.sessionId, sessions, query),
  );
}
