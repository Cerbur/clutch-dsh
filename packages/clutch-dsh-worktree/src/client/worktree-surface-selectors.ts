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

export function clearSessionGroupExpansion(
  current: Readonly<Record<string, boolean>>,
  groupKeys: readonly string[],
): Record<string, boolean> {
  const next = { ...current };
  for (const key of groupKeys) delete next[key];
  return next;
}

export function isCompleteWorktreeWorkspaceSnapshot(
  workspaceIds: readonly string[],
  views: readonly WorktreeWorkspaceView[],
): boolean {
  if (views.length !== workspaceIds.length) return false;
  const expected = new Set(workspaceIds);
  const actual = new Set(views.map((view) => view.workspaceId));
  return actual.size === expected.size && [...expected].every((id) => actual.has(id));
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

export type CurrentSessionLocation =
  | {
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly groupKey: string;
      readonly kind: 'main';
    }
  | {
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly groupKey: string;
      readonly kind: 'worktree';
      readonly worktreeId: string;
    };

export function resolveCurrentSessionLocation(
  currentSessionId: string | undefined,
  workspaces: readonly Pick<WorkspaceLike, 'workspaceId' | 'sessionIds'>[],
  views: readonly WorktreeWorkspaceView[],
): CurrentSessionLocation | undefined {
  if (currentSessionId === undefined) return undefined;
  const workspace = workspaces.find((candidate) =>
    candidate.sessionIds.includes(currentSessionId),
  );
  if (workspace === undefined) return undefined;
  const view = views.find((candidate) => candidate.workspaceId === workspace.workspaceId);
  if (view === undefined) return undefined;
  const binding = view.bindings.find((candidate) =>
    candidate.sessionId === currentSessionId,
  );
  if (binding === undefined) {
    return {
      sessionId: currentSessionId,
      workspaceId: workspace.workspaceId,
      groupKey: 'main:' + workspace.workspaceId,
      kind: 'main',
    };
  }
  const worktree = view.worktrees.find((candidate) =>
    candidate.worktreeId === binding.worktreeId &&
    candidate.workspaceId === workspace.workspaceId,
  );
  if (worktree === undefined) return undefined;
  return {
    sessionId: currentSessionId,
    workspaceId: workspace.workspaceId,
    groupKey: 'worktree:' + worktree.worktreeId,
    kind: 'worktree',
    worktreeId: worktree.worktreeId,
  };
}

export function currentSessionRevealKeys(
  location: CurrentSessionLocation | undefined,
): readonly string[] {
  if (location === undefined) return [];
  return [
    'workspace:' + location.workspaceId,
    location.kind === 'main'
      ? 'main:' + location.workspaceId
      : 'worktree:' + location.worktreeId,
    'session-group:' + location.groupKey,
  ];
}

export function shouldRevealCurrentSessionGroup(
  sessionIds: readonly string[],
  currentSessionId: string | undefined,
): boolean {
  if (currentSessionId === undefined || sessionIds.length <= 5) return false;
  return sessionIds.indexOf(currentSessionId) >= 5;
}
