import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ACTIVITY_WINDOWS,
  DEFAULT_ACTIVITY_WINDOW,
  activityCandidateSessionIds,
  countSessionsInWindow,
  effectiveActivityWindow,
  effectiveActivityWindows,
  isSessionActiveInWindow,
  type ActivityFilterView,
  type ActivitySessionScope,
  type ActivityWindowId,
} from '../../view/activity-filter.js';
import type { SessionListLike, SessionPresentation } from '../../session/session-view.js';
import type { WorktreeSurfaceProps } from '../types.js';

/** A bounded window crosses a day/hour boundary while the panel is open. */
const ACTIVITY_CLOCK_INTERVAL_MS = 60_000;

type SourceLike = {
  readonly sessions: SessionListLike;
  readonly sessionPresentations: Readonly<Record<string, SessionPresentation | undefined>>;
  readonly currentSessionId?: string;
  readonly archivedSessionIds: readonly string[];
};

type Input = {
  readonly props: Pick<WorktreeSurfaceProps, 'useStore' | 'actions'>;
  readonly source: SourceLike;
  /** The range and its counts only matter while the Worktree surface is shown. */
  readonly enabled: boolean;
};

/**
 * Derive the browser-only activity range for the Worktree tree.
 *
 * The range is a persisted Client preference read through the shared view store;
 * this hook adds the wall clock, the per-Session predicate and the range counts.
 * It reads only native Session facts, so it never widens the refresh scope.
 */
export function useActivityFilter({ props, source, enabled }: Input): ActivityFilterView {
  const preferred = props.useStore((state) => state.activityWindow);
  const preferredWindows = props.useStore((state) => state.activityWindows);
  const showInactiveStructure = props.useStore(
    (state) => state.showInactiveStructure === true,
  );
  const visibleWindows = useMemo(
    () => effectiveActivityWindows(preferredWindows),
    [preferredWindows],
  );
  // A persisted selection outside the visible set resolves to the first visible
  // tab instead of filtering the tree with an unreachable range.
  const preferredWindow = effectiveActivityWindow(preferred);
  const window = visibleWindows.includes(preferredWindow)
    ? preferredWindow
    : (visibleWindows[0] ?? DEFAULT_ACTIVITY_WINDOW);
  const [now, setNow] = useState(() => Date.now());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    // Rebase the clock as soon as the surface is shown again, then keep it fresh.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ACTIVITY_CLOCK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  const { sessions, sessionPresentations, currentSessionId, archivedSessionIds } = source;
  const scope = useMemo<ActivitySessionScope>(
    () => ({
      sessions,
      sessionPresentations,
      ...(currentSessionId === undefined ? {} : { currentSessionId }),
    }),
    [sessions, sessionPresentations, currentSessionId],
  );
  const candidateSessionIds = useMemo(
    () => activityCandidateSessionIds(sessions, archivedSessionIds),
    [sessions, archivedSessionIds],
  );
  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const candidate of ACTIVITY_WINDOWS) {
      next[candidate] = countSessionsInWindow(candidateSessionIds, candidate, now, scope);
    }
    return next;
  }, [candidateSessionIds, now, scope]);

  const isActive = useCallback(
    (sessionId: string) => isSessionActiveInWindow(sessionId, window, now, scope),
    [now, scope, window],
  );
  const hasActiveSession = useCallback(
    (sessionIds: readonly string[]) => sessionIds.some(isActive),
    [isActive],
  );
  const scopeSessionIds = useCallback(
    (sessionIds: readonly string[]) =>
      window === 'all' ? sessionIds : sessionIds.filter(isActive),
    [isActive, window],
  );
  const setWindow = useCallback(
    (next: ActivityWindowId) => {
      props.actions.setActivityWindow(effectiveActivityWindow(next));
    },
    [props.actions],
  );
  const isWindowVisible = useCallback(
    (candidate: ActivityWindowId) => visibleWindows.includes(candidate),
    [visibleWindows],
  );
  const setWindowVisible = useCallback(
    (candidate: ActivityWindowId, visible: boolean) => {
      props.actions.setActivityWindowVisible(candidate, visible);
    },
    [props.actions],
  );
  const setShowInactiveStructure = useCallback(
    (show: boolean) => {
      props.actions.setShowInactiveStructure(show === true);
    },
    [props.actions],
  );
  const count = useCallback(
    (candidate: ActivityWindowId) => counts[effectiveActivityWindow(candidate)] ?? 0,
    [counts],
  );

  return {
    window,
    active: window !== 'all',
    now,
    setWindow,
    visibleWindows,
    isWindowVisible,
    setWindowVisible,
    showInactiveStructure,
    setShowInactiveStructure,
    menuOpen,
    setMenuOpen,
    isActive,
    scopeSessionIds,
    hasActiveSession,
    count,
  };
}
