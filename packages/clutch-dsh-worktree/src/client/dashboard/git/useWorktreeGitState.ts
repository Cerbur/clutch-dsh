import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { WORKTREE_GIT_WORKING_TREE } from '../../../contract/index.js';
import type {
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
  readonly history: GitLoadable<WorktreeGitHistory>;
  readonly selectedCommit?: string;
  readonly files: GitLoadable<WorktreeGitCommitFiles>;
  readonly selectedPath?: string;
  readonly diff: GitLoadable<WorktreeGitFileDiff>;
}

export interface WorktreeGitStateController {
  readonly getSnapshot: () => WorktreeGitState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly loadHistory: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly selectCommit: (commit: string) => void;
  readonly selectPath: (path: string) => void;
  readonly dispose: () => void;
}

interface ControllerInput {
  readonly manager?: Pick<
    WorktreeManager,
    'listWorktreeCommits' | 'listWorktreeCommitFiles' | 'getWorktreeCommitFileDiff'
  >;
  readonly workspaceId: string;
  readonly worktreeId: string;
}

const MAX_FILE_CACHE = 8;
const MAX_DIFF_CACHE = 24;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function emptyState(): WorktreeGitState {
  return {
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

function diffCacheKey(commit: string, filePath: string): string {
  return `${commit}\u0000${filePath}`;
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
  let state = emptyState();
  let disposed = false;
  let historyLoaded = false;
  let historyRequest = 0;
  let filesRequest = 0;
  let diffRequest = 0;
  let historyInFlight: Promise<void> | undefined;
  const filesInFlight = new Map<string, Promise<WorktreeGitCommitFiles>>();
  const diffInFlight = new Map<string, Promise<WorktreeGitFileDiff>>();
  const listeners = new Set<() => void>();
  const filesCache = new Map<string, WorktreeGitCommitFiles>();
  const diffCache = new Map<string, WorktreeGitFileDiff>();

  const invalidateWorkingTreeCache = (): void => {
    filesCache.delete(WORKTREE_GIT_WORKING_TREE);
    const prefix = `${WORKTREE_GIT_WORKING_TREE}\u0000`;
    for (const key of diffCache.keys()) {
      if (key.startsWith(prefix)) diffCache.delete(key);
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

  const requestFiles = (commit: string): Promise<WorktreeGitCommitFiles> => {
    const existing = filesInFlight.get(commit);
    if (existing !== undefined) return existing;
    if (input.manager === undefined) return Promise.reject(new Error('Git manager unavailable'));

    let promise: Promise<WorktreeGitCommitFiles>;
    try {
      promise = input.manager.listWorktreeCommitFiles({
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
        commit,
      });
    } catch (error) {
      promise = Promise.reject(error);
    }
    filesInFlight.set(commit, promise);
    void promise.then(
      () => {
        if (filesInFlight.get(commit) === promise) filesInFlight.delete(commit);
      },
      () => {
        if (filesInFlight.get(commit) === promise) filesInFlight.delete(commit);
      },
    );
    return promise;
  };

  const requestDiff = (commit: string, diffPath: string): Promise<WorktreeGitFileDiff> => {
    const key = diffCacheKey(commit, diffPath);
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
    const request = ++diffRequest;
    const cached = diffCache.get(diffCacheKey(commit, diffPath));
    if (cached !== undefined) {
      update({ ...state, selectedPath, diff: { status: 'ready', value: cached } });
      return;
    }
    update({ ...state, selectedPath, diff: { status: 'loading' } });
    try {
      const value = await requestDiff(commit, diffPath);
      diffCache.set(diffCacheKey(commit, diffPath), value);
      trimCache(diffCache, MAX_DIFF_CACHE);
      if (disposed || request !== diffRequest || state.selectedCommit !== commit || state.selectedPath !== selectedPath) return;
      update({ ...state, diff: { status: 'ready', value } });
    } catch (error) {
      if (disposed || request !== diffRequest || state.selectedCommit !== commit || state.selectedPath !== selectedPath) return;
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
    const request = ++filesRequest;
    ++diffRequest;
    const cached = filesCache.get(commit);
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
      const value = await requestFiles(commit);
      filesCache.set(commit, value);
      trimCache(filesCache, MAX_FILE_CACHE);
      if (disposed || request !== filesRequest || state.selectedCommit !== commit) return;
      applyFiles(commit, value);
    } catch (error) {
      if (disposed || request !== filesRequest || state.selectedCommit !== commit) return;
      if (preserveReady && previousFiles !== undefined) {
        update({ ...state, files: { status: 'ready', value: previousFiles.value, error: asError(error) } });
      } else {
        update({ ...state, files: { status: 'error', error: asError(error) }, selectedPath: undefined, diff: { status: 'idle' } });
      }
    }
  };

  const selectCommit = (commit: string): void => {
    if (disposed) return;
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

  const loadHistory = (refresh = false): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (historyInFlight !== undefined) return historyInFlight;
    if (!refresh && historyLoaded) return Promise.resolve();
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
        });
        if (disposed || request !== historyRequest) return;
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
        if (disposed || request !== historyRequest) return;
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
    loadHistory: () => loadHistory(false),
    refresh: () => loadHistory(true),
    selectCommit,
    selectPath,
    dispose: () => {
      if (disposed) return;
      disposed = true;
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
    [input.manager, input.workspaceId, input.worktreeId],
  );
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    void controller.loadHistory();
    return controller.dispose;
  }, [controller]);
  return {
    ...snapshot,
    loadHistory: controller.loadHistory,
    refresh: controller.refresh,
    selectCommit: controller.selectCommit,
    selectPath: controller.selectPath,
    dispose: controller.dispose,
  };
}
