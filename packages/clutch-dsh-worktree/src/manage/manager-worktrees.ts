import path from 'node:path';

import type {
  BranchRecord,
  WorktreeActivity,
  WorktreeId,
  WorktreeImportCandidate,
  WorktreeRecord,
  WorkspaceId,
} from '../contract/index.js';
import { createWorktreeMutationToken } from '../provider/mutation-token.js';
import { type SidecarSnapshot, providerError } from '../provider/types.js';
import type { WorktreeManagerContext } from './manager-context.js';
import {
  asGitError,
  asSidecarError,
  canonicalPath,
  describeError,
  generatedId,
  isDirectory,
  pathExists,
  requireWorkspace,
  samePhysicalPath,
  validateGeneratedPath,
  validatePhysicalGeneratedPath,
} from './manager-support.js';

function projectRuntimeRecord(
  snapshot: Pick<SidecarSnapshot, 'schemaVersion' | 'workspaceId' | 'revision'>,
  record: WorktreeRecord,
  health?: WorktreeRecord['health'],
  activity?: WorktreeActivity,
): WorktreeRecord {
  const { health: _health, mutationToken: _mutationToken, activity: _activity, ...durableRecord } = record;
  void _health;
  void _mutationToken;
  void _activity;
  return {
    ...durableRecord,
    mutationToken: createWorktreeMutationToken(snapshot, record),
    ...(health === undefined ? {} : { health }),
    ...(activity === undefined ? {} : { activity }),
  };
}


/** Return the sidecar Worktree projection with runtime Git health attached. */
export async function listWorktrees(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly WorktreeRecord[]> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  const snapshot = await context.sidecar.read(input.workspaceId);
  const records = snapshot.worktrees;
  const recoveryNeeded = snapshot.pendingOperation !== undefined || (snapshot.recoveryIssues?.length ?? 0) > 0;
  if (recoveryNeeded && records.length === 0) {
    throw providerError('WORKTREE_RECOVERY_REQUIRED', `Workspace Worktree state needs recovery: ${input.workspaceId}`, {
      workspaceId: input.workspaceId,
      ...(snapshot.pendingOperation ? { operationId: snapshot.pendingOperation.id } : {}),
    });
  }
  const getActivity = async (record: WorktreeRecord): Promise<WorktreeActivity> => {
    const ids = [
      ...new Set(
        snapshot.bindings
          .filter((b) => b.worktreeId === record.worktreeId)
          .map((b) => b.sessionId),
      ),
    ];
    if (ids.length === 0) return { state: 'idle' };
    if (!context.dsh.readWorktreeActivity) return { state: 'unknown' };
    try {
      return await context.dsh.readWorktreeActivity(ids);
    } catch {
      return { state: 'unknown' };
    }
  };

  let gitWorktrees: readonly { readonly absolutePath: string }[] | undefined;
  try {
    const gitRoot = context.git.resolveRepositoryRoot
      ? await context.git.resolveRepositoryRoot(workspace.rootPath)
      : workspace.rootPath;
    gitWorktrees = await context.git.listWorktrees(gitRoot);
  } catch {
    gitWorktrees = undefined;
  }

  const nextRecords: WorktreeRecord[] = [];
  for (const record of records) {
    const activity = await getActivity(record);
    if (record.diskCleanup === 'completed') {
      nextRecords.push(projectRuntimeRecord(snapshot, record, 'cleaned', activity));
      continue;
    }
    const recordRecoveryNeeded =
      (snapshot.pendingOperation !== undefined &&
        (snapshot.pendingOperation.worktreeId === undefined ||
          snapshot.pendingOperation.worktreeId === record.worktreeId)) ||
      snapshot.recoveryIssues?.some(
        (issue) => issue.worktreeId === undefined || issue.worktreeId === record.worktreeId,
      ) === true;

    if (gitWorktrees === undefined) {
      nextRecords.push(
        projectRuntimeRecord(
          snapshot,
          record,
          recordRecoveryNeeded ? 'recovery-needed' : 'repair',
          activity,
        ),
      );
      continue;
    }
    let ready = false;
    for (const gitWorktree of gitWorktrees) {
      if (
        path.resolve(gitWorktree.absolutePath) === path.resolve(record.absolutePath) ||
        (await samePhysicalPath(gitWorktree.absolutePath, record.absolutePath))
      ) {
        ready = true;
        break;
      }
    }
    nextRecords.push(
      projectRuntimeRecord(
        snapshot,
        record,
        recordRecoveryNeeded ? 'recovery-needed' : ready ? 'ready' : 'repair',
        activity,
      ),
    );
  }
  return nextRecords;
}

