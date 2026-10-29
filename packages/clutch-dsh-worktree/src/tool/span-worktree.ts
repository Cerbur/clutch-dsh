import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text, prompt, model } from './inputs.js';
import * as output from './outputs.js';
import { available } from './context.js';
import { toolHandoff } from './guidance.js';

import { dispatchWorktreeSession } from './dispatch-session.js';
const common = {
  prompt: prompt.describe('Self-contained task with goal, scope, acceptance criteria and checks; delivered verbatim. Must be nonblank.'),
  model: model.optional(),
  title: text.max(200).optional().describe('New Session title; omitted/null keeps the native title.'),
};
const spanArgs = z
  .object({
    ...common,
    worktreeId: text.optional().describe(
      'Preferred target id from clutch_new_worktree or clutch_list_worktrees. Exactly one non-null worktreeId or name is required.',
    ),
    name: text.optional().describe(
      'Legacy target: exact branch name from clutch_list_worktrees, instead of worktreeId. Omitted/null means absent.',
    ),
  })
  .strict()
  .superRefine((args, ctx) => {
    if ((args.worktreeId !== undefined) === (args.name !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['worktreeId'],
        message: 'Supply exactly one of worktreeId or legacy name, never both',
      });
  });

export function registerSpanWorktree(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_span_worktree',
    `Delegate implementation and verification to a new Session in an active healthy Worktree in this Workspace. Binds it and enables reporting, not permissions; delivers an Agent relay. Returns sessionId, requestId and admission stage, not completion. Inherits the caller’s provider, model and reasoning effort unless overridden. Honor human model requirements; discover with clutch_list_models only when enabled, otherwise ask for unknown routes. Validates models before creation. Partial failures retain the Session: repair its stage, never redispatch. For prompt-failed, retry the identical prompt via clutch_send_message with returned ids. ${toolHandoff}`,
    spanArgs,
    output.object(
      {
        workspaceId: output.string,
        worktreeId: output.string,
        sessionId: output.string,
        status: {
          type: 'string',
          enum: [
            'dispatched',
            'binding-failed',
            'model-failed',
            'title-failed',
            'prompt-failed',
            'reporting-failed',
          ],
        },
        model: output.model,
        requestId: output.string,
        error: output.string,
        correction: output.string,
      },
      ['workspaceId', 'worktreeId', 'sessionId', 'status', 'model', 'requestId'],
    ),
    async (args, exec) => {
      context.delegation.assertDispatch(agent);
      const workspaceId = await scope();
      const { worktreeId, name } = args;
      const matches = (await options.manager.listWorktrees({ workspaceId })).filter(
        (record) =>
          record.status === 'active' &&
          (worktreeId === undefined ? record.branch === name : record.worktreeId === worktreeId),
      );
      if (matches.length !== 1 || !available(matches[0]))
        throw new Error('Worktree must identify exactly one active, healthy managed Worktree');
      const record = matches[0];
      const selected = await options.sessions.validateModel(
        args.model ?? (await options.sessions.currentModel(agent.session.id, exec.signal)),
        exec.signal,
      );
      check(exec);
      context.delegation.assertDispatch(agent);
      const result = await dispatchWorktreeSession({
        record, manager: options.manager, sessions: options.sessions, model: selected,
        prompt: args.prompt, sender: agent, title: args.title, signal: exec.signal,
        check: () => check(exec),
        prepare: async (sessionId, requestId) => {
          if (!context.enableChild) throw new Error('Delegated Session reporting setup is unavailable');
          await context.enableChild(sessionId, requestId, args.prompt, 'queue', exec);
        },
      });
      const { sessionId, requestId, status, error } = result;
      options.changed(workspaceId, record.worktreeId);
      return {
        workspaceId,
        worktreeId: record.worktreeId,
        sessionId,
        status,
        model: selected,
        requestId,
        ...(error === undefined
          ? {}
          : {
              error,
              correction: `Session ${sessionId} already exists; ${status}. Repair that stage before continuing. Do not dispatch again. For prompt-failed, retry the identical prompt with clutch_send_message using this sessionId and requestId.`,
            }),
      };
    },
  );
}
