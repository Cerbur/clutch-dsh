import {
  WORKTREE_GIT_COMMIT_PATTERN,
  WORKTREE_GIT_SUMMARY,
  WORKTREE_GIT_WORKING_TREE,
  type WorktreeGitBaseline,
  type WorktreeGitChangedFile,
  type WorktreeGitCommit,
  type WorktreeGitCommitFiles,
  type WorktreeGitCommitFilesRequest,
  type WorktreeGitDiffSelection,
  type WorktreeGitFileDiff,
  type WorktreeGitFileDiffRequest,
  type WorktreeGitHistory,
  type WorktreeRecord,
} from '../contract/index.js';
import type { GitWorktreeAdapter, GitWorktreeInfo } from '../provider/types.js';
import { providerError } from '../provider/types.js';
import type { WorktreeManagerContext } from './manager-context.js';
import { isDirectory, requireWorkspace, samePhysicalPath } from './manager-support.js';

/** Shared with Contract/Provider/Client so commit-SHA validation cannot drift. */
const COMMIT_PATTERN = WORKTREE_GIT_COMMIT_PATTERN;

/** Read-only adapter capabilities the Git Dashboard consumes. */
type GitReadMethod =
  | 'listBranches'
  | 'resolveCommit'
  | 'findMergeBase'
  | 'getCommitDivergence'
  | 'listCommits'
  | 'listCommitFiles'
  | 'readCommitFileDiff'
  | 'listDiffFiles'
  | 'readDiffFileDiff'
  | 'listWorkingTreeFiles'
  | 'listWorkingTreeChangedPaths'
  | 'readWorkingTreeFileDiff'
  | 'listWorkingTreeDiffFiles'
  | 'readWorkingTreeDiffFileDiff';

type GitRead<Name extends GitReadMethod> = NonNullable<GitWorktreeAdapter[Name]>;

/**
 * Resolve an optional adapter read once, with its adapter receiver preserved.
 * Centralizing the capability check keeps the Manage layer free of repeated
 * `=== undefined` guards and reports one stable provider error.
 */
function gitRead<Name extends GitReadMethod>(
  context: WorktreeManagerContext,
  name: Name,
  worktreeId: string,
): GitRead<Name> {
  const method = gitReadOptional(context, name);
  if (method === undefined) {
    throw providerError('GIT_OPERATION_FAILED', `Git ${name} is unavailable`, { worktreeId });
  }
  return method;
}

/** Resolve an optional adapter read, or undefined when the adapter omits it. */
function gitReadOptional<Name extends GitReadMethod>(
  context: WorktreeManagerContext,
  name: Name,
): GitRead<Name> | undefined {
  const method = context.git[name];
  if (method === undefined) return undefined;
  return method.bind(context.git) as GitRead<Name>;
}

/** Find one changed file by its new or previous path. */
function findChangedFile(
  files: readonly WorktreeGitChangedFile[],
  requestedPath: string,
): WorktreeGitChangedFile | undefined {
  return files.find((file) => file.path === requestedPath || file.oldPath === requestedPath);
}

interface ResolvedWorktree {
  readonly workspaceRoot: string;
  /** Repository root resolved once per request and reused by baseline resolution. */
  readonly repositoryRoot: string;
  readonly record: WorktreeRecord;
  readonly live: GitWorktreeInfo;
}

interface ResolvedBaseline {
  /** The public baseline/ref value retained for the existing Dashboard contract. */
  readonly baseline: WorktreeGitBaseline;
  /** The selected base branch (or captured baseline) tip used for history and counts. */
  readonly baseHeadCommit: string;
  /** The merge base used for the Worktree-side tree diff, or baseHeadCommit as fallback. */
  readonly treeBaseCommit: string;
}

function isMainWorktreeId(worktreeId: string): boolean {
  return worktreeId === 'main' || worktreeId.startsWith('main:');
}

function unavailableHistory(
  reason: 'baseline-unselected' | 'baseline-unknown' | 'main',
  divergence?: { readonly ahead: number; readonly behind: number },
): WorktreeGitHistory {
  return {
    commits: [],
    truncated: false,
    ...(divergence ?? {}),
    unavailableReason: reason,
  };
}

function workingTreeCommit(headCommit: string): WorktreeGitCommit {
  return {
    sha: WORKTREE_GIT_WORKING_TREE,
    kind: 'working-tree',
    parents: [headCommit],
    subject: '',
    authorName: '',
    authoredAt: '',
  };
}

