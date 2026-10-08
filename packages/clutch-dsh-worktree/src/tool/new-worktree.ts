import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text } from './inputs.js';
import * as output from './outputs.js';
import { defaultBase, errorText } from './context.js';

const newArgs = z
  .object({
    name: text,
    baseBranch: text.optional(),
    instructions: z.string().max(32000).optional(),
  })
  .strict();

export function registerNewWorktree(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_new_worktree',
    'Create a managed Worktree with a new branch. By default captures the calling Session’s healthy Worktree HEAD, or its Workspace root HEAD (including detached HEAD). An explicit local baseBranch overrides this. Uncommitted files are not copied. Returns acquisition baseCommit and baseBranch when branch-attached. Does not create a Session.',
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
        error = errorText(cause);
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
        ...(error === undefined ? {} : { error }),
      };
    },
  );
}