/** List branch-attached Git Worktrees that have no sidecar record at the same physical path. */
export async function listImportCandidates(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly WorktreeImportCandidate[]> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  await context.git.validateRepository(workspace.rootPath);
  const gitRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath)
    : workspace.rootPath;
  const [gitWorktrees, snapshot] = await Promise.all([
    context.git.listWorktrees(gitRoot),
    context.sidecar.read(input.workspaceId),
  ]);
  const candidates: WorktreeImportCandidate[] = [];
  for (const worktree of gitWorktrees) {
    if (!worktree.branch || await samePhysicalPath(worktree.absolutePath, gitRoot)) continue;
    let managed = false;
    for (const record of snapshot.worktrees) {
      if (await samePhysicalPath(worktree.absolutePath, record.absolutePath)) {
        managed = true;
        break;
      }
    }
    if (!managed) {
      candidates.push({ absolutePath: await canonicalPath(worktree.absolutePath), branch: worktree.branch });
    }
  }
  return candidates;
}

/** Project local branches against all Git worktrees and mark checkout/current state. */
export async function listBranches(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly BranchRecord[]> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  await context.git.validateRepository(workspace.rootPath);
  const gitRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath)
    : workspace.rootPath;
  if (context.git.listBranchesWithWorktreePaths) {
    const branchFacts = await context.git.listBranchesWithWorktreePaths(gitRoot);
    const rows: BranchRecord[] = [];
    for (const branch of branchFacts) {
      rows.push({
        name: branch.name,
        isCurrent: branch.worktreePath !== undefined && await samePhysicalPath(branch.worktreePath, gitRoot),
        checkedOut: branch.worktreePath !== undefined,
      });
    }
    return rows;
  }
  const [branches, worktrees] = await Promise.all([
    context.git.listBranches(gitRoot),
    context.git.listWorktrees(gitRoot),
  ]);

  // `checkedOut` covers the main Workspace and all linked worktrees; `isCurrent` identifies the Git root's worktree.
  const checkedOut = new Set(worktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])));
  let currentBranch: string | undefined;
  for (const worktree of worktrees) {
    if (await samePhysicalPath(worktree.absolutePath, gitRoot)) {
      currentBranch = worktree.branch;
      break;
    }
  }
  return branches.map((name) => ({
    name,
    isCurrent: currentBranch === name,
    checkedOut: checkedOut.has(name),
  }));
}