async function findLiveWorktree(
  worktrees: readonly GitWorktreeInfo[],
  absolutePath: string,
): Promise<GitWorktreeInfo | undefined> {
  for (const worktree of worktrees) {
    if (await samePhysicalPath(worktree.absolutePath, absolutePath)) return worktree;
  }
  return undefined;
}

async function resolveWorktree(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: string; readonly worktreeId: string },
): Promise<{ readonly main: true; readonly workspaceRoot: string } | { readonly main: false; readonly value: ResolvedWorktree }> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  if (isMainWorktreeId(input.worktreeId)) {
    return { main: true, workspaceRoot: workspace.rootPath };
  }

  const snapshot = await context.sidecar.read(input.workspaceId);
  if (snapshot.pendingOperation !== undefined || (snapshot.recoveryIssues?.length ?? 0) > 0) {
    throw providerError(
      'WORKTREE_RECOVERY_REQUIRED',
      `Workspace Worktree state needs recovery: ${input.workspaceId}`,
      {
        workspaceId: input.workspaceId,
        ...(snapshot.pendingOperation ? { operationId: snapshot.pendingOperation.id } : {}),
      },
    );
  }
  const record = snapshot.worktrees.find((candidate) => candidate.worktreeId === input.worktreeId);
  if (!record) {
    throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
    });
  }
  if (record.diskCleanup === 'completed' || record.status === 'removed') {
    throw providerError('WORKTREE_REMOVED', `Worktree is no longer active: ${input.worktreeId}`, {
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
    });
  }
  if (!(await isDirectory(record.absolutePath))) {
    throw providerError('WORKTREE_NOT_FOUND', `Worktree directory is unavailable: ${record.absolutePath}`, {
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      absolutePath: record.absolutePath,
    });
  }

  const repositoryRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath, { signal: context.signal })
    : workspace.rootPath;
  const live = await findLiveWorktree(
    await context.git.listWorktrees(repositoryRoot, { signal: context.signal }),
    record.absolutePath,
  );
  if (!live) {
    throw providerError('WORKTREE_NOT_FOUND', `Git Worktree registration is unavailable: ${record.absolutePath}`, {
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
      absolutePath: record.absolutePath,
    });
  }
  return {
    main: false,
    value: {
      workspaceRoot: workspace.rootPath,
      repositoryRoot,
      record,
      live,
    },
  };
}

/** True when a branch name can be safely handed to Git as a ref argument. */
function isSafeBranchName(branch: string): boolean {
  if (branch.length === 0 || branch.startsWith('-')) return false;
  for (const character of branch) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

/**
 * Resolve one local branch tip for the Dashboard baseline. The branch must exist
 * under `refs/heads/`, so tags, remote-tracking branches, and arbitrary refs are
 * rejected even though the browser may send any string.
 */
async function resolveLocalBranchCommit(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  baseBranch: string,
): Promise<string> {
  const unavailable = (): never => {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Selected baseline branch is unavailable: ' + baseBranch, {
      worktreeId: resolved.record.worktreeId,
      baseBranch,
    });
  };
  if (!isSafeBranchName(baseBranch)) unavailable();
  const listBranches = gitRead(context, 'listBranches', resolved.record.worktreeId);
  const resolveCommit = gitRead(context, 'resolveCommit', resolved.record.worktreeId);
  const branches = await listBranches(resolved.repositoryRoot, { signal: context.signal });
  if (!branches.includes(baseBranch)) unavailable();
  const commit = await resolveCommit(resolved.record.absolutePath, baseBranch, {
    signal: context.signal,
  });
  if (!COMMIT_PATTERN.test(commit)) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned an invalid selected baseline commit', {
      worktreeId: resolved.record.worktreeId,
      baseBranch,
    });
  }
  return commit;
}

