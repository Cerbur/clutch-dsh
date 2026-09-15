import {
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
import type { GitWorktreeInfo } from '../provider/types.js';
import { providerError } from '../provider/types.js';
import type { WorktreeManagerContext } from './manager-context.js';
import { isDirectory, requireWorkspace, samePhysicalPath } from './manager-support.js';

const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

interface ResolvedWorktree {
  readonly workspaceRoot: string;
  readonly record: WorktreeRecord;
  readonly live: GitWorktreeInfo;
}

function isMainWorktreeId(worktreeId: string): boolean {
  return worktreeId === 'main' || worktreeId.startsWith('main:');
}

function unavailableHistory(reason: 'baseline-unselected' | 'baseline-unknown' | 'main'): WorktreeGitHistory {
  return {
    commits: [],
    truncated: false,
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

  const gitRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath, { signal: context.signal })
    : workspace.rootPath;
  const live = await findLiveWorktree(
    await context.git.listWorktrees(gitRoot, { signal: context.signal }),
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
      record,
      live,
    },
  };
}

async function resolveSelectedBaseline(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  rawBranch: string,
): Promise<WorktreeGitBaseline | undefined> {
  const baseBranch = rawBranch.trim();
  if (baseBranch.length === 0) return undefined;
  const repositoryRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(resolved.workspaceRoot, { signal: context.signal })
    : resolved.workspaceRoot;
  const branches = await context.git.listBranches(repositoryRoot, { signal: context.signal });
  if (!branches.includes(baseBranch)) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Selected baseline branch is unavailable: ' + baseBranch, {
      worktreeId: resolved.record.worktreeId,
      baseBranch,
    });
  }
  if (context.git.resolveCommit === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git baseline branch resolution is unavailable', {
      worktreeId: resolved.record.worktreeId,
      baseBranch,
    });
  }
  const commit = await context.git.resolveCommit(resolved.record.absolutePath, baseBranch, {
    signal: context.signal,
  });
  if (!COMMIT_PATTERN.test(commit)) {
    throw providerError('GIT_OPERATION_FAILED', 'Git returned an invalid selected baseline commit', {
      worktreeId: resolved.record.worktreeId,
      baseBranch,
    });
  }
  return { commit, ref: baseBranch, source: 'branch' };
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
  const repositoryRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(resolved.value.workspaceRoot, { signal: context.signal })
    : resolved.value.workspaceRoot;
  const branches = await context.git.listBranches(repositoryRoot, { signal: context.signal });
  if (!branches.includes(baseBranch)) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Selected baseline branch is unavailable: ' + baseBranch, {
      worktreeId: input.worktreeId,
      baseBranch,
    });
  }

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
): Promise<WorktreeGitBaseline | undefined> {
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
      commit,
      ...(record.baseBranch !== undefined ? { ref: record.baseBranch } : {}),
      source: 'captured',
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
    commit,
    ref: record.baseBranch,
    source: 'derived',
  };
}

async function requireBaseline(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  requestedBaseBranch?: string,
): Promise<WorktreeGitBaseline> {
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

async function isCommitAncestor(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  if (ancestor === descendant) return true;
  if (context.git.isCommitAncestor === undefined) return false;
  return context.git.isCommitAncestor(
    resolved.record.absolutePath,
    ancestor,
    descendant,
    { signal: context.signal },
  );
}

async function baselineIsCurrentAncestor(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  baseline: WorktreeGitBaseline,
): Promise<boolean> {
  const head = resolved.live.headCommit ?? (context.git.resolveCommit
    ? await context.git.resolveCommit(resolved.record.absolutePath, 'HEAD', { signal: context.signal })
    : undefined);
  if (head === undefined) return false;
  return isCommitAncestor(context, resolved, baseline.commit, head);
}

async function authorizeCommitAt(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  commitInput: string,
  baseline: WorktreeGitBaseline,
  head: string,
): Promise<string> {
  if (typeof commitInput !== 'string' || !COMMIT_PATTERN.test(commitInput)) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested commit is not a valid commit SHA', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  if (context.git.resolveCommit === undefined || context.git.isCommitAncestor === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git commit authorization is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const commit = await context.git.resolveCommit(resolved.record.absolutePath, commitInput, {
    signal: context.signal,
  });
  const afterBaseline = commit !== baseline.commit && await isCommitAncestor(
    context,
    resolved,
    baseline.commit,
    commit,
  );
  const reachableFromHead = await isCommitAncestor(context, resolved, commit, head);
  if (!afterBaseline || !reachableFromHead) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested commit is outside this Worktree history', {
      worktreeId: resolved.record.worktreeId,
      commit,
    });
  }
  return commit;
}

