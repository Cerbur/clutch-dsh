import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text } from './inputs.js';
import * as output from './outputs.js';
import { defaultBase, errorText } from './context.js';

const newArgs = z
  .object({
    name: text.describe(
      'Required NEW Git branch name, for example feature/demo; not a path or existing Worktree id.',
    ),
    baseBranch: text
      .optional()
      .describe(
        'Existing local branch override. Omit to inherit the caller checkout’s committed HEAD; do not assume main.',
      ),
    instructions: z
      .string()
      .max(32000)
      .optional()
      .describe('Optional shared instructions saved for this Worktree; max 32000 characters.'),
  })
  .strict();

export function registerNewWorktree(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_new_worktree',
    'Create a managed Worktree with a new branch. By default captures the calling Session’s healthy Worktree HEAD, or its Workspace root HEAD (including detached HEAD). An explicit local baseBranch overrides this. Uncommitted files are not copied. Returns acquisition baseCommit and baseBranch when branch-attached. Does not create a Session or start the requested work. When the user asks to create a Worktree and implement/fix something, follow with clutch_span_worktree using the returned worktreeId if delegation is enabled; let that Session implement and verify the task.',
    newArgs,
    output.object(
      {
        workspaceId: output.string,
        worktreeId: output.string,
        name: output.string,
        absolutePath: output.string,
        baseBranch: output.string,
        baseCommit: output.string,
        instructionsSaved: output.boolean,
        error: output.string,
        correction: output.string,
      },
      ['workspaceId', 'worktreeId', 'name', 'absolutePath', 'instructionsSaved'],
    ),
    async ({ name, baseBranch, instructions = '' }, exec) => {
      const workspaceId = await scope();
      const base =
        baseBranch === undefined
          ? await defaultBase(agent.session.id, workspaceId, options)
          : undefined;
      check(exec);
      const record =
        base === undefined
          ? await options.manager.createWorktree({
              workspaceId,
              branch: baseBranch!,
              newBranch: name,
            })
          : await options.manager.createWorktreeAtCommit({
              workspaceId,
              baseBranch: base.branch,
              baseCommit: base.commit,
              newBranch: name,
            });
      let error: string | undefined;
      try {
        check(exec);
        if (instructions)
          await options.manager.updateWorktreeInstructions({
            workspaceId,
            worktreeId: record.worktreeId,
            instructions,
            expectedInstructions: '',
          });
      } catch (cause) {
        exec.signal.throwIfAborted();
        error = errorText(cause).slice(0, 700);
      }
      options.changed(workspaceId, record.worktreeId);
      return {
        workspaceId,
        worktreeId: record.worktreeId,
        name: record.branch,
        absolutePath: record.absolutePath,
        baseBranch: record.baseBranch,
        baseCommit: record.baseCommit,
        instructionsSaved: error === undefined,
        ...(error === undefined
          ? {}
          : {
              error,
              correction:
                'The Worktree already exists. Save its instructions through Worktree management using this worktreeId; do not create the branch again.',
            }),
      };
    },
  );
}