async function resolveSelectedBaseline(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  rawBranch: string,
): Promise<ResolvedBaseline | undefined> {
  const baseBranch = rawBranch.trim();
  if (baseBranch.length === 0) return undefined;
  const commit = await resolveLocalBranchCommit(context, resolved, baseBranch);

  // A selected branch can move after the Worktree was created. Match GitHub's
  // pull-request range by diffing from the two heads' merge base to Worktree
  // HEAD, while retaining the selected branch tip for ahead/behind counts.
  const headCommit = await baselineHeadCommit(context, resolved);
  const findMergeBase = gitReadOptional(context, 'findMergeBase');
  const mergeBase = headCommit !== undefined && findMergeBase !== undefined
    ? await findMergeBase(
        resolved.record.absolutePath,
        commit,
        headCommit,
        { signal: context.signal },
      )
    : undefined;
  if (mergeBase !== undefined && !COMMIT_PATTERN.test(mergeBase)) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned an invalid selected branch merge base', {
      worktreeId: resolved.record.worktreeId,
      baseBranch,
    });
  }
  return {
    baseline: {
      commit,
      ref: baseBranch,
      source: 'branch',
    },
    baseHeadCommit: commit,
    treeBaseCommit: mergeBase ?? commit,
  };
}

/** Persist a user-selected local branch as the Worktree's Dashboard baseline. */
export async function updateWorktreeBaseBranch(
  context: WorktreeManagerContext,
  input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly baseBranch: string;
    readonly expectedBaseBranch?: string;
  },
): Promise<string> {
  if (typeof input.baseBranch !== 'string') {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The baseline branch must be a string', {
      worktreeId: input.worktreeId,
    });
  }
  const baseBranch = input.baseBranch.trim();
  if (baseBranch.length === 0) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The baseline branch cannot be empty', {
      worktreeId: input.worktreeId,
    });
  }
  if (input.expectedBaseBranch !== undefined && typeof input.expectedBaseBranch !== 'string') {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The expected baseline branch must be a string', {
      worktreeId: input.worktreeId,
    });
  }
  const expectedBaseBranch = input.expectedBaseBranch?.trim() || undefined;
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The local Workspace has no editable baseline', {
      workspaceId: input.workspaceId,
    });
  }
  const currentBranch = resolved.value.live.detached === true ? undefined : resolved.value.live.branch;
  if (currentBranch === baseBranch) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The baseline branch cannot be the current Worktree branch', {
      worktreeId: input.worktreeId,
      baseBranch,
    });
  }
  // Resolve the replacement branch against the pinned repository root before the
  // sidecar mutation, so an unavailable branch fails closed without a write.
  await resolveLocalBranchCommit(context, resolved.value, baseBranch);

  return context.sidecar.mutate(input.workspaceId, (snapshot) => {
    if (snapshot.pendingOperation !== undefined || (snapshot.recoveryIssues?.length ?? 0) > 0) {
      throw providerError(
        'WORKTREE_RECOVERY_REQUIRED',
        'Workspace Worktree state needs recovery: ' + input.workspaceId,
        { workspaceId: input.workspaceId },
      );
    }
    const record = snapshot.worktrees.find((candidate) => candidate.worktreeId === input.worktreeId);
    if (!record) {
      throw providerError('WORKTREE_NOT_FOUND', 'Worktree not found: ' + input.worktreeId, {
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
      });
    }
    if (record.status === 'removed' || record.diskCleanup === 'completed') {
      throw providerError('WORKTREE_REMOVED', 'Worktree is no longer active: ' + input.worktreeId, {
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
      });
    }
    if (input.expectedBaseBranch !== undefined && (record.baseBranch ?? undefined) !== expectedBaseBranch) {
      throw providerError(
        'WORKTREE_STATE_CONFLICT',
        'Baseline branch changed; reopen the editor before saving',
        { workspaceId: input.workspaceId, worktreeId: input.worktreeId },
      );
    }
    if (record.baseBranch === baseBranch) {
      return { result: baseBranch, snapshot, changed: false };
    }
    return {
      result: baseBranch,
      snapshot: {
        ...snapshot,
        worktrees: snapshot.worktrees.map((item) =>
          item === record ? { ...item, baseBranch } : item,
        ),
      },
    };
  });
}