async function authorizeCommit(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  commitInput: string,
  requestedBaseBranch?: string,
): Promise<{ readonly commit: string; readonly baseline: WorktreeGitBaseline }> {
  const baseline = await requireBaseline(context, resolved, requestedBaseBranch);
  const head = resolved.live.headCommit ?? (context.git.resolveCommit
    ? await context.git.resolveCommit(resolved.record.absolutePath, 'HEAD', { signal: context.signal })
    : undefined);
  if (head === undefined || !(await isCommitAncestor(context, resolved, baseline.commit, head))) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The selected baseline is not an ancestor of the Worktree', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  return {
    commit: await authorizeCommitAt(context, resolved, commitInput, baseline, head),
    baseline,
  };
}

async function authorizeWorkingTree(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  requestedBaseBranch?: string,
): Promise<void> {
  const baseline = await requireBaseline(context, resolved, requestedBaseBranch);
  if (!(await baselineIsCurrentAncestor(context, resolved, baseline))) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The selected baseline is not an ancestor of the Worktree', {
      worktreeId: resolved.record.worktreeId,
    });
  }
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
  if (!(await baselineIsCurrentAncestor(context, resolved.value, baseline))) {
    return unavailableHistory('baseline-unknown');
  }
  if (context.git.listCommits === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git commit history is unavailable', {
      worktreeId: input.worktreeId,
    });
  }
  const [history, workingTreeFiles] = await Promise.all([
    context.git.listCommits(
      resolved.value.record.absolutePath,
      baseline.commit,
      { signal: context.signal },
    ),
    context.git.listWorkingTreeFiles?.(
      resolved.value.record.absolutePath,
      { signal: context.signal },
    ) ?? Promise.resolve([]),
  ]);
  return {
    ...history,
    commits: workingTreeFiles.length > 0
      ? [workingTreeCommit(history.headCommit), ...history.commits]
      : history.commits,
    baseline,
  };
}

const MAX_AGGREGATE_COMMITS = 200;

type RequestedDiff =
  | { readonly kind: 'commit'; readonly commit: string }
  | { readonly kind: 'aggregate'; readonly selection: WorktreeGitDiffSelection };

interface AuthorizedAggregate {
  readonly selection: WorktreeGitDiffSelection;
  readonly baseline: WorktreeGitBaseline;
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
  const baseline = await requireBaseline(context, resolved, requestedBaseBranch);
  const normalizedSelection: WorktreeGitDiffSelection = selection.kind === 'summary'
    ? selection.includeWorkingTree === undefined
      ? { kind: 'summary' }
      : { kind: 'summary', includeWorkingTree: selection.includeWorkingTree }
    : selection;
  const headCommit = resolved.live.headCommit ?? (context.git.resolveCommit
    ? await context.git.resolveCommit(resolved.record.absolutePath, 'HEAD', { signal: context.signal })
    : undefined);
  if (headCommit === undefined || !COMMIT_PATTERN.test(headCommit)) {
    throw providerError('GIT_OPERATION_FAILED', 'Git HEAD resolution is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  if (!(await isCommitAncestor(context, resolved, baseline.commit, headCommit))) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The selected baseline is not an ancestor of the Worktree', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  if (normalizedSelection.kind === 'summary') {
    return { selection: normalizedSelection, baseline, headCommit };
  }
  if (!Array.isArray(normalizedSelection.commits) || normalizedSelection.commits.length === 0 || normalizedSelection.commits.length > MAX_AGGREGATE_COMMITS) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Select between 1 and ' + MAX_AGGREGATE_COMMITS + ' commits', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const authorized = await Promise.all(normalizedSelection.commits.map((commit) =>
    authorizeCommitAt(context, resolved, commit, baseline, headCommit),
  ));
  const commits = authorized;
  if (new Set(commits).size !== commits.length) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'A Git diff selection cannot contain duplicate commits', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  return {
    selection: { kind: 'commits', commits },
    baseline,
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
  if (context.git.listCommitFiles === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git changed-file history is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  return Promise.all(commits.map(async (commit) => ({
    commit,
    files: await context.git.listCommitFiles!(
      resolved.record.absolutePath,
      commit,
      { signal: context.signal },
    ),
  })));
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
      files.set(file.path, {
        ...previous,
        commits: [...new Set([...(previous.commits ?? []), group.commit])],
      });
    }
  }
  return [...files.values()];
}

type SummarySelection = Extract<WorktreeGitDiffSelection, { readonly kind: 'summary' }>;

async function authorizeLiveSummaryBaseline(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  baseline: WorktreeGitBaseline,
): Promise<void> {
  if (context.git.resolveCommit === undefined || context.git.isCommitAncestor === undefined) return;
  const currentHead = await context.git.resolveCommit(
    resolved.record.absolutePath,
    'HEAD',
    { signal: context.signal },
  );
  if (!COMMIT_PATTERN.test(currentHead) || !(await isCommitAncestor(context, resolved, baseline.commit, currentHead))) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The selected baseline is no longer an ancestor of the live Worktree', {
      worktreeId: resolved.record.worktreeId,
    });
  }
}