/** Create a Git Worktree first, then commit its external relation to the sidecar. */
export async function createWorktree(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly branch: string; readonly newBranch?: string },
): Promise<WorktreeRecord> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  const transactional = context.sidecar.runExclusive !== undefined;
  if (!transactional) await context.git.validateRepository(workspace.rootPath);

  if (typeof input.branch !== 'string' || input.branch.length === 0) {
    throw providerError('GIT_OPERATION_FAILED', 'A local branch is required', {
      workspaceRoot: workspace.rootPath,
    });
  }

  const baseBranch = input.branch.trim();
  if (input.newBranch !== undefined && typeof input.newBranch !== 'string') {
    throw providerError('GIT_OPERATION_FAILED', 'A new branch name must be a string', {
      workspaceRoot: workspace.rootPath,
      baseBranch,
    });
  }
  const newBranch = input.newBranch?.trim();
  if (baseBranch.length === 0) {
    throw providerError('GIT_OPERATION_FAILED', 'A local base branch is required', {
      workspaceRoot: workspace.rootPath,
    });
  }
  if (input.newBranch !== undefined && (!newBranch || newBranch === baseBranch)) {
    throw providerError('GIT_OPERATION_FAILED', 'A distinct new branch name is required', {
      workspaceRoot: workspace.rootPath,
      baseBranch,
      newBranch: input.newBranch,
    });
  }

  const targetBranch = newBranch ?? baseBranch;
  if (!transactional) {
    const branches = await context.git.listBranches(workspace.rootPath);
    if (!branches.includes(baseBranch)) {
      throw providerError('GIT_OPERATION_FAILED', `Local branch does not exist: ${baseBranch}`, {
        workspaceRoot: workspace.rootPath,
        branch: baseBranch,
      });
    }
    if (newBranch !== undefined && branches.includes(newBranch)) {
      throw providerError('WORKTREE_BRANCH_CONFLICT', `New branch already exists: ${newBranch}`, {
        workspaceRoot: workspace.rootPath,
        branch: newBranch,
        baseBranch,
      });
    }

    const existingGitWorktrees = await context.git.listWorktrees(workspace.rootPath);
    if (existingGitWorktrees.some((worktree) => worktree.branch === targetBranch)) {
      throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already checked out: ${targetBranch}`, {
        workspaceRoot: workspace.rootPath,
        branch: targetBranch,
        baseBranch,
      });
    }
  }

  const worktreeId = generatedId(context.idFactory);
  const targetPath = path.resolve(context.dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);

  // 创建前同时检查词法和物理目录边界，阻止配置、ID 或 symlink 将目标引回 Workspace 或带出插件根目录。
  // Check lexical and physical directory boundaries before creation so configuration, IDs, or symlinks cannot redirect the target into the Workspace or outside the plugin root.
  validateGeneratedPath(context, workspace.rootPath, targetPath, worktreeId);
  await validatePhysicalGeneratedPath(context, workspace.rootPath, targetPath);
  if (await pathExists(targetPath)) {
    throw providerError('GIT_OPERATION_FAILED', `Generated Worktree path already exists: ${targetPath}`, {
      workspaceRoot: workspace.rootPath,
      targetPath,
      worktreeId,
    });
  }

  // The default Workspace-sharded sidecar exposes the transaction seam. Legacy
  // injected stores keep the previous path below for compatibility with older
  // Host compositions and failure-injection tests.
  if (transactional) {
    return context.transaction.create({
      workspaceId: input.workspaceId,
      workspaceRoot: workspace.rootPath,
      targetPath,
      worktreeId,
      baseBranch,
      newBranch,
      targetBranch,
    });
  }

  // Git is the first external side effect; the sidecar mutation below is the relation commit point.
  try {
    await context.git.createWorktree(workspace.rootPath, targetPath, baseBranch, newBranch);
  } catch (error) {
    throw asGitError('create worktree', workspace.rootPath, targetPath, error);
  }

  const record: WorktreeRecord = {
    worktreeId,
    workspaceId: input.workspaceId,
    absolutePath: targetPath,
    branch: targetBranch,
    source: 'plugin',
    status: 'active',
  };

  try {
    return await context.sidecar.mutate(input.workspaceId, (snapshot) => {
      // Recheck ID and branch inside the serialized mutation so concurrent writes cannot create duplicate active records.
      const idConflict = snapshot.worktrees.find((worktree) => worktree.worktreeId === worktreeId);
      if (idConflict) {
        throw providerError('SIDECAR_CORRUPT', `Generated Worktree ID is already recorded: ${worktreeId}`, {
          worktreeId,
          existingStatus: idConflict.status,
        });
      }
      const branchConflict = snapshot.worktrees.find(
        (worktree) => worktree.status === 'active' && worktree.branch === targetBranch,
      );
      if (branchConflict) {
        throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already recorded as active: ${targetBranch}`, {
          branch: targetBranch,
          worktreeId: branchConflict.worktreeId,
        });
      }
      const next: SidecarSnapshot = {
        ...snapshot,
        worktrees: [record, ...snapshot.worktrees],
      };
      return { result: record, snapshot: next };
    });
  } catch (error) {
    const sidecarError = asSidecarError(error, input.workspaceId);

    // Remove the new Worktree when sidecar commit fails; expose a sync-required error if compensation fails.
    try {
      await context.git.removeWorktree(workspace.rootPath, targetPath);
    } catch (cleanupError) {
      throw providerError(
        'SIDECAR_SYNC_REQUIRED',
        `Sidecar write failed and the newly created Worktree could not be cleaned up: ${targetPath}`,
        {
          workspaceId: input.workspaceId,
          workspaceRoot: workspace.rootPath,
          targetPath,
          sidecarError: sidecarError.message,
          cleanupError: describeError(cleanupError),
        },
      );
    }
    throw sidecarError;
  }
}

