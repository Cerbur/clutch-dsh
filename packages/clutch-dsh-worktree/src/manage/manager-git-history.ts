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

function unavailableHistory(reason: 'baseline-unknown' | 'main'): WorktreeGitHistory {
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

async function resolveBaseline(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
): Promise<WorktreeGitBaseline | undefined> {
  const { record } = resolved;
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
): Promise<WorktreeGitBaseline> {
  const baseline = await resolveBaseline(context, resolved);
  if (baseline === undefined) {
    throw providerError(
      'WORKTREE_STATE_CONFLICT',
      'The Worktree acquisition baseline is unavailable; Git history cannot be authorized safely',
      { worktreeId: resolved.record.worktreeId },
    );
  }
  return baseline;
}

async function baselineIsCurrentAncestor(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  baseline: WorktreeGitBaseline,
): Promise<boolean> {
  if (context.git.isCommitAncestor === undefined) return false;
  const head = resolved.live.headCommit ?? (context.git.resolveCommit
    ? await context.git.resolveCommit(resolved.record.absolutePath, 'HEAD', { signal: context.signal })
    : undefined);
  if (head === undefined) return false;
  return baseline.commit === head || await context.git.isCommitAncestor(
    resolved.record.absolutePath,
    baseline.commit,
    head,
    { signal: context.signal },
  );
}

async function authorizeCommit(
  context: WorktreeManagerContext,
  resolved: ResolvedWorktree,
  commitInput: string,
): Promise<{ readonly commit: string; readonly baseline: WorktreeGitBaseline }> {
  if (typeof commitInput !== 'string' || !COMMIT_PATTERN.test(commitInput)) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The requested commit is not a valid commit SHA', {
      worktreeId: resolved.record.worktreeId,
    });
  }
  const baseline = await requireBaseline(context, resolved);
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
  const afterBaseline = commit !== baseline.commit && await context.git.isCommitAncestor(
    resolved.record.absolutePath,
    baseline.commit,
    commit,
    { signal: context.signal },
  );
  const reachableFromHead = commit === head || await context.git.isCommitAncestor(
    resolved.record.absolutePath,
    commit,
    head,
    { signal: context.signal },
  );
  if (!afterBaseline || !reachableFromHead) {
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
): Promise<void> {
  const baseline = await requireBaseline(context, resolved);
  if (!(await baselineIsCurrentAncestor(context, resolved, baseline))) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'The Worktree history changed before the working-tree projection could be read', {
      worktreeId: resolved.record.worktreeId,
    });
  }
}

export async function listWorktreeCommits(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: string; readonly worktreeId: string },
): Promise<WorktreeGitHistory> {
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) return unavailableHistory('main');
  const baseline = await resolveBaseline(context, resolved.value);
  if (baseline === undefined) return unavailableHistory('baseline-unknown');
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
  input: { readonly workspaceId: string; readonly worktreeId: string; readonly commit: string },
): Promise<WorktreeGitCommitFiles> {
  const resolved = await resolveWorktree(context, input);
  if (resolved.main) {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Git history is unavailable for the Main projection', {
      workspaceId: input.workspaceId,
    });
  }
  if (input.commit === WORKTREE_GIT_WORKING_TREE) {
    await authorizeWorkingTree(context, resolved.value);
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
  const authorized = await authorizeCommit(context, resolved.value, input.commit);
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
  input: { readonly workspaceId: string; readonly worktreeId: string; readonly commit: string; readonly path: string },
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
    await authorizeWorkingTree(context, resolved.value);
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
  const authorized = await authorizeCommit(context, resolved.value, input.commit);
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
