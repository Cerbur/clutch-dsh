import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text } from './inputs.js';
import * as output from './outputs.js';

const readArgs = z.object({ sessionId: text, afterCursor: text.optional() }).strict();

export function registerReadSession(context: ToolContext): void {
  const { add, read } = context;
  add(
    'clutch_read_session',
    'Read status and recent Session messages without activating it. Pass returned afterCursor for incremental reads; repeat while hasMore. Large messages are split into exact fragments. idle means a turn ended, not that its task passed verification.',
    readArgs,
    output.read,
    (args, exec) => read(args.sessionId, args.afterCursor, exec),
  );
}
