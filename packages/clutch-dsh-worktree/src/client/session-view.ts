/** Browser-visible DSH Session summary facts used by the Worktree tree. */
export interface SessionSummaryLike {
  /** Native DSH's empty-log bit. Missing is treated as non-blank. */
  readonly blank?: boolean;
  readonly displayTitle?: string;
  readonly running?: boolean;
  readonly pendingInteraction?: PendingInteractionStatus;
  readonly completed?: boolean;
  readonly parentId?: string;
  readonly origin?: 'subagent' | string;
  readonly updatedAt?: number;
}

export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question';

export type SessionStatusState = 'warning' | 'ongoing' | 'done';

export type SessionStatusLabelKey =
  | 'running'
  | 'subagentsRunning'
  | 'idle'
  | 'waitingApproval'
  | 'planReview'
  | 'waitingAnswer'
  | 'completed';

export interface SessionStatusPresentation {
  readonly state: SessionStatusState;
  readonly labelKey: SessionStatusLabelKey;
  readonly runningSubagentCount: number;
}

export interface RelativeTime {
  readonly unit: 'now' | 'minutes' | 'hours' | 'days' | 'months' | 'years';
  readonly n: number;
}

export interface SessionPresentation {
  readonly status: SessionStatusPresentation;
  readonly running: boolean;
  readonly ongoing: boolean;
  readonly runningSubagentCount: number;
  readonly completed: boolean;
  readonly updatedAt?: number;
}

/** The subset of the DSH Session list consumed by this browser Consumer. */
export interface SessionListLike {
  readonly ids: readonly string[];
  readonly current?: string;
  readonly byId: Record<string, SessionSummaryLike>;
}

function isPendingInteractionStatus(value: unknown): value is PendingInteractionStatus {
  return value === 'approval' || value === 'plan-review' || value === 'question';
}

function validUpdatedAt(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

interface LineageSummary {
  readonly id: string;
  readonly parentId?: string;
  readonly origin?: 'subagent';
  readonly running: boolean;
}

interface SubagentDescendantSummary {
  readonly count: number;
  readonly runningCount: number;
}

/**
 * Native-compatible subagent lineage index. The upstream runtime's public client
 * entry is a browser module-loader bundle, so keeping this pure mirror local lets
 * the browser Consumer and its Node tests share the same status semantics.
 */
function indexSubagentDescendants(
  summaries: Readonly<Record<string, LineageSummary>>,
): ReadonlyMap<string, SubagentDescendantSummary> {
  const indexed = new Map<string, { count: number; runningCount: number }>();
  for (const descendant of Object.values(summaries)) {
    if (descendant.origin !== 'subagent') continue;
    const seen = new Set<string>();
    let current: LineageSummary | undefined = descendant;
    while (
      current?.origin === 'subagent' &&
      current.parentId !== undefined &&
      !seen.has(current.id)
    ) {
      seen.add(current.id);
      const aggregate = indexed.get(current.parentId);
      if (aggregate === undefined) {
        indexed.set(current.parentId, {
          count: 1,
          runningCount: descendant.running ? 1 : 0,
        });
      } else {
        aggregate.count += 1;
        if (descendant.running) aggregate.runningCount += 1;
      }
      current = summaries[current.parentId];
    }
  }
  return indexed;
}

/** Native Workspace relative-time buckets, kept pure for deterministic rendering/tests. */
export function relativeTime(updatedAt: number | undefined, now: number): RelativeTime | undefined {
  if (!validUpdatedAt(updatedAt) || !Number.isFinite(now)) return undefined;
  const MIN = 60_000;
  const HOUR = 3_600_000;
  const DAY = 86_400_000;
  const diff = Math.max(0, now - updatedAt);
  if (diff < MIN) return { unit: 'now', n: 0 };
  if (diff < HOUR) return { unit: 'minutes', n: Math.floor(diff / MIN) };
  if (diff < DAY) return { unit: 'hours', n: Math.floor(diff / HOUR) };
  if (diff < 30 * DAY) return { unit: 'days', n: Math.floor(diff / DAY) };
  if (diff < 365 * DAY) return { unit: 'months', n: Math.floor(diff / (30 * DAY)) };
  return { unit: 'years', n: Math.floor(diff / (365 * DAY)) };
}

/** Match native Workspace status priority while retaining the aggregate subagent count. */
export function sessionStatus(
  session: Pick<SessionSummaryLike, 'pendingInteraction' | 'running' | 'completed'>,
  runningSubagentCount: number,
): SessionStatusPresentation {
  const count =
    Number.isFinite(runningSubagentCount) && runningSubagentCount > 0
      ? Math.floor(runningSubagentCount)
      : 0;
  if (isPendingInteractionStatus(session.pendingInteraction)) {
    const labelKey: SessionStatusLabelKey =
      session.pendingInteraction === 'approval'
        ? 'waitingApproval'
        : session.pendingInteraction === 'plan-review'
          ? 'planReview'
          : 'waitingAnswer';
    return { state: 'warning', labelKey, runningSubagentCount: count };
  }
  if (session.running === true) {
    return { state: 'ongoing', labelKey: 'running', runningSubagentCount: count };
  }
  if (count > 0) {
    return { state: 'ongoing', labelKey: 'subagentsRunning', runningSubagentCount: count };
  }
  if (session.completed === true) {
    return { state: 'done', labelKey: 'completed', runningSubagentCount: 0 };
  }
  return { state: 'done', labelKey: 'idle', runningSubagentCount: 0 };
}

function toLineageSummary(sessionId: string, summary: SessionSummaryLike): LineageSummary {
  return {
    id: sessionId,
    running: summary.running === true,
    ...(summary.parentId === undefined ? {} : { parentId: summary.parentId }),
    ...(summary.origin === 'subagent' ? { origin: 'subagent' as const } : {}),
  };
}

/** Derive row and group activity facts from one retained DSH Session snapshot. */
export function deriveSessionPresentationIndex(
  sessions: Pick<SessionListLike, 'byId'>,
): Readonly<Record<string, SessionPresentation>> {
  const lineageSummaries = Object.fromEntries(
    Object.entries(sessions.byId).map(([sessionId, summary]) => [
      sessionId,
      toLineageSummary(sessionId, summary),
    ]),
  ) as Record<string, LineageSummary>;
  const descendants = indexSubagentDescendants(lineageSummaries);
  return Object.fromEntries(
    Object.entries(sessions.byId).map(([sessionId, summary]) => {
      const runningSubagentCount = descendants.get(sessionId)?.runningCount ?? 0;
      const status = sessionStatus(summary, runningSubagentCount);
      return [
        sessionId,
        {
          status,
          running: summary.running === true,
          ongoing: summary.running === true || runningSubagentCount > 0,
          runningSubagentCount,
          completed: summary.completed === true,
          ...(validUpdatedAt(summary.updatedAt) ? { updatedAt: summary.updatedAt } : {}),
        },
      ];
    }),
  );
}

/** Aggregate only live ongoing activity; callers decide which IDs are in the group. */
export function hasOngoingSession(
  sessionIds: readonly string[],
  presentations: Readonly<Record<string, Pick<SessionPresentation, 'ongoing'> | undefined>>,
): boolean {
  return sessionIds.some((sessionId) => presentations[sessionId]?.ongoing === true);
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
  return summary?.blank === true ? blankLabel : (summary?.displayTitle ?? sessionId);
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
