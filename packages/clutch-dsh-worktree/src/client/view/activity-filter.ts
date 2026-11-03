import type { SessionListLike, SessionPresentation } from '../session/session-view.js';

/**
 * Browser-only activity window that scopes the Worktree tree.
 *
 * The filter is a presentation projection over native Session facts
 * (`updatedAt`, running state and pending interaction). It never adds an RPC,
 * never reads Git, and never writes a Sidecar field: hiding a row must not
 * change what the Host or DSH considers to exist.
 */
export const ACTIVITY_WINDOWS = ['today', 'last24h', 'last7d', 'all'] as const;

export type ActivityWindowId = (typeof ACTIVITY_WINDOWS)[number];

/** Preserve the pre-filter tree for existing users and for a fresh profile. */
export const DEFAULT_ACTIVITY_WINDOW: ActivityWindowId = 'all';

const DAY_MS = 86_400_000;

export function isActivityWindowId(value: unknown): value is ActivityWindowId {
  return typeof value === 'string' && (ACTIVITY_WINDOWS as readonly string[]).includes(value);
}

/** Guard persisted values before they scope a visible tree. */
export function effectiveActivityWindow(value: unknown): ActivityWindowId {
  return isActivityWindowId(value) ? value : DEFAULT_ACTIVITY_WINDOW;
}

/** Local calendar-day start: DSH presents Session times in the local time zone. */
export function startOfLocalDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Inclusive lower bound in epoch milliseconds; `undefined` disables filtering. */
export function activityWindowSince(
  window: ActivityWindowId,
  now: number,
): number | undefined {
  if (!Number.isFinite(now)) return undefined;
  switch (window) {
    case 'today':
      return startOfLocalDay(now);
    case 'last24h':
      return now - DAY_MS;
    case 'last7d':
      return now - 7 * DAY_MS;
    case 'all':
      return undefined;
  }
}

/** Native facts one activity decision needs. */
export interface ActivitySessionScope {
  readonly sessions: Pick<SessionListLike, 'byId'>;
  readonly sessionPresentations: Readonly<Record<string, SessionPresentation | undefined>>;
  /** The selected Session stays visible in every window; navigation must not hide it. */
  readonly currentSessionId?: string;
}

function lastActivityAt(sessionId: string, scope: ActivitySessionScope): number | undefined {
  const updatedAt =
    scope.sessionPresentations[sessionId]?.updatedAt ?? scope.sessions.byId[sessionId]?.updatedAt;
  return updatedAt !== undefined && Number.isFinite(updatedAt) ? updatedAt : undefined;
}

/**
 * A Session is active in a window when it runs now, waits for interaction, or
 * was updated inside the window. Running and pending Sessions count even with
 * an old `updatedAt`, because they are active now.
 */
export function isSessionActiveInWindow(
  sessionId: string,
  window: ActivityWindowId,
  now: number,
  scope: ActivitySessionScope,
): boolean {
  const since = activityWindowSince(window, now);
  if (since === undefined) return true;
  if (scope.currentSessionId === sessionId) return true;
  const presentation = scope.sessionPresentations[sessionId];
  if (presentation !== undefined && (presentation.ongoing || presentation.status.state === 'warning')) {
    return true;
  }
  const at = lastActivityAt(sessionId, scope);
  return at !== undefined && at >= since;
}

/** Filter a group without mutating its source order. */
export function filterSessionIdsByActivity(
  sessionIds: readonly string[],
  window: ActivityWindowId,
  now: number,
  scope: ActivitySessionScope,
): readonly string[] {
  if (window === 'all') return sessionIds;
  return sessionIds.filter((sessionId) => isSessionActiveInWindow(sessionId, window, now, scope));
}

/** Session scope the tree and the range selector both count. */
export function activityCandidateSessionIds(
  source: Pick<SessionListLike, 'ids' | 'byId'>,
  archivedSessionIds: readonly string[],
): readonly string[] {
  const excluded = new Set(archivedSessionIds);
  return source.ids.filter(
    (sessionId) => !excluded.has(sessionId) && source.byId[sessionId]?.blank !== true,
  );
}

/** Count the Sessions a window would show; used for the range selector labels. */
export function countSessionsInWindow(
  candidateSessionIds: readonly string[],
  window: ActivityWindowId,
  now: number,
  scope: ActivitySessionScope,
): number {
  return filterSessionIdsByActivity(candidateSessionIds, window, now, scope).length;
}

/** Read face the tree components consume; produced by `useActivityFilter`. */
export interface ActivityFilterView {
  readonly window: ActivityWindowId;
  /** Whether a bounded window is active, i.e. rows may be hidden. */
  readonly active: boolean;
  readonly now: number;
  readonly setWindow: (window: ActivityWindowId) => void;
  readonly isActive: (sessionId: string) => boolean;
  /** Narrow a list to the range; `all` returns the input unchanged. */
  readonly scopeSessionIds: (sessionIds: readonly string[]) => readonly string[];
  /** Whether any candidate Session survives this window. */
  readonly hasActiveSession: (sessionIds: readonly string[]) => boolean;
  readonly count: (window: ActivityWindowId) => number;
}
