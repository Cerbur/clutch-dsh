import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text } from './inputs.js';
import * as output from './outputs.js';
import { authorize } from './context.js';
import { decodeCursor, latestToolSessionCursor } from './history.js';

const waitArgs = z
  .object({
    sessionIds: z.array(text).min(1).max(8),
    afterCursors: z.record(z.string(), text).optional(),
    timeoutMs: z.number().int().min(0).max(60000).default(30000),
  })
  .strict();

export function registerWaitSessions(context: ToolContext): void {
  const { add, options, check, scope, read } = context;
  add(
    'clutch_wait_sessions',
    'Wait for new messages, turn boundaries, errors or user attention in up to eight Sessions. Pass each Session’s afterCursors for incremental results; otherwise observe from now and return already inactive/waiting Sessions immediately. timeoutMs is 0–60000, default 30000. Does not approve requests or verify completion.',
    waitArgs,
    output.object(
      { workspaceId: output.string, timedOut: output.boolean, sessions: output.array(output.read) },
      ['workspaceId', 'timedOut', 'sessions'],
    ),
    async (args, exec) => {
      const ids = [...new Set(args.sessionIds)];
      if (args.afterCursors && Object.keys(args.afterCursors).some((id) => !ids.includes(id)))
        throw new Error('afterCursors contains an unrequested Session');
      const cursors = new Map<string, string>();
      const workspaceId = await scope();
      for (const id of ids) {
        if (args.afterCursors?.[id]) decodeCursor(id, args.afterCursors[id]);
        await authorize(id, workspaceId, options);
      }
      let wake: (() => void) | undefined;
      let revision = 0;
      const notify = () => {
        revision++;
        wake?.();
      };
      const unsubscribe = options.sessions.subscribe(ids, notify);
      let timedOut = args.timeoutMs === 0;
      const timer = setTimeout(() => {
        timedOut = true;
        notify();
      }, args.timeoutMs);
      const abort = () => notify();
      exec.signal.addEventListener('abort', abort, { once: true });
      try {
        for (const id of ids)
          cursors.set(
            id,
            args.afterCursors?.[id] ??
              latestToolSessionCursor(id, await options.sessions.snapshot(id, exec.signal)),
          );
        for (;;) {
          const before = revision;
          const snapshots = [];
          const changed = [];
          for (const id of ids) {
            const value = await read(id, cursors.get(id), exec);
            snapshots.push(value);
            if (
              value.entries.length > 0 ||
              value.statusChanged ||
              value.hasMore ||
              (args.afterCursors?.[id] === undefined &&
                value.status !== 'running' &&
                value.status !== 'queued')
            )
              changed.push(value);
            cursors.set(id, value.cursor);
          }
          if (changed.length > 0 || timedOut)
            return {
              workspaceId,
              timedOut: changed.length === 0 && timedOut,
              sessions: changed.length > 0 ? changed : snapshots,
            };
          check(exec);
          if (before !== revision) continue;
          await new Promise<void>((resolve) => {
            wake = resolve;
            if (exec.signal.aborted || before !== revision) resolve();
          });
          wake = undefined;
          check(exec);
        }
      } finally {
        clearTimeout(timer);
        unsubscribe();
        exec.signal.removeEventListener('abort', abort);
      }
    },
  );
}
