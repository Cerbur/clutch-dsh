import { z } from 'zod';
import type { ToolContext } from './context.js';
import { text } from './inputs.js';
import * as output from './outputs.js';
import { defaultBase, errorText } from './context.js';

const newArgs = z
  .object({
    name: text.describe(
      'New Git branch name, e.g. feature/demo; not a path or Worktree id.',
    ),
    baseBranch: text
      .optional()
      .describe(
        'Local/fetched remote base branch. Omitted/null captures the caller’s healthy Worktree HEAD or Workspace root HEAD, including detached HEAD; never assumes main.',
      ),
    instructions: z
      .string()
      .max(32000)
      .optional()
      .describe('Shared Worktree instructions; omitted/null/empty saves none.'),
  })
  .strict();

export function registerNewWorktree(context: ToolContext): void {
  const { add, agent, options, check, scope } = context;
  add(
    'clutch_new_worktree',
    'Create a managed Worktree and branch; uncommitted files stay behind. Returns worktreeId, path, baseCommit and branch-attached baseBranch. Creates no Session: for create-and-implement requests, follow with clutch_span_worktree when enabled. instructionsSaved:false retains the Worktree; repair its instructions, never recreate it. Never automatically retry uncertain creation.',
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
