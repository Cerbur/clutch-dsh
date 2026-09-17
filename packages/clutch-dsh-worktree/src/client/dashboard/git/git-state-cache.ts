import {
  WORKTREE_GIT_WORKING_TREE,
  isWorktreeGitCommit,
  type WorktreeGitChangedFile,
  type WorktreeGitCommitFiles,
  type WorktreeGitDiffSelection,
  type WorktreeGitHistory,
} from '../../../contract/index.js';

/**
 * Cache keys and target predicates for the Git tab state machine. Both the key
 * builders and the "live target" predicate live here so they cannot drift: a
 * key built here is the only thing retired or invalidated by the state machine.
 */

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

/** Which projection the Git tab currently reads. */
export type GitTarget =
  | { readonly kind: 'commit'; readonly commit: string }
  | { readonly kind: 'selection'; readonly selection: WorktreeGitDiffSelection };

export const MAX_FILE_CACHE = 8;
export const MAX_DIFF_CACHE = 24;

/** The summary selection for one working-tree inclusion mode. */
export function summarySelection(
  includeWorkingTree: boolean,
): Extract<WorktreeGitDiffSelection, { readonly kind: 'summary' }> {
  return includeWorkingTree ? { kind: 'summary', includeWorkingTree: true } : { kind: 'summary' };
}

function targetKey(target: GitTarget): string {
  if (target.kind === 'commit') return 'commit\u0000' + target.commit;
  if (target.selection.kind === 'summary') {
    return target.selection.includeWorkingTree === true ? 'summary\u0000working-tree' : 'summary';
  }
  return 'commits\u0000' + target.selection.commits.join('\u0000');
}

function historyProjectionKey(history: GitLoadable<WorktreeGitHistory>): string {
  if (history.status !== 'ready') return 'unknown';
  return (history.value.baseline?.commit ?? 'unknown') + '\u0000' + (history.value.headCommit ?? 'unknown');
}

/** True when the target reads the live working tree and must not be cached. */
export function isLiveTarget(target: GitTarget): boolean {
  return target.kind === 'commit'
    ? target.commit === WORKTREE_GIT_WORKING_TREE
    : target.selection.kind === 'summary' && target.selection.includeWorkingTree === true;
}

/**
 * Live-result markers complete a cache key. Matching on the marker rather than
 * on a hand-written substring keeps key construction and invalidation aligned.
 */
const LIVE_KEY_MARKERS = [
  '\u0000' + targetKey({ kind: 'commit', commit: WORKTREE_GIT_WORKING_TREE }),
  '\u0000' + targetKey({ kind: 'selection', selection: summarySelection(true) }),
];

/** True when a file or diff cache key belongs to a live working-tree read. */
export function isLiveCacheKey(key: string): boolean {
  return LIVE_KEY_MARKERS.some((marker) => key.includes(marker));
}

/**
 * Key token for a read that names no baseline branch and therefore asks the
 * Manager to resolve the Worktree's captured acquisition commit. The leading NUL
 * cannot appear in a local branch name, so the token can never collide with one.
 */
const CAPTURED_BASELINE_KEY = '\u0000captured';

function baselineKey(baseBranch: string | undefined): string {
  return baseBranch ?? CAPTURED_BASELINE_KEY;
}

export function gitCacheKey(
  baseBranch: string | undefined,
  history: GitLoadable<WorktreeGitHistory>,
  target: GitTarget,
): string {
  return baselineKey(baseBranch) + '\u0000' + historyProjectionKey(history) + '\u0000' + targetKey(target);
}

export function diffCacheKey(
  baseBranch: string | undefined,
  history: GitLoadable<WorktreeGitHistory>,
  target: GitTarget,
  filePath: string,
): string {
  return gitCacheKey(baseBranch, history, target) + '\u0000' + filePath;
}

/** Compare two targets by projection identity rather than object identity. */
export function sameTarget(left: GitTarget, right: GitTarget): boolean {
  return targetKey(left) === targetKey(right);
}

/** Drop the oldest entries until the cache respects its bound. */
export function trimCache<Value>(cache: Map<string, Value>, maxSize: number): void {
  while (cache.size > maxSize) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

/** Find the changed-file row for a new or previous path. */
export function fileForPath(
  files: WorktreeGitCommitFiles,
  selectedPath: string,
): WorktreeGitChangedFile | undefined {
  return files.files.find((file) => file.path === selectedPath || file.oldPath === selectedPath);
}

/** Keep only SHAs that are still part of the current history projection. */
export function canonicalizeCommits(
  history: WorktreeGitHistory | undefined,
  commits: readonly string[],
): readonly string[] {
  if (history === undefined) return [];
  const requested = new Set(commits.filter((commit) => isWorktreeGitCommit(commit)));
  return history.commits
    .filter((commit) => commit.sha !== WORKTREE_GIT_WORKING_TREE && requested.has(commit.sha))
    .map((commit) => commit.sha);
}
