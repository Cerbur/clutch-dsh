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

/** The selector shows every range until the user narrows it. */
export const DEFAULT_ACTIVITY_WINDOWS: readonly ActivityWindowId[] = ACTIVITY_WINDOWS;

/**
 * Guard the persisted visible-range list: unknown and duplicate entries are
 * dropped, the canonical selector order is restored, and an empty result falls
 * back to every range so the selector can never become unreachable.
 */
export function effectiveActivityWindows(value: unknown): readonly ActivityWindowId[] {
  const values = Array.isArray(value) ? value.filter(isActivityWindowId) : [];
  const selected = new Set(values);
  const visible = ACTIVITY_WINDOWS.filter((window) => selected.has(window));
  return visible.length > 0 ? visible : DEFAULT_ACTIVITY_WINDOWS;
}

/**
 * Apply one visibility checkbox without producing an empty selector.
 * Re-showing a range inserts it back into the canonical order.
 */
export function toggleActivityWindow(
  current: readonly ActivityWindowId[],
  window: ActivityWindowId,
  visible: boolean,
): readonly ActivityWindowId[] {
  const enabled = new Set(current);
  const wasVisible = enabled.has(window);
  if (visible === wasVisible) return current;
  if (visible) enabled.add(window);
  else enabled.delete(window);
  if (enabled.size === 0) return current;
  return ACTIVITY_WINDOWS.filter((candidate) => enabled.has(candidate));
}

/**
 * Pick the tab that takes over when the selected range is hidden: the next
 * visible range in selector order, wrapping to the first one at the end.
 */
export function nextActivityWindow(
  hidden: ActivityWindowId,
  visible: readonly ActivityWindowId[],
): ActivityWindowId {
  const start = ACTIVITY_WINDOWS.indexOf(hidden);
  for (let step = 1; step <= ACTIVITY_WINDOWS.length; step += 1) {
    const candidate = ACTIVITY_WINDOWS[(start + step) % ACTIVITY_WINDOWS.length];
    if (candidate !== undefined && visible.includes(candidate)) return candidate;
  }
  return visible[0] ?? DEFAULT_ACTIVITY_WINDOW;
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
  /** Ranges the selector shows, in canonical order; never empty. */
  readonly visibleWindows: readonly ActivityWindowId[];
  readonly isWindowVisible: (window: ActivityWindowId) => boolean;
  /** Show or hide one selector tab; hiding the last tab is ignored. */
  readonly setWindowVisible: (window: ActivityWindowId, visible: boolean) => void;
  /**
   * Keep Workspaces/Worktrees with no Session in the range. Defaults to true;
   * users can turn it off to scope structure to the activity range.
   */
  readonly showInactiveStructure: boolean;
  readonly setShowInactiveStructure: (show: boolean) => void;
  /** Ephemeral dropdown state for the visible-range checkboxes. */
  readonly menuOpen: boolean;
  readonly setMenuOpen: (open: boolean) => void;
  readonly isActive: (sessionId: string) => boolean;
  /** Narrow a list to the range; `all` returns the input unchanged. */
  readonly scopeSessionIds: (sessionIds: readonly string[]) => readonly string[];
  /** Whether any candidate Session survives this window. */
  readonly hasActiveSession: (sessionIds: readonly string[]) => boolean;
  readonly count: (window: ActivityWindowId) => number;
}
