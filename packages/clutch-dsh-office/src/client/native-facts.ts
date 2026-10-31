import type { RecentSession, SessionFact, SessionState, WorkspaceFact } from '../office/types.js';

interface NativeSummary {
  readonly blank: boolean;
  readonly origin?: string;
  readonly running: boolean;
  readonly title?: string;
  readonly displayTitle?: string;
  readonly updatedAt?: number;
  readonly cwd?: string;
  readonly parentId?: string;
}
interface NativeStatus {
  readonly running: boolean | undefined;
  readonly pendingInteraction: unknown;
  readonly completionUnread?: boolean;
}

/** Read-only normalization; deliberately accepts native identities as strings across peer graphs. */
export function sessionFacts(
  ids: readonly string[],
  byId: Readonly<Record<string, NativeSummary>>,
  statuses: Iterable<readonly [string, NativeStatus]>,
  archivedIds: readonly string[],
  titleFor: (id: string) => string | undefined,
): Map<string, SessionFact> {
  const status = new Map(statuses);
  const archived = new Set(archivedIds);
  return new Map(
    ids.flatMap((id) => {
      const summary = byId[id];
      if (!summary) return [];
      const current = status.get(id);
      const fact: SessionFact = {
        id,
        label: summary.title || titleFor(id) || summary.displayTitle || id.slice(0, 8),
        eligible: !archived.has(id) && !summary.blank && summary.origin !== 'subagent',
        activity: current?.pendingInteraction
          ? 'waiting'
          : (current?.running ?? summary.running)
            ? 'working'
            : 'idle',
      };
      return [[id, fact] as const];
    }),
  );
}

/** Only Host-list members, never catalog-only rows; no retain, history reads or unread writes. */
export function recentSessionFacts(
  ids: readonly string[],
  byId: Readonly<Record<string, NativeSummary>>,
  statuses: Iterable<readonly [string, NativeStatus]>,
  archivedIds: readonly string[],
  workspaces: readonly WorkspaceFact[],
  titleFor: (id: string) => string | undefined,
  ungrouped: string,
): RecentSession[] {
  const status = new Map(statuses),
    archived = new Set(archivedIds);
  const listed = new Set(ids);
  const runningChildren = new Set<string>();
  for (const id of listed) {
    let child = byId[id];
    if (child?.origin !== 'subagent' || !(status.get(id)?.running ?? child.running)) continue;
    const seen = new Set<string>([id]);
    while (child?.origin === 'subagent' && child.parentId && !seen.has(child.parentId)) {
      seen.add(child.parentId);
      runningChildren.add(child.parentId);
      child = byId[child.parentId];
    }
  }
  return [...listed].flatMap((id) => {
    const summary = byId[id];
    if (!summary || archived.has(id) || summary.blank || summary.origin === 'subagent') return [];
    const current = status.get(id),
      interaction = current?.pendingInteraction;
    const kind =
      interaction && typeof interaction === 'object' && 'kind' in interaction
        ? interaction.kind
        : undefined;
    const pending =
      kind === 'approval' || kind === 'plan-review' || kind === 'question' ? kind : undefined;
    const running = (current?.running ?? summary.running) || runningChildren.has(id);
    const unread = current?.completionUnread === true;
    const state: SessionState = pending ?? (running ? 'running' : unread ? 'unread' : 'idle');
    const workspace = workspaces.find((w) => w.sessionIds.includes(id));
    return [
      {
        id,
        label: summary.title || titleFor(id) || summary.displayTitle || id.slice(0, 8),
        eligible: true,
        workspaceId: workspace?.id,
        workspaceTitle: workspace?.title || ungrouped,
        status: state,
        running,
        unread,
        activity: pending ? 'waiting' : running ? 'working' : 'idle',
        updatedAt: Number.isFinite(summary.updatedAt) ? summary.updatedAt : undefined,
        cwd: summary.cwd,
        parentId: summary.parentId,
      },
    ];
  });
}
