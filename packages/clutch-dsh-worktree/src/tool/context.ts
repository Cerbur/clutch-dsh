import type { CallingAgent, Options, ToolContext, WorktreeRecord } from './types.js';
import { boundSessionCwdMatchesWorktree } from '../provider/worktree-path.js';
export type { ToolContext } from './types.js';
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
/** Ownership comes from native membership or one active binding, never cwd alone. */
export async function toolWorkspace(sessionId: string, options: Options): Promise<string> {
  const session = await options.dsh.getSession(sessionId);
  if (!session) throw new Error('Calling Session not found');
  if (session.workspaceId) return session.workspaceId;
  const owners: string[] = [];
  for (const item of (await options.dsh.listWorkspaces?.()) ?? []) {
    const bindings = await options.manager.listBindings({ workspaceId: item.workspaceId });
    if (bindings.some((binding) => binding.sessionId === sessionId && binding.status === 'active'))
      owners.push(item.workspaceId);
  }
  if (owners.length !== 1)
    throw new Error('The calling Session must belong to one Workspace or active Worktree binding');
  return owners[0];
}
export function available(record: WorktreeRecord): boolean {
  return (
    record.status === 'active' &&
    record.diskCleanup !== 'completed' &&
    (record.health === undefined || record.health === 'ready')
  );
}
export async function defaultBase(
  sessionId: string,
  workspaceId: string,
  options: Options,
): Promise<{ branch?: string; commit: string }> {
  const bindings = (await options.manager.listBindings({ workspaceId })).filter(
    (binding) => binding.sessionId === sessionId,
  );
  if (bindings.length > 1) throw new Error('Calling Session has ambiguous Worktree bindings');
  const session = await options.dsh.getSession(sessionId);
  if (!session) throw new Error('Calling Session not found');
  if (bindings[0]?.status === 'active') {
    const record = (await options.manager.listWorktrees({ workspaceId })).find(
      (item) => item.worktreeId === bindings[0].worktreeId,
    );
    if (!record || !available(record))
      throw new Error('Calling Worktree needs repair; cannot infer its base branch');
    await options.manager.resolveRuntimeCwd({ workspaceId, sessionId });
    if (!(await boundSessionCwdMatchesWorktree(session.cwd, record, options.samePhysicalPath)))
      throw new Error('Calling Session cwd does not match its Worktree');
    return {
      branch: record.branch,
      commit: await options.manager.readSessionHead({ workspaceId, sessionId }),
    };
  }
  const root = await options.dsh.getWorkspace(workspaceId);
  if (!root || !(await options.samePhysicalPath(session.cwd, root.rootPath)))
    throw new Error('Calling Session is not in the Workspace root; specify baseBranch explicitly');
  const current = (await options.manager.listBranches({ workspaceId })).find(
    (branch) => branch.isCurrent,
  );
  return {
    branch: current?.name,
    commit: await options.manager.readSessionHead({ workspaceId, sessionId }),
  };
}

/** Recheck native identity, binding and physical cwd before cross-Session operations. */
export async function authorize(
  sessionId: string,
  workspaceId: string,
  options: Options,
  write = false,
): Promise<void> {
  const session = await options.dsh.getSession(sessionId);
  if (!session || (session.workspaceId !== undefined && session.workspaceId !== workspaceId))
    throw new Error('Session is outside the calling Workspace or unavailable');
  // The read-only relation listing deliberately tolerates a missing Workspace
  // root. Native admission must still pass Manage's stricter write/cwd gate.
  if (write) await options.manager.resolveRuntimeCwd({ workspaceId, sessionId });
  const bindings = (await options.manager.listBindings({ workspaceId })).filter(
    (binding) => binding.sessionId === sessionId,
  );
  if (bindings.length > 1) throw new Error('Session has ambiguous Worktree bindings');
  const binding = bindings[0];
  if (binding) {
    if (binding.status !== 'active')
      throw new Error('Session binding is detached; repair it before using Session tools');
    const record = (await options.manager.listWorktrees({ workspaceId })).find(
      (item) => item.worktreeId === binding.worktreeId,
    );
    if (
      !record ||
      (write &&
        (record.diskCleanup === 'completed' ||
          (record.health !== undefined && record.health !== 'ready')))
    )
      throw new Error('Session Worktree is unavailable or needs repair');
    if (!(await boundSessionCwdMatchesWorktree(session.cwd, record, options.samePhysicalPath)))
      throw new Error('Session cwd does not match its Worktree');
  } else {
    if (session.workspaceId !== workspaceId)
      throw new Error('Session is outside the calling Workspace or unavailable');
    const root = await options.dsh.getWorkspace(workspaceId);
    if (!root || !(await options.samePhysicalPath(session.cwd, root.rootPath)))
      throw new Error('Session cwd does not match the Workspace root');
  }
}

export function createToolContext(
  agent: CallingAgent,
  options: Options,
  check: ToolContext['check'],
  add: ToolContext['add'],
): ToolContext {
  const scope = async (requested?: string) => {
    const workspaceId = await toolWorkspace(agent.session.id, options);
    if (requested !== undefined && requested !== workspaceId)
      throw new Error('Workspace is outside the calling Session scope');
    return workspaceId;
  };
  return { agent, options, check, add, scope };
}