async function resolveBaseline(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  requestedBaseBranch?: string,
): Promise<ResolvedBaseline | undefined> {
  const { record } = resolved;
  if (requestedBaseBranch !== undefined) {
    if (typeof requestedBaseBranch !== 'string') {
      throw providerError('WORKTREE_STATE_CONFLICT', 'The selected baseline branch must be a string', {
        worktreeId: record.worktreeId,
      });
    }
    return resolveSelectedBaseline(context, resolved, requestedBaseBranch);
  }
  if (record.baseCommit !== undefined) {
    if (!COMMIT_PATTERN.test(record.baseCommit)) {
      throw providerError('SIDECAR_CORRUPT', 'Worktree has an invalid acquisition baseline', {
        worktreeId: record.worktreeId,
      });
    }
    const commit = context.git.resolveCommit
      ? await context.git.resolveCommit(record.absolutePath, record.baseCommit, { signal: context.signal })
      : record.baseCommit;
    return {
      baseline: {
        commit,
        ...(record.baseBranch !== undefined ? { ref: record.baseBranch } : {}),
        source: 'captured',
      },
      baseHeadCommit: commit,
      treeBaseCommit: commit,
    };
  }

  // External and ambiguous legacy records have no provable acquisition point.
  // Never persist a runtime-derived merge base back into the sidecar.
  if (record.source === 'external' || record.baseBranch === undefined || resolved.live.detached === true) {
    return undefined;
  }
  const currentBranch = resolved.live.branch;
  if (currentBranch === undefined || currentBranch === record.baseBranch || context.git.findMergeBase === undefined) {
    return undefined;
  }
  const commit = await context.git.findMergeBase(
    record.absolutePath,
    record.baseBranch,
    'HEAD',
    { signal: context.signal },
  );
  if (commit === undefined) return undefined;
  if (!COMMIT_PATTERN.test(commit)) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned an invalid derived baseline', {
      worktreeId: record.worktreeId,
    });
  }
  return {
    baseline: {
      commit,
      ref: record.baseBranch,
      source: 'derived',
    },
    baseHeadCommit: commit,
    treeBaseCommit: commit,
  };
}

async function requireBaseline(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  requestedBaseBranch?: string,
): Promise<ResolvedBaseline> {
  const baseline = await resolveBaseline(context, resolved, requestedBaseBranch);
  if (baseline === undefined) {
    throw providerError(
      'WORKTREE_STATE_CONFLICT',
      'Select a local baseline branch before reading Git changes',
      { worktreeId: resolved.record.worktreeId },
    );
  }
  return baseline;
}

async function baselineHeadCommit(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
): Promise<string | undefined> {
  if (resolved.live.headCommit !== undefined) return resolved.live.headCommit;
  const resolveCommit = gitReadOptional(context, 'resolveCommit');
  return resolveCommit === undefined
    ? undefined
    : await resolveCommit(resolved.record.absolutePath, 'HEAD', { signal: context.signal });
}

/** Count commits unique to each head for one resolved comparison boundary. */
async function readCommitDivergence(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  comparison: ResolvedBaseline,
  head: string | undefined,
): Promise<{ readonly ahead: number; readonly behind: number } | undefined> {
  const getCommitDivergence = gitReadOptional(context, 'getCommitDivergence');
  if (getCommitDivergence === undefined || head === undefined) return undefined;

  // Count each branch from its current tip. The tree boundary may be the
  // merge base, but ahead/behind must include commits unique to both heads.
  return getCommitDivergence(
    resolved.record.absolutePath,
    comparison.baseHeadCommit,
    head,
    { signal: context.signal },
  );
}

/**
 * Authorize commit SHAs against one pinned comparison projection.
 *
 * One bounded `listCommits` read yields exactly the authorized set: commits
 * reachable from the Worktree HEAD and not reachable from the resolved baseline
 * head. That is the same membership the previous per-SHA ancestry walks proved,
 * but a wide multi-commit selection now costs one projection read instead of
 * several Git processes per candidate SHA. The visible projection is therefore
 * the authorization boundary, matching the truncated 200-commit history the
 * browser can actually select from.
 */
async function authorizeCommits(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  comparison: ResolvedBaseline,
  candidates: readonly string[],
): Promise<readonly string[]> {
  const worktreeId = resolved.record.worktreeId;
  const requested = candidates.map((candidate) => {
    if (typeof candidate !== 'string' || !COMMIT_PATTERN.test(candidate)) {
      throw providerError('WORKTREE_STATE_CONFLICT', 'The requested commit is not a valid commit SHA', {
        worktreeId,
      });
    }
    return candidate;
  });
  const listCommits = gitRead(context, 'listCommits', worktreeId);
  const history = await listCommits(resolved.record.absolutePath, comparison.baseHeadCommit, {
    signal: context.signal,
  });
  const members = new Set(history.commits.map((commit) => commit.sha));
  for (const commit of requested) {
    if (!members.has(commit)) {
      throw providerError('WORKTREE_STATE_CONFLICT', 'The requested commit is outside this Worktree history', {
        worktreeId,
        commit,
      });
    }
  }
  return requested;
}

