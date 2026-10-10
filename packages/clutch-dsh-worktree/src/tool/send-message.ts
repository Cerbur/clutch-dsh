import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text, prompt } from './inputs.js';
import * as output from './outputs.js';
import { authorize, errorText } from './context.js';
import { delegationHandoff } from './guidance.js';

import { randomUUID } from 'node:crypto';
const sendArgs = z
  .object({
    sessionId: text.describe(
      'Exact native Session id returned by clutch_span_worktree or clutch_list_sessions; not a Worktree id or path.',
    ),
    prompt,
    mode: z
      .enum(['queue', 'steer'])
      .default('queue')
      .describe(
        'queue adds the message after the current turn; steer corrects work at the next step boundary. Omit for queue.',
      ),
    requestId: text
      .max(200)
      .optional()
      .describe(
        'Omit for a new message. Reuse a returned id only to retry the identical prompt after uncertain admission.',
      ),
  })
  .strict();

export function registerSendMessage(context: ToolContext): void {
  const { add, options, check, scope } = context;
  add(
    'clutch_send_message',
    `Continue an existing Session in the calling Workspace. queue (default) runs after the current turn; steer corrects at a native step boundary. Returns admitted or prompt-failed, retaining requestId on failure. Each call gets a fresh requestId; provide the returned requestId only to retry that same message. ${delegationHandoff}`,
    sendArgs,
    output.object(
      {
        workspaceId: output.string,
        sessionId: output.string,
        requestId: output.string,
        accepted: { const: true, type: 'boolean' },
        status: { type: 'string', enum: ['admitted', 'prompt-failed'] },
        error: output.string,
        correction: output.string,
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
        exec.signal.throwIfAborted();
        return {
          ...identity,
          status: 'prompt-failed',
          error: errorText(error).slice(0, 700),
          correction:
            'Admission may have succeeded. Retry the identical prompt using this sessionId and returned requestId; do not create another Session or use a fresh id.',
        };
      }
    },
  );
}
