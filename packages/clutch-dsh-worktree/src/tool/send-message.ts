import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text, prompt } from './inputs.js';
import * as output from './outputs.js';
import { authorize, errorText } from './context.js';

import { randomUUID } from 'node:crypto';
const sendArgs = z
  .object({
    sessionId: text,
    prompt,
    mode: z.enum(['queue', 'steer']).default('queue'),
    requestId: text.max(200).optional(),
  })
  .strict();

export function registerSendMessage(context: ToolContext): void {
  const { add, options, check, scope } = context;
  add(
    'clutch_send_message',
    'Continue an existing Session in the calling Workspace. queue (default) runs after the current turn; steer corrects at a native step boundary. Returns admitted or prompt-failed, retaining requestId on failure. Each call gets a fresh requestId; provide the returned requestId only to retry that same message.',
    sendArgs,
    output.object(
      {
        workspaceId: output.string,
        sessionId: output.string,
        requestId: output.string,
        accepted: { const: true, type: 'boolean' },
        status: { type: 'string', enum: ['admitted', 'prompt-failed'] },
        error: output.string,
        mode: { type: 'string', enum: ['queue', 'steer'] },
      },
      ['workspaceId', 'sessionId', 'requestId', 'status', 'mode'],
    ),
    async (args, exec) => {
      const workspaceId = await scope();
      await authorize(args.sessionId, workspaceId, options, true);
      check(exec);
      const requestId = args.requestId ?? `clutch-worktree:${randomUUID()}`;
      const identity = { workspaceId, sessionId: args.sessionId, requestId, mode: args.mode };
      try {
        await options.sessions.prompt(
          {
            sessionId: args.sessionId,
            requestId,
            mode: args.mode,
            content: [{ type: 'text', text: args.prompt }],
          },
          exec.signal,
        );
        return { ...identity, status: 'admitted', accepted: true };
      } catch (error) {
        // Admission may already have committed. Keep its retry identity
        // so native deduplication, not a new message, resolves uncertainty.
        return { ...identity, status: 'prompt-failed', error: errorText(error) };
      }
    },
  );
}
