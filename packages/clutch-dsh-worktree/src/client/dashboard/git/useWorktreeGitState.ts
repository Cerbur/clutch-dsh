import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { WORKTREE_GIT_WORKING_TREE } from '../../../contract/index.js';
import type {
  BranchRecord,
  WorktreeGitChangedFile,
  WorktreeGitCommitFiles,
  WorktreeGitDiffSelection,
  WorktreeGitFileDiff,
  WorktreeGitHistory,
  WorktreeManager,
} from '../../../contract/index.js';

export type GitLoadable<Value> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly value: Value;
      readonly refreshing?: boolean;
      readonly error?: Error;
    }
  | { readonly status: 'error'; readonly error: Error; readonly previous?: Value };

export type WorktreeGitView = 'commits' | 'summary';

type GitTarget =
  | { readonly kind: 'commit'; readonly commit: string }
  | { readonly kind: 'selection'; readonly selection: WorktreeGitDiffSelection };

export interface WorktreeGitState {
  readonly branches: GitLoadable<readonly BranchRecord[]>;
  /** The currently selected local branch; undefined keeps the Git tab unselected. */
  readonly baselineBranch?: string;
  readonly history: GitLoadable<WorktreeGitHistory>;
  readonly view: WorktreeGitView;
  /** The focused/primary commit; aggregate selections are in selectedCommits. */
  readonly selectedCommit?: string;
  /** Selected committed SHAs; the live working tree is intentionally excluded. */
  readonly selectedCommits: readonly string[];
  readonly files: GitLoadable<WorktreeGitCommitFiles>;
  readonly selectedPath?: string;
  readonly diff: GitLoadable<WorktreeGitFileDiff>;
}

export interface WorktreeGitStateController {
  readonly getSnapshot: () => WorktreeGitState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly loadBranches: () => Promise<void>;
  readonly loadHistory: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly selectBaselineBranch: (branch: string | undefined) => void;
  readonly selectView: (view: WorktreeGitView) => void;
  readonly selectSummary: () => void;
  readonly selectCommit: (commit: string) => void;
  readonly toggleCommit: (commit: string) => void;
  readonly clearCommitSelection: () => void;
  readonly selectPath: (path: string) => void;
  readonly dispose: () => void;
}

interface ControllerInput {
  readonly manager?: Pick<
    WorktreeManager,
    'listBranches' | 'listWorktreeCommits' | 'listWorktreeCommitFiles' | 'getWorktreeCommitFileDiff'
  >;
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly defaultBaselineBranch?: string;
}

