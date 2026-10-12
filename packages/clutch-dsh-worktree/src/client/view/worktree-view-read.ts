import type {
  BranchRecord,
  SessionBinding,
  WorktreeManager,
  WorktreeRecord,
  WorkspaceCheckout,
} from '../../contract/index.js';
import { toWorktreeViewError, type WorktreeViewError } from './worktree-view-errors.js';

export type WorktreeGitReadiness =
  | { readonly status: 'ready' }
  | { readonly status: 'workspaceMissing'; readonly error: WorktreeViewError }
  | { readonly status: 'gitNotInstalled'; readonly error: WorktreeViewError }
  | { readonly status: 'noRepository'; readonly error: WorktreeViewError }
  | { readonly status: 'noInitialCommit'; readonly error: WorktreeViewError }
  | { readonly status: 'noLocalBranch' };

export interface WorktreeViewData {
  readonly checkout?: WorkspaceCheckout;
  readonly worktrees: readonly WorktreeRecord[];
  readonly branches: readonly BranchRecord[];
  readonly currentBranch?: string | null;
  readonly bindings: readonly SessionBinding[];
  /** Shared instructions for the browser-local Main projection. */
  readonly mainInstructions: string;
  readonly readiness: WorktreeGitReadiness;
}

export interface WorktreeWorkspaceView extends WorktreeViewData {
  readonly workspaceId: string;
}

export interface WorktreeViewReader {
  /** Mark one Workspace stale for the next generation. */
  invalidate(workspaceId: string, options?: { readonly reuseInFlight?: boolean }): void;

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
  const branch = branches.find((branch) => branch.kind !== 'remote' && branch.isCurrent)
    ?? branches.find((branch) => branch.kind !== 'remote') ?? branches[0];
  return branch?.ref ?? branch?.name ?? '';
}

/** Keep a valid user choice across branch-list refreshes, otherwise choose the current branch. */
export function reconcileBaseBranchSelection(
  selectedBranch: string,
  branches: readonly BranchRecord[],
): string {
  if (branches.some((branch) => (branch.ref ?? branch.name) === selectedBranch)) return selectedBranch;
  // The picker resolves unique legacy aliases for presentation. An ambiguous name
  // remains unselected until the user explicitly chooses a complete ref.
  if (branches.some((branch) => branch.name === selectedBranch ||
      (branch.kind === 'remote' && 'remotes/' + branch.name === selectedBranch))) return selectedBranch;
  return selectDefaultBaseBranch(branches);
}

/** Return copyable, read-only setup commands for a Git readiness state. */
export function worktreeSetupCommands(
  status: WorktreeGitReadiness['status'],
): readonly string[] {
  switch (status) {
    case 'workspaceMissing':
      return [];
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
  // 只有确认根目录缺失才降级为 workspaceMissing；未知 Workspace、无效或无法解析的
  // root 继续以自身错误语义上抛，不被误报成目录缺失。
  // Only a confirmed-missing root degrades to workspaceMissing; an unknown Workspace and an
  // invalid or unresolvable root keep their own error semantics instead of being misreported.
  if (viewError.code === 'WORKSPACE_ROOT_MISSING') {
    return { status: 'workspaceMissing', error: viewError };
  }
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
    invalidate(workspaceId, options): void {
      if (disposed) return;
      const entry = entryFor(workspaceId);
      // Read-only menu opens may share a current read. Mutations must retire it.
      if (options?.reuseInFlight && entry.inFlight?.generation === entry.generation) return;
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

/** Read Worktree, Git readiness/HEAD, binding, and Workspace-root Main projections. */
export async function loadWorktreeView(
  manager: WorktreeManager,
  workspaceId: string,
): Promise<WorktreeViewData> {
  const [worktreesResult, branchesResult, bindingsResult, mainInstructionsResult, checkoutResult] =
    await Promise.allSettled([
      manager.listWorktrees({ workspaceId }),
      typeof manager.getWorkspaceGitState === 'function'
        ? manager.getWorkspaceGitState({ workspaceId })
        : manager.listBranches({ workspaceId }),
      manager.listBindings({ workspaceId }),
      typeof manager.getWorktreeInstructions === 'function'
        ? manager.getWorktreeInstructions({ workspaceId, worktreeId: `main:${workspaceId}` })
        : Promise.resolve(''),
      manager.getWorkspaceCheckout?.({ workspaceId }) ?? Promise.resolve(undefined),
    ]);

  if (worktreesResult.status === 'rejected') throw worktreesResult.reason;
  if (bindingsResult.status === 'rejected') throw bindingsResult.reason;
  if (mainInstructionsResult.status === 'rejected') throw mainInstructionsResult.reason;
  let readiness: WorktreeGitReadiness | undefined;
  for (const result of [branchesResult, checkoutResult]) {
    if (result.status !== 'rejected') continue;
    const failureReadiness = readinessFromBranchError(result.reason);
    if (failureReadiness === undefined) throw result.reason;
    readiness = failureReadiness;
  }
  if (readiness !== undefined) {
    return {
      worktrees: worktreesResult.value,
      branches: [],
      bindings: bindingsResult.value,
      mainInstructions: mainInstructionsResult.value,
      readiness,
    };
  }

  const checkout = checkoutResult.status === 'fulfilled' ? checkoutResult.value : undefined;
  const state = branchesResult.status === 'fulfilled' ? branchesResult.value : [];
  const branches = Array.isArray(state) ? state as readonly BranchRecord[] : [];
  const currentBranch = Array.isArray(state)
    ? branches.find((branch) => branch.isCurrent)?.name
    : (state as { currentBranch: string | null }).currentBranch;
  return {
    ...(checkout !== undefined ? { checkout } : {}),
    worktrees: worktreesResult.value,
    branches,
    ...(currentBranch === undefined ? {} : { currentBranch }),
    bindings: bindingsResult.value,
    mainInstructions: mainInstructionsResult.value,
    readiness: (!Array.isArray(state) || branches.length > 0) || checkout?.currentHead !== undefined
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
