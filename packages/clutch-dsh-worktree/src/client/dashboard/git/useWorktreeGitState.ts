import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { WORKTREE_GIT_WORKING_TREE } from '../../../contract/index.js';
import type {
  BranchRecord,
  WorktreeGitCommitFiles,
  WorktreeGitFileDiff,
  WorktreeGitHistory,
  WorktreeManager,
} from '../../../contract/index.js';
import { isMainWorktreeId } from './git-facts.js';
import {
  MAX_DIFF_CACHE,
  MAX_FILE_CACHE,
  canonicalizeCommits,
  diffCacheKey,
  fileForPath,
  gitCacheKey,
  isLiveCacheKey,
  isLiveTarget,
  sameTarget,
  summarySelection,
  trimCache,
} from './git-state-cache.js';
import type { GitLoadable, GitTarget } from './git-state-cache.js';

export type { GitLoadable } from './git-state-cache.js';

export type WorktreeGitView = 'commits' | 'summary';

export interface WorktreeGitState {
  readonly branches: GitLoadable<readonly BranchRecord[]>;
  /** The currently selected local branch; undefined keeps the Git tab unselected. */
  readonly baselineBranch?: string;
  readonly history: GitLoadable<WorktreeGitHistory>;
  readonly view: WorktreeGitView;
  /** Whether the summary target includes the live working tree. */
  readonly includeWorkingTree: boolean;
  /** The focused/primary commit; aggregate selections are in selectedCommits. */
  readonly selectedCommit?: string;
  /** Selected committed SHAs; the live working tree is intentionally excluded. */
  readonly selectedCommits: readonly string[];
  /** Whether picking a commit adds to the selection instead of replacing it. */
  readonly commitMultiSelect: boolean;
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
  readonly setIncludeWorkingTree: (include: boolean) => void;
  readonly selectCommit: (commit: string) => void;
  readonly toggleCommit: (commit: string) => void;
  readonly setCommitMultiSelect: (enabled: boolean) => void;
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
  /**
   * True when the Worktree record carries a captured acquisition commit the
   * Manager resolves as the implicit baseline. It lets the Git tab read the
   * captured baseline instead of staying blank until a branch is picked.
   */
  readonly capturedBaseline?: boolean;
}

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
    view: 'summary',
    includeWorkingTree: false,
    selectedCommits: [],
    commitMultiSelect: false,
    files: { status: 'idle' },
    diff: { status: 'idle' },
  };
}

/**
 * Create the browser-safe Git Dashboard state machine. Construction is inert;
 * the caller explicitly starts history loading on first Git-tab activation.
 */