const MAX_FILE_CACHE = 8;
const MAX_DIFF_CACHE = 24;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function normalizeBranch(branch: string | undefined): string | undefined {
  const normalized = branch?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function emptyState(defaultBaselineBranch: string | undefined): WorktreeGitState {
  return {
    branches: { status: 'idle' },
    baselineBranch: normalizeBranch(defaultBaselineBranch),
    history: { status: 'idle' },
    view: 'commits',
    selectedCommits: [],
    files: { status: 'idle' },
    diff: { status: 'idle' },
  };
}

function fileForPath(
  files: WorktreeGitCommitFiles,
  selectedPath: string,
): WorktreeGitChangedFile | undefined {
  return files.files.find((file) => file.path === selectedPath || file.oldPath === selectedPath);
}

function historyProjectionKey(history: GitLoadable<WorktreeGitHistory>): string {
  if (history.status !== 'ready') return 'unknown';
  return (history.value.baseline?.commit ?? 'unknown') + '\u0000' + (history.value.headCommit ?? 'unknown');
}

function targetKey(target: GitTarget): string {
  if (target.kind === 'commit') return 'commit\u0000' + target.commit;
  if (target.selection.kind === 'summary') return 'summary';
  return 'commits\u0000' + target.selection.commits.join('\u0000');
}

function gitCacheKey(
  baseBranch: string,
  history: GitLoadable<WorktreeGitHistory>,
  target: GitTarget,
): string {
  return baseBranch + '\u0000' + historyProjectionKey(history) + '\u0000' + targetKey(target);
}

function diffCacheKey(
  baseBranch: string,
  history: GitLoadable<WorktreeGitHistory>,
  target: GitTarget,
  filePath: string,
): string {
  return gitCacheKey(baseBranch, history, target) + '\u0000' + filePath;
}

function trimCache<Value>(cache: Map<string, Value>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function isCommittedSha(commit: string): boolean {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(commit);
}

function canonicalizeCommits(
  history: WorktreeGitHistory | undefined,
  commits: readonly string[],
): readonly string[] {
  if (history === undefined) return [];
  const requested = new Set(commits.filter((commit) => isCommittedSha(commit)));
  return history.commits
    .filter((commit) => commit.sha !== WORKTREE_GIT_WORKING_TREE && requested.has(commit.sha))
    .map((commit) => commit.sha);
}

/**
 * Create the browser-safe Git Dashboard state machine. Construction is inert;
 * the caller explicitly starts history loading on first Git-tab activation.
 */
export function createWorktreeGitStateController(input: ControllerInput): WorktreeGitStateController {
  let state = emptyState(input.defaultBaselineBranch);
  let disposed = false;
  let branchesLoaded = false;
  let branchesRequest = 0;
  let historyLoaded = false;
  let historyRequest = 0;
  let filesRequest = 0;
  let diffRequest = 0;
  let branchesInFlight: Promise<void> | undefined;
  let historyInFlight: Promise<void> | undefined;
  const filesInFlight = new Map<string, Promise<WorktreeGitCommitFiles>>();
  const diffInFlight = new Map<string, Promise<WorktreeGitFileDiff>>();
  const listeners = new Set<() => void>();
  const filesCache = new Map<string, WorktreeGitCommitFiles>();
  const diffCache = new Map<string, WorktreeGitFileDiff>();

  const emit = (): void => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };
  const update = (next: WorktreeGitState): void => {
    if (disposed) return;
    state = next;
    emit();
  };

  const invalidateWorkingTreeCache = (): void => {
    const marker = '\u0000' + WORKTREE_GIT_WORKING_TREE;
    for (const key of filesCache.keys()) {
      if (key === WORKTREE_GIT_WORKING_TREE || key.includes(marker)) filesCache.delete(key);
    }
    for (const key of diffCache.keys()) {
      if (key.includes(marker + '\u0000')) diffCache.delete(key);
    }
  };

  const currentTarget = (): GitTarget | undefined => {
    if (state.view === 'summary') return { kind: 'selection', selection: { kind: 'summary' } };
    if (state.selectedCommit === undefined) return undefined;
    if (
      state.selectedCommit !== WORKTREE_GIT_WORKING_TREE &&
      state.selectedCommits.length > 1
    ) {
      return { kind: 'selection', selection: { kind: 'commits', commits: state.selectedCommits } };
    }
    return { kind: 'commit', commit: state.selectedCommit };
  };

  const requestFiles = (baseBranch: string, history: GitLoadable<WorktreeGitHistory>, target: GitTarget): Promise<WorktreeGitCommitFiles> => {
    const key = gitCacheKey(baseBranch, history, target);
    const existing = filesInFlight.get(key);
    if (existing !== undefined) return existing;
    if (input.manager === undefined) return Promise.reject(new Error('Git manager unavailable'));

    const request = target.kind === 'commit'
      ? { commit: target.commit }
      : { selection: target.selection };
    let promise: Promise<WorktreeGitCommitFiles>;
    try {
      promise = input.manager.listWorktreeCommitFiles({
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
        ...request,
        baseBranch,
      });
    } catch (error) {
      promise = Promise.reject(error);
    }
    filesInFlight.set(key, promise);
    void promise.then(
      () => {
        if (filesInFlight.get(key) === promise) filesInFlight.delete(key);
      },
      () => {
        if (filesInFlight.get(key) === promise) filesInFlight.delete(key);
      },
    );
    return promise;
  };

  const requestDiff = (baseBranch: string, history: GitLoadable<WorktreeGitHistory>, target: GitTarget, diffPath: string): Promise<WorktreeGitFileDiff> => {
    const key = diffCacheKey(baseBranch, history, target, diffPath);
    const existing = diffInFlight.get(key);
    if (existing !== undefined) return existing;
    if (input.manager === undefined) return Promise.reject(new Error('Git manager unavailable'));

    const request = target.kind === 'commit'
      ? { commit: target.commit }
      : { selection: target.selection };
    let promise: Promise<WorktreeGitFileDiff>;
    try {
      promise = input.manager.getWorktreeCommitFileDiff({
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
        ...request,
        path: diffPath,
        baseBranch,
      });
    } catch (error) {
      promise = Promise.reject(error);
    }
    diffInFlight.set(key, promise);
    void promise.then(
      () => {
        if (diffInFlight.get(key) === promise) diffInFlight.delete(key);
      },
      () => {
        if (diffInFlight.get(key) === promise) diffInFlight.delete(key);
      },
    );
    return promise;
  };

  const loadDiff = async (
    target: GitTarget,
    selectedPath: string,
    diffPath: string,
  ): Promise<void> => {
    const baselineBranch = state.baselineBranch;
    if (baselineBranch === undefined) return;
    const request = ++diffRequest;
    const key = diffCacheKey(baselineBranch, state.history, target, diffPath);
    const cached = diffCache.get(key);
    if (cached !== undefined) {
      update({ ...state, selectedPath, diff: { status: 'ready', value: cached } });
      return;
    }
    update({ ...state, selectedPath, diff: { status: 'loading' } });
    try {
      const value = await requestDiff(baselineBranch, state.history, target, diffPath);
      diffCache.set(key, value);
      trimCache(diffCache, MAX_DIFF_CACHE);
      const active = currentTarget();
      if (
        disposed ||
        request !== diffRequest ||
        state.baselineBranch !== baselineBranch ||
        active === undefined ||
        targetKey(active) !== targetKey(target) ||
        state.selectedPath !== selectedPath
      ) return;
      update({ ...state, diff: { status: 'ready', value } });
    } catch (error) {
      const active = currentTarget();
      if (
        disposed ||
        request !== diffRequest ||
        state.baselineBranch !== baselineBranch ||
        active === undefined ||
        targetKey(active) !== targetKey(target) ||
        state.selectedPath !== selectedPath
      ) return;
      update({ ...state, diff: { status: 'error', error: asError(error) } });
    }
  };

  const applyFiles = (target: GitTarget, value: WorktreeGitCommitFiles): void => {
    const selectedPath = value.files[0]?.path;
    update({
      ...state,
      files: { status: 'ready', value },
      selectedPath,
      diff: { status: 'idle' },
    });
    if (selectedPath !== undefined) void loadDiff(target, selectedPath, selectedPath);
  };

  const loadFiles = async (target: GitTarget, preserveReady = false): Promise<void> => {
    const baselineBranch = state.baselineBranch;
    if (baselineBranch === undefined) return;
    const request = ++filesRequest;
    ++diffRequest;
    const key = gitCacheKey(baselineBranch, state.history, target);
    const cached = filesCache.get(key);
    if (cached !== undefined) {
      applyFiles(target, cached);
      return;
    }
    const previousFiles = state.files.status === 'ready' ? state.files : undefined;
    if (!preserveReady || previousFiles === undefined) {
      update({ ...state, files: { status: 'loading' }, selectedPath: undefined, diff: { status: 'idle' } });
    } else {
      update({ ...state, files: { ...previousFiles, refreshing: true } });
    }
    try {
      const value = await requestFiles(baselineBranch, state.history, target);
      filesCache.set(key, value);
      trimCache(filesCache, MAX_FILE_CACHE);
      const active = currentTarget();
      if (
        disposed ||
        request !== filesRequest ||
        state.baselineBranch !== baselineBranch ||
        active === undefined ||
        targetKey(active) !== targetKey(target)
      ) return;
      applyFiles(target, value);
    } catch (error) {
      const active = currentTarget();
      if (
        disposed ||
        request !== filesRequest ||
        state.baselineBranch !== baselineBranch ||
        active === undefined ||
        targetKey(active) !== targetKey(target)
      ) return;
      if (preserveReady && previousFiles !== undefined) {
        update({ ...state, files: { status: 'ready', value: previousFiles.value, error: asError(error) } });
      } else {
        update({ ...state, files: { status: 'error', error: asError(error) }, selectedPath: undefined, diff: { status: 'idle' } });
      }
    }
  };

  const resetTarget = (next: Partial<WorktreeGitState>): void => {
    ++filesRequest;
    ++diffRequest;
    update({
      ...state,
      ...next,
      files: { status: 'idle' },
      selectedPath: undefined,
      diff: { status: 'idle' },
    });
  };

  const selectBaselineBranch = (branch: string | undefined): void => {
    if (disposed) return;
    const nextBranch = normalizeBranch(branch);
    if (state.baselineBranch === nextBranch) return;
    ++historyRequest;
    ++filesRequest;
    ++diffRequest;
    historyInFlight = undefined;
    historyLoaded = false;
    filesInFlight.clear();
    diffInFlight.clear();
    filesCache.clear();
    diffCache.clear();
    update({
      ...state,
      baselineBranch: nextBranch,
      history: { status: 'idle' },
      view: 'commits',
      selectedCommit: undefined,
      selectedCommits: [],
      files: { status: 'idle' },
      selectedPath: undefined,
      diff: { status: 'idle' },
    });
    if (nextBranch !== undefined) void loadHistory();
  };

  const selectSummary = (): void => {
    if (disposed || state.baselineBranch === undefined) return;
    const target: GitTarget = { kind: 'selection', selection: { kind: 'summary' } };
    resetTarget({ view: 'summary', selectedCommit: undefined, selectedCommits: [] });
    void loadFiles(target);
  };

  const selectView = (view: WorktreeGitView): void => {
    if (view === 'summary') {
      selectSummary();
      return;
    }
    if (disposed || state.baselineBranch === undefined) return;
    const selectedCommit = state.selectedCommit;
    const selectedCommits = state.selectedCommits;
    if (state.view === 'commits' && state.files.status === 'ready') return;
    resetTarget({ view: 'commits' });
    if (selectedCommit === undefined) return;
    const target: GitTarget = selectedCommit !== WORKTREE_GIT_WORKING_TREE && selectedCommits.length > 1
      ? { kind: 'selection', selection: { kind: 'commits', commits: selectedCommits } }
      : { kind: 'commit', commit: selectedCommit };
    void loadFiles(target);
  };

  const selectCommit = (commit: string): void => {
    if (disposed || state.baselineBranch === undefined) return;
    const history = state.history.status === 'ready' ? state.history.value : undefined;
    if (history !== undefined && !history.commits.some((candidate) => candidate.sha === commit)) return;
    const target: GitTarget = { kind: 'commit', commit };
    const selectedCommits = commit === WORKTREE_GIT_WORKING_TREE ? [] : [commit];
    if (state.view === 'commits' && state.selectedCommit === commit && state.files.status === 'ready' && state.selectedCommits.length <= 1) return;
    resetTarget({ view: 'commits', selectedCommit: commit, selectedCommits });
    void loadFiles(target);
  };

  const toggleCommit = (commit: string): void => {
    if (disposed || state.baselineBranch === undefined || commit === WORKTREE_GIT_WORKING_TREE) return;
    const history = state.history.status === 'ready' ? state.history.value : undefined;
    if (history === undefined || !history.commits.some((candidate) => candidate.sha === commit && candidate.sha !== WORKTREE_GIT_WORKING_TREE)) return;
    const selected = state.selectedCommits.includes(commit)
      ? state.selectedCommits.filter((candidate) => candidate !== commit)
      : [...state.selectedCommits, commit];
    const canonical = canonicalizeCommits(history, selected);
    if (canonical.length === 0) {
      resetTarget({ view: 'commits', selectedCommit: undefined, selectedCommits: [] });
      return;
    }
    const selectedCommit = canonical.includes(commit) ? commit : canonical[canonical.length - 1];
    const target: GitTarget = canonical.length > 1
      ? { kind: 'selection', selection: { kind: 'commits', commits: canonical } }
      : { kind: 'commit', commit: selectedCommit };
    resetTarget({ view: 'commits', selectedCommit, selectedCommits: canonical });
    void loadFiles(target);
  };

  const clearCommitSelection = (): void => {
    if (disposed || state.baselineBranch === undefined) return;
    resetTarget({ view: 'commits', selectedCommit: undefined, selectedCommits: [] });
  };

  const selectPath = (selectedPath: string): void => {
    if (disposed || state.files.status !== 'ready') return;
    const target = currentTarget();
    if (target === undefined) return;
    const changedFile = fileForPath(state.files.value, selectedPath);
    if (changedFile === undefined) return;
    ++diffRequest;
    void loadDiff(target, selectedPath, changedFile.path);
  };

  const loadBranches = (refresh = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (branchesInFlight !== undefined) return branchesInFlight;
    if (!refresh && branchesLoaded) return Promise.resolve();
    const request = ++branchesRequest;
    const previous = state.branches;
    if (refresh && previous.status === 'ready') {
      update({ ...state, branches: { status: 'ready', value: previous.value, refreshing: true } });
    } else if (refresh && previous.status === 'error' && previous.previous !== undefined) {
      update({ ...state, branches: { status: 'ready', value: previous.previous, refreshing: true } });
    } else {
      update({ ...state, branches: { status: 'loading' } });
    }
    const run = async (): Promise<void> => {
      if (input.manager?.listBranches === undefined) {
        if (!disposed && request === branchesRequest) {
          branchesLoaded = true;
          update({ ...state, branches: { status: 'ready', value: [] } });
        }
        return;
      }
      try {
        const value = await input.manager.listBranches({ workspaceId: input.workspaceId });
        if (disposed || request !== branchesRequest) return;
        branchesLoaded = true;
        update({ ...state, branches: { status: 'ready', value } });
      } catch (error) {
        if (disposed || request !== branchesRequest) return;
        branchesLoaded = false;
        const nextError = asError(error);
        if (previous.status === 'ready') {
          update({ ...state, branches: { status: 'ready', value: previous.value, error: nextError } });
        } else if (previous.status === 'error' && previous.previous !== undefined) {
          update({ ...state, branches: { status: 'ready', value: previous.previous, error: nextError } });
        } else {
          update({ ...state, branches: { status: 'error', error: nextError } });
        }
      }
    };
    const promise = run().finally(() => {
      if (branchesInFlight === promise) branchesInFlight = undefined;
    });
    branchesInFlight = promise;
    return promise;
  };

  const loadHistory = (refresh = false): Promise<void> => {
    if (disposed || state.baselineBranch === undefined) return Promise.resolve();
    if (historyInFlight !== undefined) return historyInFlight;
    if (!refresh && historyLoaded) return Promise.resolve();
    const baselineBranch = state.baselineBranch;
    const request = ++historyRequest;
    const previous = state.history;
    const refreshesWorkingTree = refresh && state.selectedCommit === WORKTREE_GIT_WORKING_TREE;
    if (refreshesWorkingTree) invalidateWorkingTreeCache();
    if (refresh && previous.status === 'ready') {
      update({ ...state, history: { status: 'ready', value: previous.value, refreshing: true } });
    } else if (refresh && previous.status === 'error' && previous.previous !== undefined) {
      update({ ...state, history: { status: 'ready', value: previous.previous, refreshing: true } });
    } else {
      update({ ...state, history: { status: 'loading' } });
    }
    const run = async (): Promise<void> => {
      if (input.manager === undefined) {
        const error = new Error('Git manager unavailable');
        if (!disposed && request === historyRequest) {
          historyLoaded = true;
          update({ ...state, history: { status: 'error', error } });
        }
        return;
      }
      try {
        const value = await input.manager.listWorktreeCommits({
          workspaceId: input.workspaceId,
          worktreeId: input.worktreeId,
          baseBranch: baselineBranch,
        });
        if (disposed || request !== historyRequest || state.baselineBranch !== baselineBranch) return;
        historyLoaded = true;
        const selectedCommits = canonicalizeCommits(value, state.selectedCommits);
        const selectedCommitStillExists = state.selectedCommit !== undefined && value.commits.some((commit) => commit.sha === state.selectedCommit);
        const nextSelectedCommit = selectedCommitStillExists
          ? state.selectedCommit
          : selectedCommits[0] ?? value.commits[0]?.sha;
        const nextSelectedCommits = selectedCommits.length > 0
          ? selectedCommits
          : nextSelectedCommit !== undefined && nextSelectedCommit !== WORKTREE_GIT_WORKING_TREE
            ? [nextSelectedCommit]
            : [];
        update({
          ...state,
          history: { status: 'ready', value },
          selectedCommits: nextSelectedCommits,
          selectedCommit: nextSelectedCommit,
        });
        if (state.view === 'summary') {
          void loadFiles({ kind: 'selection', selection: { kind: 'summary' } }, true);
        } else if (nextSelectedCommit === undefined) {
          resetTarget({ selectedCommit: undefined, selectedCommits: [] });
        } else if (!selectedCommitStillExists || selectedCommits.length !== state.selectedCommits.length || refreshesWorkingTree) {
          const target: GitTarget = nextSelectedCommit !== WORKTREE_GIT_WORKING_TREE && selectedCommits.length > 1
            ? { kind: 'selection', selection: { kind: 'commits', commits: selectedCommits } }
            : { kind: 'commit', commit: nextSelectedCommit };
          void loadFiles(target, refreshesWorkingTree);
        }
      } catch (error) {
        if (disposed || request !== historyRequest || state.baselineBranch !== baselineBranch) return;
        historyLoaded = true;
        const nextError = asError(error);
        if (previous.status === 'ready') {
          update({ ...state, history: { status: 'ready', value: previous.value, error: nextError } });
        } else if (previous.status === 'error' && previous.previous !== undefined) {
          update({ ...state, history: { status: 'ready', value: previous.previous, error: nextError } });
        } else {
          update({ ...state, history: { status: 'error', error: nextError } });
        }
      }
    };
    const promise = run().finally(() => {
      if (historyInFlight === promise) historyInFlight = undefined;
    });
    historyInFlight = promise;
    return promise;
  };

  const controller: WorktreeGitStateController = {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loadBranches: () => loadBranches(false),
    loadHistory: () => loadHistory(false),
    refresh: () => {
      const branchesTask = loadBranches(true);
      const historyTask = loadHistory(true);
      return Promise.all([branchesTask, historyTask]).then(() => undefined);
    },
    selectBaselineBranch,
    selectView,
    selectSummary,
    selectCommit,
    toggleCommit,
    clearCommitSelection,
    selectPath,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      ++branchesRequest;
      ++historyRequest;
      ++filesRequest;
      ++diffRequest;
      listeners.clear();
    },
  };
  return controller;
}

export type UseWorktreeGitStateInput = ControllerInput;

/** React adapter; the first Git history request starts in the mount effect. */
export function useWorktreeGitState(input: UseWorktreeGitStateInput): WorktreeGitState & Omit<WorktreeGitStateController, 'getSnapshot' | 'subscribe'> {
  const controller = useMemo(
    () => createWorktreeGitStateController(input),
    [input.manager, input.workspaceId, input.worktreeId, input.defaultBaselineBranch],
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    void controller.loadBranches();
    void controller.loadHistory();
    return controller.dispose;
  }, [controller]);
  return {
    ...snapshot,
    loadBranches: controller.loadBranches,
    loadHistory: controller.loadHistory,
    refresh: controller.refresh,
    selectBaselineBranch: controller.selectBaselineBranch,
    selectView: controller.selectView,
    selectSummary: controller.selectSummary,
    selectCommit: controller.selectCommit,
    toggleCommit: controller.toggleCommit,
    clearCommitSelection: controller.clearCommitSelection,
    selectPath: controller.selectPath,
    dispose: controller.dispose,
  };
}
