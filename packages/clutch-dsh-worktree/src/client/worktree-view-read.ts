import type {
  BranchRecord,
  SessionBinding,
  WorktreeManager,
  WorktreeRecord,
} from '../contract/index.js';
import { toWorktreeViewError, type WorktreeViewError } from './worktree-view-errors.js';

export type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'noRepository'; readonly error: WorktreeViewError }
  | { readonly status: 'noInitialCommit'; readonly error: WorktreeViewError }
  | { readonly status: 'noLocalBranch' };

export interface WorktreeViewData {
  readonly worktrees: readonly WorktreeRecord[];
  readonly branches: readonly BranchRecord[];
  readonly bindings: readonly SessionBinding[];
  readonly readiness: WorktreeGitReadiness;
}

export interface WorktreeWorkspaceView extends WorktreeViewData {
  readonly workspaceId: string;
}

export interface LoadWorktreeViewsOptions {
  readonly invalidateContext?: boolean;
  readonly invalidateWorktreeContext?: () => Promise<void>;
}

/** Reuse the previous ID snapshot when DSH republishes equivalent Workspace items. */
export function stableWorkspaceIds(
  previous: readonly string[],
  next: readonly string[],
): readonly string[] {
  if (previous.length !== next.length) return next;
  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) return next;
  }
  return previous;
}

/** Keep only the most recently started Worktree surface refresh authoritative. */
export function createWorktreeRefreshGuard() {
  let latestGeneration = 0;
  const begin = (): number => {
    latestGeneration += 1;
    return latestGeneration;
  };
  const isCurrent = (generation: number): boolean => generation === latestGeneration;
  const invalidate = (): void => {
    latestGeneration += 1;
  };

  return {
    begin,
    isCurrent,
    invalidate,
    async run<T>(
      load: () => Promise<T>,
      onSuccess: (value: T) => void,
      onError: (error: unknown) => void,
    ): Promise<void> {
      const generation = begin();
      let value: T;
      try {
        value = await load();
      } catch (error) {
        if (!isCurrent(generation)) return;
        onError(error);
        return;
      }
      if (!isCurrent(generation)) return;
      onSuccess(value);
    },
  };
}

/** Prefer the branch checked out by the DSH Workspace, then fall back to any local branch. */
export function selectDefaultBaseBranch(branches: readonly BranchRecord[]): string {
  return branches.find((branch) => branch.isCurrent)?.name ?? branches[0]?.name ?? '';
}

/** Keep a valid user choice across branch-list refreshes, otherwise choose the current branch. */
export function reconcileBaseBranchSelection(
  selectedBranch: string,
  branches: readonly BranchRecord[],
): string {
  if (branches.some((branch) => branch.name === selectedBranch)) return selectedBranch;
  return selectDefaultBaseBranch(branches);
}

/** Return copyable, read-only setup commands for a Git readiness state. */
export function worktreeSetupCommands(
  status: WorktreeGitReadiness['status'],
): readonly string[] {
  switch (status) {
    case 'noRepository':
      return [
        'git init',
        'printf "# README\\n" > README.md',
        'git add README.md',
        'git commit -m "Initial commit"',
      ];
    case 'noInitialCommit':
      return [
        'printf "# README\\n" > README.md',
        'git add README.md',
        'git commit -m "Initial commit"',
      ];
    case 'noLocalBranch':
      return ['git switch -c main'];
    case 'ready':
      return [];
  }
}

function readinessFromBranchError(error: unknown): WorktreeGitReadiness | undefined {
  const viewError = toWorktreeViewError(error);
  if (viewError.code === 'WORKSPACE_NOT_GIT_REPOSITORY') {
    return { status: 'noRepository', error: viewError };
  }
  if (viewError.code === 'WORKTREE_REQUIRES_INITIAL_COMMIT') {
    return { status: 'noInitialCommit', error: viewError };
  }
  return undefined;
}

/** Read all three Worktree projections needed by the surface in one refresh. */
export async function loadWorktreeView(
  manager: WorktreeManager,
  workspaceId: string,
): Promise<WorktreeViewData> {
  const [worktreesResult, branchesResult, bindingsResult] = await Promise.allSettled([
    manager.listWorktrees({ workspaceId }),
    manager.listBranches({ workspaceId }),
    manager.listBindings({ workspaceId }),
  ]);

  if (worktreesResult.status === 'rejected') throw worktreesResult.reason;
  if (bindingsResult.status === 'rejected') throw bindingsResult.reason;
  if (branchesResult.status === 'rejected') {
    const readiness = readinessFromBranchError(branchesResult.reason);
    if (readiness !== undefined) {
      return {
        worktrees: worktreesResult.value,
        branches: [],
        bindings: bindingsResult.value,
        readiness,
      };
    }
    throw branchesResult.reason;
  }

  return {
    worktrees: worktreesResult.value,
    branches: branchesResult.value,
    bindings: bindingsResult.value,
    readiness: branchesResult.value.length > 0
      ? { status: 'ready' }
      : { status: 'noLocalBranch' },
  };
}

/** Load one independent projection per DSH Workspace for the flat sidebar hierarchy. */
export async function loadWorktreeViews(
  manager: WorktreeManager,
  workspaceIds: readonly string[],
  options: LoadWorktreeViewsOptions = {},
): Promise<readonly WorktreeWorkspaceView[]> {
  const views = await Promise.all(
    workspaceIds.map(async (workspaceId) => ({
      workspaceId,
      ...(await loadWorktreeView(manager, workspaceId)),
    })),
  );
  if (options.invalidateContext !== false) {
    await options.invalidateWorktreeContext?.();
  }
  return views;
}

/** Hide DSH-archived Sessions from the browser-local Worktree projection. */
export function filterArchivedSessionIds(
  sessionIds: readonly string[],
  archivedSessionIds: readonly string[],
): readonly string[] {
  return sessionIds.filter((sessionId) => !archivedSessionIds.includes(sessionId));
}
