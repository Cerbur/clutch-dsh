import type { ToolContext } from './context.js';
import { workspace } from './inputs.js';
import * as output from './outputs.js';
import { errorText } from './context.js';

export function registerListWorktrees(context: ToolContext): void {
  const { add, options, check, scope } = context;
  add(
    'clutch_list_worktrees',
    'List managed Worktrees and local/fetched remote base branches in workspaceId, defaulting to the calling Workspace. Returns stable ids, branch, path, lifecycle and health. Another Workspace is rejected.',
    workspace,
    output.object(
      {
        workspaceId: output.string,
        worktrees: output.array(output.worktree),
        branches: output.array(
          output.object(
            { name: output.string, isCurrent: output.boolean, checkedOut: output.boolean },
            ['name', 'isCurrent', 'checkedOut'],
          ),
        ),
        branchesUnavailable: output.string,
      },
      ['workspaceId', 'worktrees'],
    ),
    async (args, exec) => {
      const workspaceId = await scope(args.workspaceId);
      const records = await options.manager.listWorktrees({ workspaceId });
      let branchFacts;
      try {
        branchFacts = { branches: await options.manager.listBranches({ workspaceId }) };
      } catch (error) {
        check(exec);
        branchFacts = { branchesUnavailable: errorText(error) };
      }
      check(exec);
      return {
        workspaceId,
        ...branchFacts,
        worktrees: records.map((record) => ({
          worktreeId: record.worktreeId,
          branch: record.branch,
          absolutePath: record.absolutePath,
          status: record.status,
          health: record.health,
          diskCleanup: record.diskCleanup,
          baseBranch: record.baseBranch,
          baseCommit: record.baseCommit,
        })),
      };
    },
  );
}
