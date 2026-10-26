import type { SessionFact } from '../office/types.js';

interface NativeSummary {
  readonly blank: boolean;
  readonly origin?: string;
  readonly running: boolean;
  readonly title?: string;
  readonly displayTitle?: string;
}
interface NativeStatus {
  readonly running: boolean | undefined;
  readonly pendingInteraction: unknown;
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