async function authorizeCommit(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  commitInput: string,
  requestedBaseBranch?: string,
): Promise<{ readonly commit: string; readonly baseline: WorktreeGitBaseline }> {
  const comparison = await requireBaseline(context, resolved, requestedBaseBranch);
  const [commit] = await authorizeCommits(context, resolved, comparison, [commitInput]);
  return { commit: commit!, baseline: comparison.baseline };
}

async function authorizeWorkingTree(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  requestedBaseBranch?: string,
): Promise<void> {
  // The selected branch may be unrelated to the Worktree history. The Git
  // provider can still compare two arbitrary committed trees, so only require
  // a valid resolved baseline here.
  await requireBaseline(context, resolved, requestedBaseBranch);
}

export async function listWorktreeCommits(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: string; readonly worktreeId: string; readonly baseBranch?: string },
): Promise<WorktreeGitHistory> {
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) return unavailableHistory('main');
  const baseline = await resolveBaseline(context, resolved.value, input.baseBranch);
  if (baseline === undefined) {
    const selectedBranch = input.baseBranch ?? resolved.value.record.baseBranch;
    return unavailableHistory(
      selectedBranch === undefined || selectedBranch.trim().length === 0
        ? 'baseline-unselected'
        : 'baseline-unknown',
    );
  }
  const listCommits = gitRead(context, 'listCommits', input.worktreeId);
  // The working-tree entry only needs the changed-path projection here; its file
  // list and line counts are read on demand when the entry is selected.
  const readWorkingTreePaths = gitReadOptional(context, 'listWorkingTreeChangedPaths')
    ?? gitReadOptional(context, 'listWorkingTreeFiles');
  const [history, workingTreeFiles] = await Promise.all([
    listCommits(
      resolved.value.record.absolutePath,
      baseline.baseHeadCommit,
      { signal: context.signal },
    ),
    readWorkingTreePaths === undefined
      ? Promise.resolve([] as readonly WorktreeGitChangedFile[])
      : readWorkingTreePaths(
          resolved.value.record.absolutePath,
          { signal: context.signal },
        ),
  ]);
  const divergence = await readCommitDivergence(context, resolved.value, baseline, history.headCommit);
  return {
    ...history,
    ...(divergence ?? {}),
    commits: workingTreeFiles.length > 0
      ? [workingTreeCommit(history.headCommit), ...history.commits]
      : history.commits,
    baseline: baseline.baseline,
  };
}

const MAX_AGGREGATE_COMMITS = 200;

type RequestedDiff =
  | { readonly kind: 'commit'; readonly commit: string }
  | { readonly kind: 'aggregate'; readonly selection: WorktreeGitDiffSelection };

interface AuthorizedAggregate {
  readonly selection: WorktreeGitDiffSelection;
  readonly baseline: WorktreeGitBaseline;
  readonly treeBaseCommit: string;
  readonly headCommit: string;
  readonly commits?: readonly string[];
}

function requestedDiff(input: {
  readonly commit?: string;
  readonly selection?: WorktreeGitDiffSelection;
}, worktreeId: string): RequestedDiff {
  const hasCommit = input.commit !== undefined;
  const hasSelection = input.selection !== undefined;
  if (hasCommit === hasSelection) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Provide exactly one Git diff selection', {
      worktreeId,
    });
  }
  if (hasCommit) return { kind: 'commit', commit: input.commit! };
  const selection = input.selection!;
  if (typeof selection !== 'object' || selection === null ||
    (selection.kind !== 'summary' && selection.kind !== 'commits')) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The Git diff selection is invalid', { worktreeId });
  }
  if (selection.kind === 'summary' && selection.includeWorkingTree !== undefined &&
    typeof selection.includeWorkingTree !== 'boolean') {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The summary working-tree option is invalid', { worktreeId });
  }
  return { kind: 'aggregate', selection };
}

