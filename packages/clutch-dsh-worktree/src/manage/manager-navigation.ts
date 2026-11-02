import { realpath } from 'node:fs/promises';
import { WORKTREE_ERROR_CODES, type WorktreeError, type WorkspaceNavigation } from '../contract/index.js';
import { getWorkspaceGitState, listWorktrees } from './manager-worktrees.js';
import type { WorkspaceCheckout, WorkspaceId } from '../contract/index.js';
import type { WorktreeManagerContext } from './manager-context.js';
import { requireWorkspaceForRead, requireWorkspaceRoot, samePhysicalPath } from './manager-support.js';

/** Request-local facts only. Never passed to transactions or retained after this read. */
export async function readWorkspaceNavigation(
  context: WorktreeManagerContext,
  input: { workspaceId: WorkspaceId },
): Promise<WorkspaceNavigation> {
  await requireWorkspaceForRead(context, input.workspaceId);
  const snapshot = await context.sidecar.read(input.workspaceId);
  const facts = new Map<string, Promise<unknown>>();
  const sharedMethods = new Set(['validateRepository', 'resolveRepositoryRoot', 'listWorktrees', 'resolveCheckoutHead']);
  const git = new Proxy(context.git, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (!sharedMethods.has(String(property))) return value.bind(target);
      return (...args: unknown[]) => {
        // Options carry the same lifecycle signal throughout this request.
        const key = String(property) + JSON.stringify(
          property === 'resolveCheckoutHead' ? args.slice(0, 2) : args.slice(0, 1),
        );
        let pending = facts.get(key);
        if (!pending) {
          const optionsIndex = property === 'resolveCheckoutHead' ? 2 : 1;
          const options = args[optionsIndex] as object | undefined;
          args[optionsIndex] = { ...options, signal: context.signal };
          pending = Promise.resolve().then(() => value.apply(target, args));
          facts.set(key, pending);
        }
        return pending;
      };
    },
  });
  const scoped = { ...context, git };
  const [records, state, checkout] = await Promise.allSettled([
    listWorktrees(scoped, input, snapshot),
    getWorkspaceGitState(scoped, input),
    getWorkspaceCheckout(scoped, input),
  ]);
  if (records.status === 'rejected') throw records.reason;
  let gitState: WorkspaceNavigation['gitState'];
  if (state.status === 'fulfilled') gitState = { ok: true, value: state.value };
  else {
    const error = state.reason as WorktreeError | undefined;
    if (!error || typeof error !== 'object' || Array.isArray(error) ||
        !WORKTREE_ERROR_CODES.includes(error.code) || typeof error.message !== 'string' ||
        !error.details || typeof error.details !== 'object' || Array.isArray(error.details)) throw state.reason;
    gitState = { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  }
  return { worktrees: records.value, bindings: snapshot.bindings,
    mainInstructions: snapshot.mainInstructions ?? '', gitState,
    ...(checkout.status === 'fulfilled' ? { checkout: checkout.value } : {}) };
}

export async function getWorkspaceCheckout(context: WorktreeManagerContext, input: { workspaceId: WorkspaceId }): Promise<WorkspaceCheckout> {
  const workspace = await requireWorkspaceForRead(context, input.workspaceId);
  await requireWorkspaceRoot(workspace);
  const options = { signal: context.signal };
  await context.git.validateRepository(workspace.rootPath, options);
  const gitRootPath = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath, options)
    : workspace.rootPath;
  const worktrees = await context.git.listWorktrees(gitRootPath, options);
  const workspacePath = await realpath(workspace.rootPath);
  for (const worktree of worktrees) {
    if (await samePhysicalPath(worktree.absolutePath, gitRootPath)) {
      let currentHead = worktree.currentHead;
      try {
        currentHead = context.git.resolveCheckoutHead
          ? await context.git.resolveCheckoutHead(gitRootPath, worktree, options)
          : currentHead ?? (worktree.headCommit && worktree.branch && !worktree.detached
            ? { kind: 'branch', name: worktree.branch, commit: worktree.headCommit }
            : undefined);
      } catch {
        currentHead = undefined;
      }
      return {
        gitRootPath,
        workspacePath,
        ...(currentHead === undefined ? {} : { currentHead }),
      };
    }
  }
  return { gitRootPath, workspacePath };
}
