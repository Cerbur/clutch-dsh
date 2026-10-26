import type { Actor, Office, SessionFact, WorkspaceFact } from './types.js';

/** Preserve admitted actors and station seats while they remain active. */
export function projectOffices(
  workspaces: readonly WorkspaceFact[],
  sessions: ReadonlyMap<string, SessionFact>,
  previous: readonly Office[] = [],
): Office[] {
  return workspaces.map((workspace) => {
    const active = [...new Set(workspace.sessionIds)].flatMap((id) => {
      const fact = sessions.get(id);
      return fact?.eligible && fact.activity !== 'idle' && fact.activity !== 'unknown'
        ? [fact]
        : [];
    });
    const byId = new Map(active.map((fact) => [fact.id, fact]));
    const actors: Actor[] = [];
    const occupied = new Set<number>();
    for (const actor of previous.find((office) => office.id === workspace.id)?.actors ?? []) {
      const fact = byId.get(actor.id);
      if (!fact || actors.length >= 2) continue;
      actors.push({ ...actor, label: fact.label, activity: fact.activity });
      occupied.add(actor.seat);
      byId.delete(actor.id);
    }
    for (const fact of byId.values()) {
      if (actors.length === 2) break;
      const seat = occupied.has(0) ? 1 : 0;
      actors.push({ id: fact.id, label: fact.label, activity: fact.activity, seat });
      occupied.add(seat);
    }
    return {
      id: workspace.id,
      title: workspace.title,
      actors,
      activeCount: active.length,
      overflow: active.length - actors.length,
    };
  });
}
