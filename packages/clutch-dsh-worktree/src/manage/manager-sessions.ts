import type { SessionBinding, WorkspaceId } from '../contract/index.js';
import { providerError } from '../provider/types.js';
import type { WorktreeManagerContext } from './manager-context.js';
import { assertSessionMatchesWorkspace, requireWorkspace, requireWorkspaceForRead, resolveWorktreeWorkspaceRecord, samePhysicalPath } from './manager-support.js';

/** Return active/detached Session relations for one Workspace. */
export async function listBindings(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly SessionBinding[]> {
  await requireWorkspaceForRead(context, input.workspaceId);
  return (await context.sidecar.read(input.workspaceId)).bindings;
}

/** Bind a DSH-created Session whose cwd already targets the Worktree. */
export async function bindSession(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly worktreeId: string; readonly sessionId: string },
): Promise<SessionBinding> {
  const workspace = await requireWorkspace(context, input.workspaceId);

  // Duplicate checks, DSH fact validation, and append happen in one serialized mutation.
  return context.sidecar.mutate(input.workspaceId, async (snapshot) => {
    const worktree = snapshot.worktrees.find((candidate) => candidate.worktreeId === input.worktreeId);
    if (!worktree) {
      throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
      });
    }
    if (worktree.diskCleanup === 'completed') {
      throw providerError('WORKTREE_REMOVED', `Worktree has been cleaned: ${input.worktreeId}`, {
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
      });
    }

    const existing = snapshot.bindings.find((binding) => binding.sessionId === input.sessionId);
    if (existing) {
      if (existing.worktreeId === input.worktreeId && existing.status === 'active') {
        // Exact retries do not write; detached history is never implicitly reactivated.
        return { result: existing, snapshot, changed: false };
      }
      throw providerError('SESSION_ALREADY_BOUND', `Session is already bound to Worktree ${existing.worktreeId}`, {
        sessionId: input.sessionId,
        worktreeId: existing.worktreeId,
      });
    }

    // Session identity, Workspace ownership, and cwd come from DSH; validation never writes corrections back.
    const session = await context.dsh.getSession(input.sessionId);
    if (!session) {
      throw providerError('SESSION_NOT_FOUND', `Session not found: ${input.sessionId}`, {
        sessionId: input.sessionId,
      });
    }
    const resolvedWorktree = await resolveWorktreeWorkspaceRecord(context, workspace, worktree, {
      sessionId: input.sessionId,
    });
    await assertSessionMatchesWorkspace(session, workspace, resolvedWorktree);

    const binding: SessionBinding = {
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      sessionId: input.sessionId,
      status: 'active',
    };
    return {
      result: binding,
      // Worktree Session groups render bindings in sidecar order; prepend the newly created Session.
      snapshot: { ...snapshot, bindings: [binding, ...snapshot.bindings] },
    };
  });
}

/** Capture HEAD only after revalidating native Session ownership and cwd. */
export async function readSessionHead(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly sessionId: string },
): Promise<string> {
  const cwd = await resolveRuntimeCwd(context, input);
  const session = await context.dsh.getSession(input.sessionId);
  if (!session) throw providerError('SESSION_NOT_FOUND', 'Session not found', { sessionId: input.sessionId });
  const bindings = (await context.sidecar.read(input.workspaceId)).bindings.filter(
    (binding) => binding.sessionId === input.sessionId,
  );
  const owned = session.workspaceId === input.workspaceId ||
    (session.workspaceId === undefined && bindings.length === 1 && bindings[0].status === 'active');
  if (session.sessionId !== input.sessionId || !owned || bindings.length > 1 ||
      !session.cwd || !(await samePhysicalPath(session.cwd, cwd))) {
    throw providerError('SESSION_CWD_MISMATCH', 'Session ownership or cwd no longer matches', { sessionId: input.sessionId });
  }
  if (!context.git.resolveCommit) throw providerError('GIT_OPERATION_FAILED', 'Git HEAD resolution is unavailable', {});
  return context.git.resolveCommit(cwd, 'HEAD', { signal: context.signal });
}

/** Derive one execution cwd from the current Workspace and binding projection. */
export async function resolveRuntimeCwd(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly sessionId: string },
): Promise<string> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  const snapshot = await context.sidecar.read(input.workspaceId);
  const binding = snapshot.bindings.find((candidate) => candidate.sessionId === input.sessionId);

  // Detached is a safe main fallback; a broken active relation fails explicitly below.
  if (!binding || binding.status === 'detached') return workspace.rootPath;

  const worktree = snapshot.worktrees.find((candidate) => candidate.worktreeId === binding.worktreeId);
  if (!worktree) {
    throw providerError('WORKTREE_NOT_FOUND', `Active binding points to a missing Worktree: ${binding.worktreeId}`, {
      workspaceId: input.workspaceId,
      worktreeId: binding.worktreeId,
      sessionId: input.sessionId,
    });
  }
  if (worktree.diskCleanup === 'completed') {
    throw providerError('WORKTREE_REMOVED', `Active binding points to a cleaned Worktree: ${worktree.worktreeId}`, {
      workspaceId: input.workspaceId,
      worktreeId: worktree.worktreeId,
      sessionId: input.sessionId,
    });
  }
  return (await resolveWorktreeWorkspaceRecord(context, workspace, worktree, {
    sessionId: input.sessionId,
  })).absolutePath;
}
