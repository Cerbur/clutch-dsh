import {
  WORKTREE_GIT_WORKING_TREE,
  type WorktreeGitBaseline,
  type WorktreeGitCommit,
  type WorktreeGitCommitFiles,
  type WorktreeGitFileDiff,
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

async function authorizeCommit(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  commitInput: string,
  requestedBaseBranch?: string,
): Promise<{ readonly commit: string; readonly baseline: WorktreeGitBaseline }> {
  if (typeof commitInput !== 'string' || !COMMIT_PATTERN.test(commitInput)) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested commit is not a valid commit SHA', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const baseline = await requireBaseline(context, resolved, requestedBaseBranch);
  if (context.git.resolveCommit === undefined || context.git.isCommitAncestor === undefined) {
    throw providerError('GIT_OPERATION_FAILED', 'Git commit authorization is unavailable', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const commit = await context.git.resolveCommit(resolved.record.absolutePath, commitInput, {
    signal: context.signal,
  });
  const head = await context.git.resolveCommit(resolved.record.absolutePath, 'HEAD', {
    signal: context.signal,
  });
  const baselineIsAncestor = await baselineIsCurrentAncestor(context, resolved, baseline);
  const afterBaseline = commit !== baseline.commit && await isCommitAncestor(
    context,
    resolved,
    baseline.commit,
    commit,
  );
  const reachableFromHead = await isCommitAncestor(context, resolved, commit, head);
  if (!baselineIsAncestor || !afterBaseline || !reachableFromHead) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested commit is outside this Worktree history', {
      worktreeId: resolved.record.worktreeId,
      commit,
    });
  }
  return { commit, baseline };
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

export async function listWorktreeCommitFiles(
  context: WorktreeManagerContext,
  input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly commit: string;
    readonly baseBranch?: string;
  },
): Promise<WorktreeGitCommitFiles> {
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Git history is unavailable for the Main projection', {
      workspaceId: input.workspaceId,
    });
  }
  if (input.commit === WORKTREE_GIT_WORKING_TREE) {
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
  const authorized = await authorizeCommit(context, resolved.value, input.commit, input.baseBranch);
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
  input: {
    readonly workspaceId: string;
    readonly worktreeId: string;
    readonly commit: string;
    readonly path: string;
    readonly baseBranch?: string;
  },
): Promise<WorktreeGitFileDiff> {
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Git history is unavailable for the Main projection', {
      workspaceId: input.workspaceId,
    });
  }
  if (typeof input.path !== 'string' || input.path.length === 0) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'A changed file path is required', {
      worktreeId: input.worktreeId,
    });
  }
  if (input.commit === WORKTREE_GIT_WORKING_TREE) {
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
  const authorized = await authorizeCommit(context, resolved.value, input.commit, input.baseBranch);
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
