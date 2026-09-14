import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { WORKTREE_GIT_WORKING_TREE } from '../../../contract/index.js';
import type {
  BranchRecord,
  WorktreeGitChangedFile,
  WorktreeGitCommitFiles,
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

export interface WorktreeGitState {
  readonly branches: GitLoadable<readonly BranchRecord[]>;
  /** The currently selected local branch; undefined keeps the Git tab unselected. */
  readonly baselineBranch?: string;
  readonly history: GitLoadable<WorktreeGitHistory>;
  readonly selectedCommit?: string;
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
  readonly selectCommit: (commit: string) => void;
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

function gitCacheKey(baseBranch: string, commit: string): string {
  return `${baseBranch}\u0000${commit}`;
}

function diffCacheKey(baseBranch: string, commit: string, filePath: string): string {
  return `${baseBranch}\u0000${commit}\u0000${filePath}`;
}

function trimCache<Value>(cache: Map<string, Value>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
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

  const invalidateWorkingTreeCache = (): void => {
    const marker = `\u0000${WORKTREE_GIT_WORKING_TREE}`;
    for (const key of filesCache.keys()) {
      if (key === WORKTREE_GIT_WORKING_TREE || key.endsWith(marker)) filesCache.delete(key);
    }
    for (const key of diffCache.keys()) {
      if (key.includes(`${marker}\u0000`)) diffCache.delete(key);
    }
  };

  const emit = (): void => {
    if (disposed) return;
    for (const listener of listeners) listener();
  };
  const update = (next: WorktreeGitState): void => {
    if (disposed) return;
    state = next;
    emit();
  };

  const requestFiles = (baseBranch: string, commit: string): Promise<WorktreeGitCommitFiles> => {
    const key = gitCacheKey(baseBranch, commit);
    const existing = filesInFlight.get(key);
    if (existing !== undefined) return existing;
    if (input.manager === undefined) return Promise.reject(new Error('Git manager unavailable'));

    let promise: Promise<WorktreeGitCommitFiles>;
    try {
      promise = input.manager.listWorktreeCommitFiles({
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
        commit,
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

  const requestDiff = (baseBranch: string, commit: string, diffPath: string): Promise<WorktreeGitFileDiff> => {
    const key = diffCacheKey(baseBranch, commit, diffPath);
    const existing = diffInFlight.get(key);
    if (existing !== undefined) return existing;
    if (input.manager === undefined) return Promise.reject(new Error('Git manager unavailable'));

    let promise: Promise<WorktreeGitFileDiff>;
    try {
      promise = input.manager.getWorktreeCommitFileDiff({
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
        commit,
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
    commit: string,
    selectedPath: string,
    diffPath: string,
  ): Promise<void> => {
    const baselineBranch = state.baselineBranch;
    if (baselineBranch === undefined) return;
    const request = ++diffRequest;
    const key = diffCacheKey(baselineBranch, commit, diffPath);
    const cached = diffCache.get(key);
    if (cached !== undefined) {
      update({ ...state, selectedPath, diff: { status: 'ready', value: cached } });
      return;
    }
    update({ ...state, selectedPath, diff: { status: 'loading' } });
    try {
      const value = await requestDiff(baselineBranch, commit, diffPath);
      diffCache.set(key, value);
      trimCache(diffCache, MAX_DIFF_CACHE);
      if (
        disposed ||
        request !== diffRequest ||
        state.baselineBranch !== baselineBranch ||
        state.selectedCommit !== commit ||
        state.selectedPath !== selectedPath
      ) return;
      update({ ...state, diff: { status: 'ready', value } });
    } catch (error) {
      if (
        disposed ||
        request !== diffRequest ||
        state.baselineBranch !== baselineBranch ||
        state.selectedCommit !== commit ||
        state.selectedPath !== selectedPath
      ) return;
      update({ ...state, diff: { status: 'error', error: asError(error) } });
    }
  };

  const applyFiles = (commit: string, value: WorktreeGitCommitFiles): void => {
    const selectedPath = value.files[0]?.path;
    update({
      ...state,
      files: { status: 'ready', value },
      selectedPath,
      diff: { status: 'idle' },
    });
    if (selectedPath !== undefined) void loadDiff(commit, selectedPath, selectedPath);
  };

  const loadFiles = async (commit: string, preserveReady = false): Promise<void> => {
    const baselineBranch = state.baselineBranch;
    if (baselineBranch === undefined) return;
    const request = ++filesRequest;
    ++diffRequest;
    const key = gitCacheKey(baselineBranch, commit);
    const cached = filesCache.get(key);
    if (cached !== undefined) {
      applyFiles(commit, cached);
      return;
    }
    const previousFiles = state.files.status === 'ready' ? state.files : undefined;
    if (!preserveReady || previousFiles === undefined) {
      update({ ...state, files: { status: 'loading' }, selectedPath: undefined, diff: { status: 'idle' } });
    } else {
      update({ ...state, files: { ...previousFiles, refreshing: true } });
    }
    try {
      const value = await requestFiles(baselineBranch, commit);
      filesCache.set(key, value);
      trimCache(filesCache, MAX_FILE_CACHE);
      if (
        disposed ||
        request !== filesRequest ||
        state.baselineBranch !== baselineBranch ||
        state.selectedCommit !== commit
      ) return;
      applyFiles(commit, value);
    } catch (error) {
      if (
        disposed ||
        request !== filesRequest ||
        state.baselineBranch !== baselineBranch ||
        state.selectedCommit !== commit
      ) return;
      if (preserveReady && previousFiles !== undefined) {
        update({ ...state, files: { status: 'ready', value: previousFiles.value, error: asError(error) } });
      } else {
        update({ ...state, files: { status: 'error', error: asError(error) }, selectedPath: undefined, diff: { status: 'idle' } });
      }
    }
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
      selectedCommit: undefined,
      files: { status: 'idle' },
      selectedPath: undefined,
      diff: { status: 'idle' },
    });
    if (nextBranch !== undefined) void loadHistory();
  };

  const selectCommit = (commit: string): void => {
    if (disposed || state.baselineBranch === undefined) return;
    const history = state.history.status === 'ready' ? state.history.value : undefined;
    if (history !== undefined && !history.commits.some((candidate) => candidate.sha === commit)) return;
    if (state.selectedCommit === commit && state.files.status === 'ready') return;
    ++filesRequest;
    ++diffRequest;
    update({
      ...state,
      selectedCommit: commit,
      files: { status: 'idle' },
      selectedPath: undefined,
      diff: { status: 'idle' },
    });
    void loadFiles(commit);
  };

  const selectPath = (selectedPath: string): void => {
    if (disposed || state.selectedCommit === undefined || state.files.status !== 'ready') return;
    const changedFile = fileForPath(state.files.value, selectedPath);
    if (changedFile === undefined) return;
    ++diffRequest;
    void loadDiff(state.selectedCommit, selectedPath, changedFile.path);
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
        update({ ...state, history: { status: 'ready', value } });
        const selectedStillExists = state.selectedCommit !== undefined &&
          value.commits.some((commit) => commit.sha === state.selectedCommit);
        if (!selectedStillExists) {
          const nextCommit = value.commits[0]?.sha;
          if (nextCommit === undefined) {
            update({ ...state, selectedCommit: undefined, files: { status: 'idle' }, selectedPath: undefined, diff: { status: 'idle' } });
          } else {
            selectCommit(nextCommit);
          }
        } else if (refreshesWorkingTree && state.selectedCommit === WORKTREE_GIT_WORKING_TREE) {
          void loadFiles(WORKTREE_GIT_WORKING_TREE, true);
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
    selectCommit,
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
    selectCommit: controller.selectCommit,
    selectPath: controller.selectPath,
    dispose: controller.dispose,
  };
}