async function listSummaryFiles(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  selection: SummarySelection,
  baseline: WorktreeGitBaseline,
  headCommit: string,
): Promise<readonly WorktreeGitChangedFile[]> {
  if (selection.includeWorkingTree === true) {
    if (context.git.listWorkingTreeDiffFiles === undefined) {
      throw providerError('GIT_OPERATION_FAILED', 'Git working-tree summary is unavailable', {
        worktreeId: resolved.record.worktreeId,
      });
    }
    await authorizeLiveSummaryBaseline(context, resolved, baseline);
    return context.git.listWorkingTreeDiffFiles(
      resolved.record.absolutePath,
      baseline.commit,
      { signal: context.signal },
    );
  }
  if (context.git.listDiffFiles === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git summary diff is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  return context.git.listDiffFiles(
    resolved.record.absolutePath,
    baseline.commit,
    headCommit,
    { signal: context.signal },
  );
}

async function readSummaryFileDiff(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  selection: SummarySelection,
  baseline: WorktreeGitBaseline,
  headCommit: string,
  filePath: string,
): Promise<WorktreeGitFileDiff> {
  if (selection.includeWorkingTree === true) {
    if (context.git.readWorkingTreeDiffFileDiff === undefined) {
      throw providerError('GIT_OPERATION_FAILED', 'Git working-tree file summary is unavailable', {
        worktreeId: resolved.record.worktreeId,
      });
    }
    await authorizeLiveSummaryBaseline(context, resolved, baseline);
    return context.git.readWorkingTreeDiffFileDiff(
      resolved.record.absolutePath,
      baseline.commit,
      filePath,
      { signal: context.signal },
    );
  }
  if (context.git.readDiffFileDiff === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git summary file diff is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  return context.git.readDiffFileDiff(
    resolved.record.absolutePath,
    baseline.commit,
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
      authorized.baseline,
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
      authorized.baseline,
      authorized.headCommit,
    );
    const changedFile = files.find((file) => file.path === requestedPath || file.oldPath === requestedPath);
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
      authorized.baseline,
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
  if (context.git.readCommitFileDiff === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git file diff is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const segments: Array<{ readonly commit: string; readonly patch: string; readonly binary: boolean; readonly truncated?: boolean }> = [];
  for (const group of groups) {
    const changedFile = group.files.find((file) => file.path === requestedPath || file.oldPath === requestedPath);
    if (changedFile === undefined) continue;
    const diff = await context.git.readCommitFileDiff(
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
    if (context.git.listWorkingTreeFiles === undefined) {
      throw providerError('GIT_OPERATION_FAILED', 'Git working-tree history is unavailable', {
        worktreeId: input.worktreeId,
      });
    }
    return {
      commit: WORKTREE_GIT_WORKING_TREE,
      files: await context.git.listWorkingTreeFiles(
        resolved.value.record.absolutePath,
        { signal: context.signal },
      ),
    };
  }
  const authorized = await authorizeCommit(context, resolved.value, commit, input.baseBranch);
  if (context.git.listCommitFiles === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git changed-file history is unavailable', {
      worktreeId: input.worktreeId,
    });
  }
  return {
    commit: authorized.commit,
    files: await context.git.listCommitFiles(
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
    if (context.git.listWorkingTreeFiles === undefined || context.git.readWorkingTreeFileDiff === undefined) {
      throw providerError('GIT_OPERATION_FAILED', 'Git working-tree file diff is unavailable', {
        worktreeId: input.worktreeId,
      });
    }
    const files = await context.git.listWorkingTreeFiles(
      resolved.value.record.absolutePath,
      { signal: context.signal },
    );
    const changedFile = files.find((file) => file.path === input.path || file.oldPath === input.path);
    if (changedFile === undefined) {
      throw providerError('WORKTREE_STATE_CONFLICT', 'The requested path is not changed in the working tree', {
        worktreeId: input.worktreeId,
        commit: WORKTREE_GIT_WORKING_TREE,
        path: input.path,
      });
    }
    const diff = await context.git.readWorkingTreeFileDiff(
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
  if (context.git.listCommitFiles === undefined || context.git.readCommitFileDiff === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git file diff is unavailable', {
      worktreeId: input.worktreeId,
    });
  }
  const files = await context.git.listCommitFiles(
    resolved.value.record.absolutePath,
    authorized.commit,
    { signal: context.signal },
  );
  const changedFile = files.find((file) => file.path === input.path || file.oldPath === input.path);
  if (changedFile === undefined) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested path is not changed by this commit', {
      worktreeId: input.worktreeId,
      commit: authorized.commit,
      path: input.path,
    });
  }
  const diff = await context.git.readCommitFileDiff(
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
