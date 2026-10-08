import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text, prompt, model } from './inputs.js';
import * as output from './outputs.js';
import { available, errorText } from './context.js';

import { randomUUID } from 'node:crypto';
const spanArgs = z
  .object({
    worktreeId: text.optional(),
    name: text.optional(),
    prompt,
    model: model.optional(),
    title: text.max(200).optional(),
  })
  .strict()
  .refine(
    (value) => (value.worktreeId === undefined) !== (value.name === undefined),
    'Specify exactly one worktreeId or name',
  );

export function registerSpanWorktree(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_span_worktree',
    'Create a fresh ordinary DSH Session in a healthy managed Worktree and dispatch prompt. Prefer worktreeId; legacy exact branch name is accepted, but provide only one. model defaults to the caller’s provider/model/effort without changing the deployment default. Returns admission, not completion. Partial failures preserve the Session; repair it before retrying.',
    spanArgs,
    output.object(
      {
        workspaceId: output.string,
        worktreeId: output.string,
        sessionId: output.string,
        status: {
          type: 'string',
          enum: ['dispatched', 'binding-failed', 'model-failed', 'title-failed', 'prompt-failed'],
        },
        model: output.model,
        requestId: output.string,
        error: output.string,
      },
      ['workspaceId', 'worktreeId', 'sessionId', 'status', 'model', 'requestId'],
    ),
    async (args, exec) => {
      const workspaceId = await scope();
      const matches = (await options.manager.listWorktrees({ workspaceId })).filter(
        (record) =>
          record.status === 'active' &&
          (args.worktreeId === undefined
            ? record.branch === args.name
            : record.worktreeId === args.worktreeId),
      );
      if (matches.length !== 1 || !available(matches[0]))
        throw new Error('Worktree must identify exactly one active, healthy managed Worktree');
      const record = matches[0];
      const selected = await options.sessions.validateModel(
        args.model ?? (await options.sessions.currentModel(agent.session.id, exec.signal)),
        exec.signal,
      );
      check(exec);
      const { sessionId } = await options.sessions.create({ cwd: record.absolutePath });
      let status = 'binding-failed';
      let error: string | undefined;
      const requestId = `clutch-worktree:${sessionId}:${randomUUID()}`;
      try {
        check(exec);
        await options.manager.bindSession({
          workspaceId,
          worktreeId: record.worktreeId,
          sessionId,
        });
        status = 'model-failed';
        check(exec);
        await options.sessions.configureModel(sessionId, selected, exec.signal);
        if (args.title) {
          status = 'title-failed';
          check(exec);
          await options.sessions.rename({ sessionId, title: args.title });
        }
        status = 'prompt-failed';
        check(exec);
        await options.sessions.prompt(
          {
            sessionId,
            requestId,
            mode: 'queue',
            content: [{ type: 'text', text: args.prompt }],
          },
          exec.signal,
        );
        status = 'dispatched';
      } catch (cause) {
        error = errorText(cause);
      }
      options.changed(workspaceId, record.worktreeId);
      return {
        workspaceId,
        worktreeId: record.worktreeId,
        sessionId,
        status,
        model: selected,
        requestId,
        ...(error === undefined ? {} : { error }),
      };
    },
  );
}