async function authorizeAggregate(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  selection: WorktreeGitDiffSelection,
  requestedBaseBranch?: string,
): Promise<AuthorizedAggregate> {
  const comparison = await requireBaseline(context, resolved, requestedBaseBranch);
  const baseline = comparison.baseline;
  const normalizedSelection: WorktreeGitDiffSelection = selection.kind === 'summary'
    ? selection.includeWorkingTree === undefined
      ? { kind: 'summary' }
      : { kind: 'summary', includeWorkingTree: selection.includeWorkingTree }
    : selection;
  const headCommit = await baselineHeadCommit(context, resolved);
  if (headCommit === undefined || !COMMIT_PATTERN.test(headCommit)) {
    throw providerError('GIT_OPERATION_FAILED', 'Git HEAD resolution is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  if (normalizedSelection.kind === 'summary') {
    return { selection: normalizedSelection, baseline, treeBaseCommit: comparison.treeBaseCommit, headCommit };
  }
  if (!Array.isArray(normalizedSelection.commits) || normalizedSelection.commits.length === 0 || normalizedSelection.commits.length > MAX_AGGREGATE_COMMITS) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Select between 1 and ' + MAX_AGGREGATE_COMMITS + ' commits', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const commits = await authorizeCommits(context, resolved, comparison, normalizedSelection.commits);
  if (new Set(commits).size !== commits.length) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'A Git diff selection cannot contain duplicate commits', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  return {
    selection: { kind: 'commits', commits },
    baseline,
    treeBaseCommit: comparison.treeBaseCommit,
    headCommit,
    commits,
  };
}

type CommitFileGroup = {
  readonly commit: string;
  readonly files: readonly WorktreeGitChangedFile[];
};

async function selectedCommitFiles(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  commits: readonly string[],
): Promise<readonly CommitFileGroup[]> {
  const listCommitFiles = gitRead(context, 'listCommitFiles', resolved.record.worktreeId);
  return Promise.all(commits.map(async (commit) => ({
    commit,
    files: await listCommitFiles(
      resolved.record.absolutePath,
      commit,
      { signal: context.signal },
    ),
  })));
}

function mergeLineCount(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined || right === undefined) return undefined;
  return left + right;
}

function mergeSelectedFiles(groups: readonly CommitFileGroup[]): readonly WorktreeGitChangedFile[] {
  const files = new Map<string, WorktreeGitChangedFile>();
  for (const group of groups) {
    for (const file of group.files) {
      const previous = files.get(file.path);
      if (previous === undefined) {
        files.set(file.path, { ...file, commits: [group.commit] });
        continue;
      }
      const countsUnknown =
        previous.additions === undefined ||
        file.additions === undefined ||
        previous.deletions === undefined ||
        file.deletions === undefined;
      const additions = countsUnknown ? undefined : mergeLineCount(previous.additions, file.additions);
      const deletions = countsUnknown ? undefined : mergeLineCount(previous.deletions, file.deletions);
      const { additions: _previousAdditions, deletions: _previousDeletions, ...metadata } = previous;
      void _previousAdditions;
      void _previousDeletions;
      files.set(file.path, {
        ...metadata,
        ...(additions === undefined ? {} : { additions }),
        ...(deletions === undefined ? {} : { deletions }),
        commits: [...new Set([...(previous.commits ?? []), group.commit])],
      });
    }
  }
  return [...files.values()];
}

type SummarySelection = Extract<WorktreeGitDiffSelection, { readonly kind: 'summary' }>;

async function authorizeLiveSummaryHead(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
): Promise<void> {
  const resolveCommit = gitReadOptional(context, 'resolveCommit');
  if (resolveCommit === undefined) return;
  const currentHead = await resolveCommit(
    resolved.record.absolutePath,
    'HEAD',
    { signal: context.signal },
  );
  if (!COMMIT_PATTERN.test(currentHead)) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned an invalid live Worktree HEAD', {
      worktreeId: resolved.record.worktreeId,
    });
  }
}

async function listSummaryFiles(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  selection: SummarySelection,
  baseCommit: string,
  headCommit: string,
): Promise<readonly WorktreeGitChangedFile[]> {
  if (selection.includeWorkingTree === true) {
    const listWorkingTreeDiffFiles = gitRead(context, 'listWorkingTreeDiffFiles', resolved.record.worktreeId);
    await authorizeLiveSummaryHead(context, resolved);
    return listWorkingTreeDiffFiles(
      resolved.record.absolutePath,
      baseCommit,
      { signal: context.signal },
    );
  }
  const listDiffFiles = gitRead(context, 'listDiffFiles', resolved.record.worktreeId);
  return listDiffFiles(
    resolved.record.absolutePath,
    baseCommit,
    headCommit,
    { signal: context.signal },
  );
}

