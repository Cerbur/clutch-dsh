import type {
  BranchRecord,
  SessionBinding,
  WorktreeManager,
  WorktreeRecord,
} from '../contract/index.js';
import { toWorktreeViewError, type WorktreeViewError } from './worktree-view-errors.js';

export type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'gitNotInstalled'; readonly error: WorktreeViewError }
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

export interface WorktreeViewReader {
  /** Mark one Workspace stale for the next generation. */
  invalidate(workspaceId: string): void;

  /** Return one complete Workspace view, sharing its current generation. */
  read(workspaceId: string): Promise<WorktreeWorkspaceView>;

  /** Read exactly this ordered set; duplicate IDs share one read. */
  readMany(workspaceIds: readonly string[]): Promise<readonly WorktreeWorkspaceView[]>;

  /** Make cache entries and late callbacks inert. */
  dispose(): void;
}

interface WorktreeViewReaderEntry {
  generation: number;
  stale: boolean;
  view?: WorktreeWorkspaceView;
  inFlight?: {
    generation: number;
    promise: Promise<WorktreeWorkspaceView>;
  };
}

/** Merge one freshly read Workspace projection without clearing other ready views. */
export function mergeWorktreeView(
  views: readonly WorktreeWorkspaceView[],
  nextView: WorktreeWorkspaceView,
): readonly WorktreeWorkspaceView[] {
  const index = views.findIndex((view) => view.workspaceId === nextView.workspaceId);
  if (index === -1) return [...views, nextView];
  const merged = [...views];
  merged[index] = nextView;
  return merged;
}

/** Merge explicit Workspace updates while preserving current order and ready references. */
export function mergeWorktreeViews(
  existing: readonly WorktreeWorkspaceView[],
  workspaceIds: readonly string[],
  updates: readonly WorktreeWorkspaceView[],
): readonly WorktreeWorkspaceView[] {
  const byWorkspaceId = new Map(existing.map((view) => [view.workspaceId, view]));
  for (const update of updates) byWorkspaceId.set(update.workspaceId, update);
  return [...new Set(workspaceIds)].flatMap((workspaceId) => {
    const view = byWorkspaceId.get(workspaceId);
    return view === undefined ? [] : [view];
  });
}

export interface WorktreeModalViewLoader {
  invalidate(): void;
  load(
    workspaceId: string,
    onSuccess: (view: WorktreeWorkspaceView) => void,
    onError: (error: WorktreeViewError) => void,
  ): Promise<void>;
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
    case 'gitNotInstalled':
      return [];
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
  if (viewError.code === 'GIT_NOT_INSTALLED') {
    return { status: 'gitNotInstalled', error: viewError };
  }
  if (viewError.code === 'WORKSPACE_NOT_GIT_REPOSITORY') {
    return { status: 'noRepository', error: viewError };
  }
  if (viewError.code === 'WORKTREE_REQUIRES_INITIAL_COMMIT') {
    return { status: 'noInitialCommit', error: viewError };
  }
  return undefined;
}

/** Share complete Workspace reads without allowing stale generations to repopulate the cache. */
export function createWorktreeViewReader(manager: WorktreeManager): WorktreeViewReader {
  const entries = new Map<string, WorktreeViewReaderEntry>();
  let disposed = false;

  const entryFor = (workspaceId: string): WorktreeViewReaderEntry => {
    const current = entries.get(workspaceId);
    if (current !== undefined) return current;
    const created: WorktreeViewReaderEntry = { generation: 0, stale: false };
    entries.set(workspaceId, created);
    return created;
  };

  const read = (workspaceId: string): Promise<WorktreeWorkspaceView> => {
    if (disposed) return Promise.reject(new Error('Worktree view reader disposed'));
    const entry = entryFor(workspaceId);
    if (!entry.stale && entry.view !== undefined) return Promise.resolve(entry.view);
    if (entry.inFlight?.generation === entry.generation) return entry.inFlight.promise;

    const generation = entry.generation;
    const promise = loadWorktreeView(manager, workspaceId)
      .then((data) => {
        const view: WorktreeWorkspaceView = { workspaceId, ...data };
        if (!disposed && entries.get(workspaceId) === entry && entry.generation === generation) {
          entry.view = view;
          entry.stale = false;
        }
        return view;
      })
      .finally(() => {
        if (entry.inFlight?.promise === promise) entry.inFlight = undefined;
      });
    entry.inFlight = { generation, promise };
    return promise;
  };

  return {
    invalidate(workspaceId): void {
      if (disposed) return;
      const entry = entryFor(workspaceId);
      entry.generation += 1;
      entry.stale = true;
      entry.view = undefined;
    },
    read,
    readMany(workspaceIds): Promise<readonly WorktreeWorkspaceView[]> {
      const uniqueIds = [...new Set(workspaceIds)];
      return Promise.all(uniqueIds.map((workspaceId) => read(workspaceId)));
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      entries.clear();
    },
  };
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

/** Isolate modal-target callbacks while sharing the Client Workspace reader. */
export function createWorktreeModalViewLoader(
  reader: WorktreeViewReader,
): WorktreeModalViewLoader {
  const guard = createWorktreeRefreshGuard();
  return {
    invalidate: guard.invalidate,
    load(workspaceId, onSuccess, onError) {
      return guard.run(
        () => reader.read(workspaceId),
        onSuccess,
        (error) => onError(toWorktreeViewError(error)),
      );
    },
  };
}

/** Load one independent projection per DSH Workspace for the flat sidebar hierarchy. */
export async function loadWorktreeViews(
  manager: WorktreeManager,
  workspaceIds: readonly string[],
): Promise<readonly WorktreeWorkspaceView[]> {
  return Promise.all(workspaceIds.map(async (workspaceId) => ({
    workspaceId,
    ...(await loadWorktreeView(manager, workspaceId)),
  })));
}

/** Hide DSH-archived Sessions from the browser-local Worktree projection. */
export function filterArchivedSessionIds(
  sessionIds: readonly string[],
  archivedSessionIds: readonly string[],
): readonly string[] {
  return sessionIds.filter((sessionId) => !archivedSessionIds.includes(sessionId));
}