export function createWorktreeGitStateController(input: ControllerInput): WorktreeGitStateController {
  // Main (Local) has no Worktree-relative Git projection, so it never issues a
  // Git read even when a panel mounts for it.
  const main = isMainWorktreeId(input.worktreeId);
  // A Worktree with a captured acquisition commit is readable without naming a
  // baseline branch: the Manager resolves that immutable commit as the implicit
  // boundary. Main never reads Git, and a Worktree with neither a selectable
  // branch nor a captured commit stays unselected until the user picks one.
  const capturedBaseline = input.capturedBaseline === true;
  const canRead = (baselineBranch: string | undefined): boolean =>
    !main && (capturedBaseline || baselineBranch !== undefined);
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
    for (const key of filesCache.keys()) {
      if (isLiveCacheKey(key)) filesCache.delete(key);
    }
    for (const key of diffCache.keys()) {
      if (isLiveCacheKey(key)) diffCache.delete(key);
    }
  };

  const retireLiveInFlight = (): boolean => {
    let retired = false;
    for (const key of filesInFlight.keys()) {
      if (isLiveCacheKey(key)) {
        filesInFlight.delete(key);
        retired = true;
      }
    }
    for (const key of diffInFlight.keys()) {
      if (isLiveCacheKey(key)) {
        diffInFlight.delete(key);
        retired = true;
      }
    }
    return retired;
  };

  const currentTarget = (): GitTarget | undefined => {
    if (state.view === 'summary') {
      return { kind: 'selection', selection: summarySelection(state.includeWorkingTree) };
    }
    if (state.selectedCommit === undefined) return undefined;
    if (
      state.selectedCommit !== WORKTREE_GIT_WORKING_TREE &&
      state.selectedCommits.length > 1
    ) {
      return { kind: 'selection', selection: { kind: 'commits', commits: state.selectedCommits } };
    }
    return { kind: 'commit', commit: state.selectedCommit };
  };

  /**
   * Stale-response guard. A completion only publishes while it is still the
   * newest request for the same baseline, projection, and selected path.
   */
  const isCurrentRequest = (
    request: number,
    latestRequest: number,
    baselineBranch: string | undefined,
    target: GitTarget,
    selectedPath?: string,
  ): boolean => {
    if (disposed || request !== latestRequest || state.baselineBranch !== baselineBranch) return false;
    const active = currentTarget();
    if (active === undefined || !sameTarget(active, target)) return false;
    return selectedPath === undefined || state.selectedPath === selectedPath;
  };

  const requestFiles = (baseBranch: string | undefined, history: GitLoadable<WorktreeGitHistory>, target: GitTarget): Promise<WorktreeGitCommitFiles> => {
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

  const requestDiff = (baseBranch: string | undefined, history: GitLoadable<WorktreeGitHistory>, target: GitTarget, diffPath: string): Promise<WorktreeGitFileDiff> => {
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
    if (!canRead(baselineBranch)) return;
    const request = ++diffRequest;
    const key = diffCacheKey(baselineBranch, state.history, target, diffPath);
    const cached = isLiveTarget(target) ? undefined : diffCache.get(key);
    if (cached !== undefined) {
      update({ ...state, selectedPath, diff: { status: 'ready', value: cached } });
      return;
    }
    update({ ...state, selectedPath, diff: { status: 'loading' } });
    try {
      const value = await requestDiff(baselineBranch, state.history, target, diffPath);
      if (!isLiveTarget(target)) {
        diffCache.set(key, value);
        trimCache(diffCache, MAX_DIFF_CACHE);
      }
      if (!isCurrentRequest(request, diffRequest, baselineBranch, target, selectedPath)) return;
      update({ ...state, diff: { status: 'ready', value } });
    } catch (error) {
      if (!isCurrentRequest(request, diffRequest, baselineBranch, target, selectedPath)) return;
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
    if (!canRead(baselineBranch)) return;
    const request = ++filesRequest;
    ++diffRequest;
    const key = gitCacheKey(baselineBranch, state.history, target);
    const cached = isLiveTarget(target) ? undefined : filesCache.get(key);
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
      if (!isLiveTarget(target)) {
        filesCache.set(key, value);
        trimCache(filesCache, MAX_FILE_CACHE);
      }
      if (!isCurrentRequest(request, filesRequest, baselineBranch, target)) return;
      applyFiles(target, value);
    } catch (error) {
      if (!isCurrentRequest(request, filesRequest, baselineBranch, target)) return;
      if (preserveReady && previousFiles !== undefined) {
        update({ ...state, files: { status: 'ready', value: previousFiles.value, error: asError(error) } });
      } else {
        update({ ...state, files: { status: 'error', error: asError(error) }, selectedPath: undefined, diff: { status: 'idle' } });
      }
    }
  };

  const resetTarget = (next: Partial<WorktreeGitState>): void => {
    retireLiveInFlight();
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
      view: 'summary',
      selectedCommit: undefined,
      selectedCommits: [],
      files: { status: 'idle' },
      selectedPath: undefined,
      diff: { status: 'idle' },
    });
    // Clearing an explicit selection falls back to the captured baseline, so it
    // must re-read rather than leave the previous branch projection on screen.
    if (nextBranch !== undefined || capturedBaseline) void loadHistory();
  };

  const selectSummary = (): void => {
    if (disposed || !canRead(state.baselineBranch)) return;
    const target: GitTarget = { kind: 'selection', selection: summarySelection(state.includeWorkingTree) };
    resetTarget({ view: 'summary', selectedCommit: undefined, selectedCommits: [] });
    void loadFiles(target);
  };

  const setIncludeWorkingTree = (includeWorkingTree: boolean): void => {
    if (disposed || state.includeWorkingTree === includeWorkingTree) return;
    if (state.view !== 'summary' || !canRead(state.baselineBranch)) {
      update({ ...state, includeWorkingTree });
      return;
    }
    const target: GitTarget = { kind: 'selection', selection: summarySelection(includeWorkingTree) };
    resetTarget({ includeWorkingTree });
    void loadFiles(target);
  };

  const selectView = (view: WorktreeGitView): void => {
    if (view === 'summary') {
      selectSummary();
      return;
    }
    if (disposed || !canRead(state.baselineBranch)) return;
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
    if (disposed || !canRead(state.baselineBranch)) return;
    const history = state.history.status === 'ready' ? state.history.value : undefined;
    if (history !== undefined && !history.commits.some((candidate) => candidate.sha === commit)) return;
    const target: GitTarget = { kind: 'commit', commit };
    const selectedCommits = commit === WORKTREE_GIT_WORKING_TREE ? [] : [commit];
    if (state.view === 'commits' && state.selectedCommit === commit && state.files.status === 'ready' && state.selectedCommits.length <= 1) return;
    resetTarget({ view: 'commits', selectedCommit: commit, selectedCommits });
    void loadFiles(target);
  };

  const toggleCommit = (commit: string): void => {
    if (disposed || !canRead(state.baselineBranch) || commit === WORKTREE_GIT_WORKING_TREE) return;
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

  /**
   * Switch between replace-on-click and additive selection. Turning multi-select
   * off collapses an aggregate target back to its primary commit so the files and
   * diff panes keep matching the visible selection.
   */
  const setCommitMultiSelect = (enabled: boolean): void => {
    if (disposed || state.commitMultiSelect === enabled) return;
    if (enabled) {
      update({ ...state, commitMultiSelect: true });
      return;
    }
    const primary = state.selectedCommit;
    const aggregated =
      state.view === 'commits' && primary !== undefined && state.selectedCommits.length > 1;
    if (!aggregated) {
      update({
        ...state,
        commitMultiSelect: false,
        selectedCommits: primary === undefined ? [] : [primary],
      });
      return;
    }
    // selectCommit must still observe the aggregate selection; collapsing it first
    // would trip the "already showing this commit" guard and keep the union files.
    update({ ...state, commitMultiSelect: false });
    selectCommit(primary);
  };

  const clearCommitSelection = (): void => {
    if (disposed || !canRead(state.baselineBranch)) return;
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
    if (disposed || main) return Promise.resolve();
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
    if (disposed || !canRead(state.baselineBranch)) return Promise.resolve();
    if (historyInFlight !== undefined) return historyInFlight;
    if (!refresh && historyLoaded) return Promise.resolve();
    const baselineBranch = state.baselineBranch;
    const request = ++historyRequest;
    const previous = state.history;
    const refreshesWorkingTree = refresh && state.selectedCommit === WORKTREE_GIT_WORKING_TREE;
    if (refresh) {
      const retiredLiveReads = retireLiveInFlight();
      if (retiredLiveReads) {
        ++filesRequest;
        ++diffRequest;
        if (state.files.status === 'loading') {
          update({ ...state, files: { status: 'idle' }, selectedPath: undefined, diff: { status: 'idle' } });
        } else if (state.diff.status === 'loading') {
          update({ ...state, diff: { status: 'idle' } });
        }
      }
    }
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
        const selectedCommits = state.view === 'summary'
          ? []
          : canonicalizeCommits(value, state.selectedCommits);
        const selectedCommitStillExists = state.view !== 'summary' &&
          state.selectedCommit !== undefined &&
          value.commits.some((commit) => commit.sha === state.selectedCommit);
        const nextSelectedCommit = state.view === 'summary'
          ? undefined
          : selectedCommitStillExists
            ? state.selectedCommit
            : selectedCommits[0] ?? value.commits[0]?.sha;
        const nextSelectedCommits = state.view === 'summary'
          ? []
          : selectedCommits.length > 0
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
          void loadFiles(
            { kind: 'selection', selection: summarySelection(state.includeWorkingTree) },
            true,
          );
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
    setIncludeWorkingTree,
    selectCommit,
    toggleCommit,
    setCommitMultiSelect,
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
    [
      input.manager,
      input.workspaceId,
      input.worktreeId,
      input.defaultBaselineBranch,
      input.capturedBaseline,
    ],
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
    setIncludeWorkingTree: controller.setIncludeWorkingTree,
    selectCommit: controller.selectCommit,
    toggleCommit: controller.toggleCommit,
    setCommitMultiSelect: controller.setCommitMultiSelect,
    clearCommitSelection: controller.clearCommitSelection,
    selectPath: controller.selectPath,
    dispose: controller.dispose,
  };
}