async function readSummaryFileDiff(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  selection: SummarySelection,
  baseCommit: string,
  headCommit: string,
  filePath: string,
): Promise<WorktreeGitFileDiff> {
  if (selection.includeWorkingTree === true) {
    const readWorkingTreeDiffFileDiff = gitRead(context, 'readWorkingTreeDiffFileDiff', resolved.record.worktreeId);
    await authorizeLiveSummaryHead(context, resolved);
    return readWorkingTreeDiffFileDiff(
      resolved.record.absolutePath,
      baseCommit,
      filePath,
      { signal: context.signal },
    );
  }
  const readDiffFileDiff = gitRead(context, 'readDiffFileDiff', resolved.record.worktreeId);
  return readDiffFileDiff(
    resolved.record.absolutePath,
    baseCommit,
    headCommit,
    filePath,
    { signal: context.signal },
  );
}

async function listAggregateFiles(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  selection: WorktreeGitDiffSelection,
  requestedBaseBranch?: string,
): Promise<WorktreeGitCommitFiles> {
  const authorized = await authorizeAggregate(context, resolved, selection, requestedBaseBranch);
  if (authorized.selection.kind === 'summary') {
    const files = await listSummaryFiles(
      context,
      resolved,
      authorized.selection,
      authorized.treeBaseCommit,
      authorized.headCommit,
    );
    return {
      commit: WORKTREE_GIT_SUMMARY,
      selection: authorized.selection,
      files,
    };
  }
  const groups = await selectedCommitFiles(context, resolved, authorized.commits!);
  return {
    commit: authorized.commits![0]!,
    selection: authorized.selection,
    files: mergeSelectedFiles(groups),
  };
}

async function aggregateFileDiff(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  selection: WorktreeGitDiffSelection,
  requestedPath: string,
  requestedBaseBranch?: string,
): Promise<WorktreeGitFileDiff> {
  if (requestedPath.length === 0) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'A changed file path is required', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const authorized = await authorizeAggregate(context, resolved, selection, requestedBaseBranch);
  if (authorized.selection.kind === 'summary') {
    const files = await listSummaryFiles(
      context,
      resolved,
      authorized.selection,
      authorized.treeBaseCommit,
      authorized.headCommit,
    );
    const changedFile = findChangedFile(files, requestedPath);
    if (changedFile === undefined) {
      throw providerError('WORKTREE_STATE_CONFLICT', 'The requested path is not changed in the summary', {
        worktreeId: resolved.record.worktreeId,
        path: requestedPath,
      });
    }
    const diff = await readSummaryFileDiff(
      context,
      resolved,
      authorized.selection,
      authorized.treeBaseCommit,
      authorized.headCommit,
      changedFile.path,
    );
    return {
      ...diff,
      commit: WORKTREE_GIT_SUMMARY,
      path: requestedPath,
      selection: authorized.selection,
    };
  }

  const groups = await selectedCommitFiles(context, resolved, authorized.commits!);
  const readCommitFileDiff = gitRead(context, 'readCommitFileDiff', resolved.record.worktreeId);
  const segments: Array<{ readonly commit: string; readonly patch: string; readonly binary: boolean; readonly truncated?: boolean }> = [];
  for (const group of groups) {
    const changedFile = findChangedFile(group.files, requestedPath);
    if (changedFile === undefined) continue;
    const diff = await readCommitFileDiff(
      resolved.record.absolutePath,
      group.commit,
      changedFile.path,
      { signal: context.signal },
    );
    segments.push({
      commit: group.commit,
      patch: diff.patch,
      binary: diff.binary,
      ...(diff.truncated === true ? { truncated: true } : {}),
    });
  }
  if (segments.length === 0) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested path is not changed by the selected commits', {
      worktreeId: resolved.record.worktreeId,
      path: requestedPath,
    });
  }
  return {
    commit: authorized.commits![0]!,
    path: requestedPath,
    patch: '',
    binary: segments.every((segment) => segment.binary),
    ...(segments.some((segment) => segment.truncated === true) ? { truncated: true } : {}),
    selection: authorized.selection,
    segments,
  };
}

