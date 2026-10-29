import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text, prompt } from './inputs.js';
import * as output from './outputs.js';
import { authorize, errorText } from './context.js';
import { toolHandoff } from './guidance.js';

import { randomUUID } from 'node:crypto';
const sendArgs = z
  .object({
    sessionId: text.describe(
      'Session id from clutch_span_worktree or clutch_list_sessions in this Workspace. Requires native membership and healthy binding/cwd, including archived Worktrees. Self/ancestors are forbidden.',
    ),
    prompt,
    mode: z
      .enum(['queue', 'steer'])
      .default('queue')
      .describe(
        'queue: after the current turn; steer: next step boundary. Omitted/null defaults to queue.',
      ),
    requestId: text
      .max(200)
      .optional()
      .describe(
        'Host-returned retry id only; never invent one. Omit for a new message (JSON null also accepted), never an empty string. For uncertain admission reuse the returned id with identical sessionId, prompt and mode.',
      ),
  })
  .strict();

export function registerSendMessage(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_send_message',
    `Send an Agent follow-up to an existing Session. Returns admitted or prompt-failed with requestId, not task completion or a reply. New isolated tasks need clutch_span_worktree when enabled. ${toolHandoff}`,
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
      if (!context.prepareMessage) throw new Error('Delegation admission control is unavailable');
      await context.prepareMessage(args.sessionId, requestId, args.prompt, args.mode, exec, args.requestId !== undefined);
      check(exec);
      try {
        await options.sessions.sendAgentMessage(
          {
            sender: agent,
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