/** Register a pre-existing branch-attached Git Worktree without performing a Git mutation. */
export async function importWorktree(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly absolutePath: string },
): Promise<WorktreeRecord> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  if (typeof input.absolutePath !== 'string' || !path.isAbsolute(input.absolutePath)) {
    throw providerError('WORKTREE_IMPORT_INVALID', 'An absolute Worktree path is required', {
      workspaceId: input.workspaceId,
      absolutePath: typeof input.absolutePath === 'string' ? input.absolutePath : '',
    });
  }
  const requestedPath = path.resolve(input.absolutePath);
  if (!(await isDirectory(requestedPath))) {
    throw providerError('WORKTREE_IMPORT_INVALID', `Worktree path is not a directory: ${requestedPath}`, {
      workspaceId: input.workspaceId,
      absolutePath: requestedPath,
    });
  }
  if (context.sidecar.runExclusive) {
    return context.transaction.import({
      workspaceId: input.workspaceId,
      workspaceRoot: workspace.rootPath,
      absolutePath: requestedPath,
      worktreeId: generatedId(context.idFactory),
    });
  }
  await context.git.validateRepository(workspace.rootPath);
  const gitWorktrees = await context.git.listWorktrees(workspace.rootPath);
  const gitWorktree = await findGitWorktreeByPhysicalPath(gitWorktrees, requestedPath);
  if (!gitWorktree || !gitWorktree.branch || await samePhysicalPath(gitWorktree.absolutePath, workspace.rootPath)) {
    throw providerError('WORKTREE_IMPORT_INVALID', `Path is not an importable Worktree: ${requestedPath}`, {
      workspaceId: input.workspaceId,
      absolutePath: requestedPath,
    });
  }

  const normalizedPath = await canonicalPath(gitWorktree.absolutePath);
  const current = await context.sidecar.read(input.workspaceId);
  const existing = await findSidecarWorktreeByPhysicalPath(current.worktrees, normalizedPath);
  if (existing) return importConflictOrExisting(existing, input.workspaceId, normalizedPath);

  const worktreeId = generatedId(context.idFactory);
  try {
    return await context.sidecar.mutate(input.workspaceId, async (snapshot) => {
      await context.git.validateRepository(workspace.rootPath);
      const liveWorktree = await findGitWorktreeByPhysicalPath(
        await context.git.listWorktrees(workspace.rootPath),
        normalizedPath,
      );
      if (
        !liveWorktree ||
        !liveWorktree.branch ||
        await samePhysicalPath(liveWorktree.absolutePath, workspace.rootPath)
      ) {
        throw providerError('WORKTREE_IMPORT_INVALID', `Path is not an importable Worktree: ${normalizedPath}`, {
          workspaceId: input.workspaceId,
          absolutePath: normalizedPath,
        });
      }
      const livePath = await canonicalPath(liveWorktree.absolutePath);
      const concurrent = await findSidecarWorktreeByPhysicalPath(snapshot.worktrees, normalizedPath);
      if (concurrent) return { result: importConflictOrExisting(concurrent, input.workspaceId, normalizedPath), snapshot, changed: false };
      if (snapshot.worktrees.some((candidate) => candidate.worktreeId === worktreeId)) {
        throw providerError('SIDECAR_CORRUPT', `Generated Worktree ID is already recorded: ${worktreeId}`, { worktreeId });
      }
      const record: WorktreeRecord = {
        worktreeId,
        workspaceId: input.workspaceId,
        absolutePath: livePath,
        branch: liveWorktree.branch,
        source: 'external',
        status: 'active',
      };
      return {
        result: record,
        snapshot: { ...snapshot, worktrees: [record, ...snapshot.worktrees] },
      };
    });
  } catch (error) {
    throw asSidecarError(error, input.workspaceId);
  }
}

async function findGitWorktreeByPhysicalPath<Worktree extends { readonly absolutePath: string }>(
  worktrees: readonly Worktree[],
  absolutePath: string,
): Promise<Worktree | undefined> {
  for (const worktree of worktrees) {
    if (await samePhysicalPath(worktree.absolutePath, absolutePath)) return worktree;
  }
  return undefined;
}

async function findSidecarWorktreeByPhysicalPath(
  worktrees: readonly WorktreeRecord[],
  absolutePath: string,
): Promise<WorktreeRecord | undefined> {
  return findGitWorktreeByPhysicalPath(worktrees, absolutePath);
}

function importConflictOrExisting(
  existing: WorktreeRecord,
  workspaceId: string,
  absolutePath: string,
): WorktreeRecord {
  if (existing.status === 'active' && existing.source === 'external' && existing.workspaceId === workspaceId) {
    return existing;
  }
  throw providerError('WORKTREE_ALREADY_MANAGED', `Worktree path is already managed: ${absolutePath}`, {
    workspaceId,
    absolutePath,
    worktreeId: existing.worktreeId,
    source: existing.source,
    status: existing.status,
  });
}

export {
  archiveWorktree as removeWorktree,
  cleanWorktree,
  forgetWorktree,
} from './manager-worktree-lifecycle.js';

/** Reconcile one Workspace's durable Git/sidecar operation marker. */
export async function recoverWorktrees(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<void> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  await context.transaction.recover({
    workspaceId: input.workspaceId,
    workspaceRoot: workspace.rootPath,
  });
}

export async function insertWorktreeBefore(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly worktreeId: WorktreeId; readonly beforeWorktreeId?: WorktreeId },
): Promise<readonly WorktreeId[]> {
  await requireWorkspace(context, input.workspaceId);
  try {
    return await context.sidecar.insertWorktreeBefore(
      input.workspaceId,
      input.worktreeId,
      input.beforeWorktreeId,
    );
  } catch (error) {
    throw asSidecarError(error, input.workspaceId);
  }
}