export async function listWorktreeCommitFiles(
  context: WorktreeManagerContext,
  input: WorktreeGitCommitFilesRequest,
): Promise<WorktreeGitCommitFiles> {
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Git history is unavailable for the Main projection', {
      workspaceId: input.workspaceId,
    });
  }
  const requested = requestedDiff(input, input.worktreeId);
  if (requested.kind === 'aggregate') {
    return listAggregateFiles(context, resolved.value, requested.selection, input.baseBranch);
  }
  const commit = requested.commit;
  if (commit === WORKTREE_GIT_WORKING_TREE) {
    await authorizeWorkingTree(context, resolved.value, input.baseBranch);
    const listWorkingTreeFiles = gitRead(context, 'listWorkingTreeFiles', input.worktreeId);
    return {
      commit: WORKTREE_GIT_WORKING_TREE,
      files: await listWorkingTreeFiles(
        resolved.value.record.absolutePath,
        { signal: context.signal },
      ),
    };
  }
  const authorized = await authorizeCommit(context, resolved.value, commit, input.baseBranch);
  const listCommitFiles = gitRead(context, 'listCommitFiles', input.worktreeId);
  return {
    commit: authorized.commit,
    files: await listCommitFiles(
      resolved.value.record.absolutePath,
      authorized.commit,
      { signal: context.signal },
    ),
  };
}

export async function getWorktreeCommitFileDiff(
  context: WorktreeManagerContext,
  input: WorktreeGitFileDiffRequest,
): Promise<WorktreeGitFileDiff> {
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Git history is unavailable for the Main projection', {
      workspaceId: input.workspaceId,
    });
  }
  const requested = requestedDiff(input, input.worktreeId);
  if (requested.kind === 'aggregate') {
    return aggregateFileDiff(context, resolved.value, requested.selection, input.path, input.baseBranch);
  }
  const commit = requested.commit;
  if (typeof input.path !== 'string' || input.path.length === 0) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'A changed file path is required', {
      worktreeId: input.worktreeId,
    });
  }
  if (commit === WORKTREE_GIT_WORKING_TREE) {
    await authorizeWorkingTree(context, resolved.value, input.baseBranch);
    const readWorkingTreeFileDiff = gitRead(context, 'readWorkingTreeFileDiff', input.worktreeId);
    // Path authorization only needs the changed-path projection: reading line
    // statistics for every untracked file here would re-run one Git process per
    // untracked file on each file click.
    const readChangedPaths = gitReadOptional(context, 'listWorkingTreeChangedPaths')
      ?? gitRead(context, 'listWorkingTreeFiles', input.worktreeId);
    const files = await readChangedPaths(
      resolved.value.record.absolutePath,
      { signal: context.signal },
    );
    const changedFile = findChangedFile(files, input.path);
    if (changedFile === undefined) {
      throw providerError('WORKTREE_STATE_CONFLICT', 'The requested path is not changed in the working tree', {
        worktreeId: input.worktreeId,
        commit: WORKTREE_GIT_WORKING_TREE,
        path: input.path,
      });
    }
    const diff = await readWorkingTreeFileDiff(
      resolved.value.record.absolutePath,
      changedFile.path,
      { signal: context.signal },
    );
    return {
      ...diff,
      commit: WORKTREE_GIT_WORKING_TREE,
      path: input.path,
    };
  }
  const authorized = await authorizeCommit(context, resolved.value, commit, input.baseBranch);
  const readCommitFileDiff = gitRead(context, 'readCommitFileDiff', input.worktreeId);
  const listCommitFiles = gitRead(context, 'listCommitFiles', input.worktreeId);
  // The changed-file projection is the authorization boundary for the path, so
  // the diff is only read for an exact member of that projection.
  const files = await listCommitFiles(
    resolved.value.record.absolutePath,
    authorized.commit,
    { signal: context.signal },
  );
  const changedFile = findChangedFile(files, input.path);
  if (changedFile === undefined) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested path is not changed by this commit', {
      worktreeId: input.worktreeId,
      commit: authorized.commit,
      path: input.path,
    });
  }
  const diff = await readCommitFileDiff(
    resolved.value.record.absolutePath,
    authorized.commit,
    changedFile.path,
    { signal: context.signal },
  );
  return {
    ...diff,
    commit: authorized.commit,
    path: input.path,
  };
}
