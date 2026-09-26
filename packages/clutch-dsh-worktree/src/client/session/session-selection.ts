/** Session selection read across the legacy and borrow-only DSH Client graphs. */
export interface SessionSelectionListLike<Id extends string = string> {
  readonly current?: Id | undefined;
  readonly byId: Readonly<Record<Id, {
    readonly retainedBy?: { readonly mainView?: number | undefined } | undefined;
  } | undefined>>;
}

/** Prefer the legacy selected-id field; DSH 1.7 represents selection by mainView retention. */
export function currentSessionIdFromList<Id extends string>(
  sessions: SessionSelectionListLike<Id>,
): Id | undefined {
  if (sessions.current !== undefined) return sessions.current;
  const sessionIds = Object.keys(sessions.byId) as Id[];
  return sessionIds.find(
    (sessionId) => (sessions.byId[sessionId]?.retainedBy?.mainView ?? 0) > 0,
  );
}
