import type { RecentSession } from '../office/types.js';

export interface ActivityClock {
  readonly running: boolean;
  readonly updatedAt: number | undefined;
  readonly since: number | undefined;
}

/** Mirrors notification-bell display clocks, never persisted or treated as native events. */
export function activityClocks(
  previous: ReadonlyMap<string, ActivityClock>,
  sessions: readonly RecentSession[],
  now: number,
): ReadonlyMap<string, ActivityClock> {
  return new Map(
    sessions.map((session) => {
      const old = previous.get(session.id);
      const updatedAt = Number.isFinite(session.updatedAt) ? session.updatedAt : undefined;
      const transitioned = old !== undefined && old.running !== session.running;
      const newPrompt =
        session.running &&
        updatedAt !== undefined &&
        (old?.updatedAt === undefined || updatedAt > old.updatedAt);
      return [
        session.id,
        {
          running: session.running,
          updatedAt,
          since: transitioned ? now : newPrompt ? updatedAt : (old?.since ?? updatedAt),
        },
      ];
    }),
  );
}

export function elapsedTime(since: number | undefined, now: number): string | undefined {
  if (since === undefined || !Number.isFinite(since) || !Number.isFinite(now)) return undefined;
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
