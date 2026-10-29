import type { ToolContext } from './context.js';
import { text, workspace } from './inputs.js';
import * as output from './outputs.js';
import { authorize, errorText } from './context.js';
import { latestToolSessionCursor, readToolSession } from './history.js';

const listSessionsArgs = workspace
  .extend({
    worktreeId: text
      .optional()
      .describe(
        'Worktree id from clutch_new_worktree or clutch_list_worktrees. Omitted/null includes Local/Main and all bound Sessions.',
      ),
  })
  .strict();

export function registerListSessions(context: ToolContext): void {
  const { add, options, check, scope } = context;
  add(
    'clutch_list_sessions',
    'Find Workspace Sessions for follow-ups or explicit human status questions. Returns ids, bindings, observed status, titles and per-entry diagnostics. Read-only; no transcripts or verified completion. These are ordinary Sessions, not native subagents. Do not use for routine monitoring.',
    listSessionsArgs,
    output.object(
      {
        workspaceId: output.string,
        sessions: output.array(
          output.object(
            {
              sessionId: output.string,
              worktreeId: output.string,
              bindingStatus: output.string,
              cwd: output.string,
              status: output.string,
              title: output.string,
              diagnostic: output.string,
            },
            ['sessionId', 'bindingStatus', 'status'],
          ),
        ),
      },
      ['workspaceId', 'sessions'],
    ),
    async (args, exec) => {
      const workspaceId = await scope(args.workspaceId);
      const bindings = await options.manager.listBindings({ workspaceId });
      if (
        args.worktreeId !== undefined &&
        !(await options.manager.listWorktrees({ workspaceId })).some(
          (item) => item.worktreeId === args.worktreeId,
        )
      )
        throw new Error('Worktree not found in the calling Workspace');
      const candidates = (await options.dsh.listSessions()).filter((session) => {
        const binding = bindings.find((item) => item.sessionId === session.sessionId);
        return (
          (session.workspaceId === workspaceId || binding !== undefined) &&
          (session.workspaceId === undefined || session.workspaceId === workspaceId) &&
          (args.worktreeId === undefined || binding?.worktreeId === args.worktreeId)
        );
      });
      const items = [];
      for (const session of candidates) {
        check(exec);
        const binding = bindings.find((item) => item.sessionId === session.sessionId);
        try {
          await authorize(session.sessionId, workspaceId, options);
          const snapshot = await options.sessions.snapshot(session.sessionId, exec.signal);
          check(exec);
          const value = readToolSession(
            session.sessionId,
            snapshot,
            latestToolSessionCursor(session.sessionId, snapshot),
          );
          items.push({
            sessionId: session.sessionId,
            worktreeId: binding?.worktreeId,
            bindingStatus: binding?.status ?? 'main',
            cwd: session.cwd,
            status: value.status,
            title: typeof snapshot.values.title === 'string' ? snapshot.values.title : undefined,
          });
        } catch (error) {
          check(exec);
          items.push({
            sessionId: session.sessionId,
            worktreeId: binding?.worktreeId,
            bindingStatus: binding?.status ?? 'main',
            status: 'unavailable',
            diagnostic: `Cannot inspect this Session: ${errorText(error).slice(0, 500)}. Other Sessions remain available. Repair this Session in DSH; do not repeatedly query the whole list to retry its history migration.`,
          });
          continue;
        }
      }
      return { workspaceId, sessions: items };
    },
  );
}
