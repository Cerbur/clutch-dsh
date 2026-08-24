/** Browser-visible DSH Session summary facts used by the Worktree tree. */
export interface SessionSummaryLike {
  /** Native DSH's empty-log bit. Missing is treated as non-blank. */
  readonly blank?: boolean;
  readonly displayTitle?: string;
}

/** The subset of the DSH Session list consumed by this browser Consumer. */
export interface SessionListLike {
  readonly ids: readonly string[];
  readonly current?: string;
  readonly byId: Record<string, SessionSummaryLike>;
}

/** Read the native blank flag without inferring blankness from title or id. */
export function isBlankSession(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId'>,
): boolean {
  return sessions.byId[sessionId]?.blank === true;
}

/** Native tree visibility: ordinary rows plus the currently selected blank row. */
function isVisibleSession(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId' | 'current'>,
): boolean {
  return !isBlankSession(sessionId, sessions) || sessions.current === sessionId;
}

/** Filter a group without mutating its source order. */
export function filterVisibleSessionIds(
  sessionIds: readonly string[],
  sessions: Pick<SessionListLike, 'byId' | 'current'>,
): readonly string[] {
  return sessionIds.filter((sessionId) => isVisibleSession(sessionId, sessions));
}

/** Resolve a row title while keeping the blank label outside the DSH summary. */
export function sessionDisplayLabel(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId'>,
  blankLabel: string,
): string {
  const summary = sessions.byId[sessionId];
  return summary?.blank === true ? blankLabel : summary?.displayTitle ?? sessionId;
}

/** Match only durable Session titles or the final diagnostic id fallback. */
export function sessionMatchesQuery(
  sessionId: string,
  sessions: Pick<SessionListLike, 'byId'>,
  normalizedQuery: string,
): boolean {
  const summary = sessions.byId[sessionId];
  if (summary?.blank === true) return false;
  const label = summary?.displayTitle ?? sessionId;
  return label.toLocaleLowerCase().includes(normalizedQuery);
}
