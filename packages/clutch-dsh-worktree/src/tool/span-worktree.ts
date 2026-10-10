import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text, prompt, model } from './inputs.js';
import * as output from './outputs.js';
import { available, errorText } from './context.js';

import { randomUUID } from 'node:crypto';
const common = {
  prompt,
  model: model.optional(),
  title: text.max(200).optional().describe('Optional new Session title; max 200 characters.'),
};
const spanArgs = z.union([
  z
    .object({
      ...common,
      worktreeId: text.describe(
        'Stable id returned by clutch_new_worktree or clutch_list_worktrees. Preferred target; do not also supply name.',
      ),
    })
    .strict(),
  z
    .object({
      ...common,
      name: text.describe(
        'Legacy alternative: exact branch name from clutch_list_worktrees. Do not also supply worktreeId.',
      ),
    })
    .strict(),
]);

export function registerSpanWorktree(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_span_worktree',
    'Delegate implementation and verification to a fresh ordinary DSH Session in a healthy managed Worktree. Use after clutch_new_worktree for requests to create a feature Worktree and implement/fix something; pass a self-contained prompt including requirements, acceptance criteria and checks. Prefer worktreeId; legacy exact branch name is accepted, but provide only one. model defaults to the caller’s provider/model/effort without changing the deployment default. Automatically enables only result reporting by default; other capabilities require /cluworktree or explicit Worktree automatic-injection preferences. Returns admission, not completion; results are pushed back to you. Do not poll. Partial failures preserve the Session; repair it before retrying.',
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
      const workspaceId = await scope();
      const worktreeId = 'worktreeId' in args ? args.worktreeId : undefined;
      const name = 'name' in args ? args.name : undefined;
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
        status = 'reporting-failed';
        if (!context.enableChild)
          throw new Error('Delegated Session reporting setup is unavailable');
        await context.enableChild(sessionId, exec);
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
        exec.signal.throwIfAborted();
        error = errorText(cause).slice(0, 700);
      }
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
