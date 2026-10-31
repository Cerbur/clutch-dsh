import type { Actor, RecentSession, SessionBoard } from './types.js';

/** Session identity owns a stable visual slot; native state owns unread acknowledgement. */
export function projectSessionBoard(
  sessions: readonly RecentSession[],
  previous: readonly Actor[] = [],
): SessionBoard {
  const recent = [
    ...new Map(sessions.filter((s) => s.eligible).map((s) => [s.id, s])).values(),
  ].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.id.localeCompare(b.id));
  const active = recent.filter((s) => s.status !== 'idle');
  const remaining = new Map(active.map((s) => [s.id, s]));
  const actors: Actor[] = [];
  const occupied = new Set<number>();
  const add = (s: RecentSession, seat: Actor['seat']) => {
    actors.push({
      id: s.id,
      label: s.label,
      workspaceTitle: s.workspaceTitle,
      status: s.status,
      activity: s.activity,
      seat,
      roaming: true,
    });
    occupied.add(seat);
    remaining.delete(s.id);
  };
  for (const actor of previous) {
    const s = remaining.get(actor.id);
    if (s && actors.length < 4 && !occupied.has(actor.seat)) add(s, actor.seat);
  }
  for (const s of remaining.values()) {
    if (actors.length === 4) break;
    const seat = ([0, 1, 2, 3] as const).find((n) => !occupied.has(n))!;
    add(s, seat);
  }
  return {
    sessions: active,
    office: {
      id: 'session-office',
      title: 'Office',
      actors,
      activeCount: active.length,
      overflow: active.length - actors.length,
    },
  };
}
