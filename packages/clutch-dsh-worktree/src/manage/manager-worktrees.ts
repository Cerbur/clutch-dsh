import path from 'node:path';
import { gitWorktreeRoot, isWorktreeGitCommit } from '../contract/index.js';
import { projectWorktreePath, workspacePathInWorktree, worktreeWorkspaceAvailable } from '../provider/worktree-path.js';
import { assertGeneratedNameAvailable, GeneratedWorktreeNameCollision } from '../provider/generated-name.js';
import { readWorktreeStatus } from '../provider/git/worktree-status.js';
import { isSafeBranchName } from '../provider/git/branch-name.js';
import { readBranchFacts, assertLocalWorktreeBranch, localBranchExists } from '../provider/git/branches.js';
import type { GitWorktreeInfo } from '../provider/types.js';

import type {
  BranchRecord,
  WorktreeActivity,
  WorktreeId,
  WorktreeImportCandidate,
  WorktreeRecord,
  WorkspaceGitState,
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
  requireWorkspace,
  requireWorkspaceForRead,
  requireWorkspaceRoot,
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
  const { health: _health, mutationToken: _mutationToken, activity: _activity, currentBranch: _currentBranch, ...durableRecord } = record;
  void _health;
  void _mutationToken;
  void _activity;
  void _currentBranch;
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
  const workspace = await requireWorkspaceForRead(context, input.workspaceId);
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

  let gitWorktrees: readonly GitWorktreeInfo[] | undefined;
  let gitRoot: string | undefined;
  try {
    gitRoot = context.git.resolveRepositoryRoot
      ? await context.git.resolveRepositoryRoot(workspace.rootPath)
      : workspace.rootPath;
    gitWorktrees = await context.git.listWorktrees(gitRoot);
  } catch {
    gitWorktrees = undefined;
  }

  const nextRecords: WorktreeRecord[] = [];
  for (const storedRecord of records) {
    let record = storedRecord;
    let workspaceAvailable = true;
    if (gitRoot !== undefined) {
      try {
        record = await projectWorktreePath(storedRecord, workspace.rootPath, gitRoot);
        workspaceAvailable = await worktreeWorkspaceAvailable(record);
      } catch {
        workspaceAvailable = false;
      }
    }
    const activity = await getActivity(record);
    const recordRecoveryNeeded =
      (snapshot.pendingOperation !== undefined &&
        (snapshot.pendingOperation.worktreeId === undefined ||
          snapshot.pendingOperation.worktreeId === record.worktreeId)) ||
      snapshot.recoveryIssues?.some(
        (issue) => issue.worktreeId === undefined || issue.worktreeId === record.worktreeId,
      ) === true;

    if (record.diskCleanup === 'completed') {
      nextRecords.push(projectRuntimeRecord(snapshot, record, recordRecoveryNeeded ? 'recovery-needed' : 'cleaned', activity));
      continue;
    }

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
    let currentBranch: string | null | undefined;
    for (const gitWorktree of gitWorktrees) {
      if (
        path.resolve(gitWorktree.absolutePath) === path.resolve(gitWorktreeRoot(record)) ||
        (await samePhysicalPath(gitWorktree.absolutePath, gitWorktreeRoot(record)))
      ) {
        const status = await readWorktreeStatus(gitWorktree);
        ready = workspaceAvailable && (status === 'ready' || status === 'detached');
        currentBranch = gitWorktree.detached ? null : gitWorktree.branch;
        break;
      }
    }
    nextRecords.push({
      ...projectRuntimeRecord(
        snapshot,
        record,
        recordRecoveryNeeded ? 'recovery-needed' : ready ? currentBranch === undefined || currentBranch === record.branch ? 'ready' : 'branch-drift' : 'repair',
        activity,
      ),
      ...(currentBranch === undefined ? {} : { currentBranch }),
    });
  }
  const storedById = new Map(records.map((record) => [record.worktreeId, record]));
  return nextRecords.map((record) => ({
    ...record,
    mutationToken: createWorktreeMutationToken(snapshot, storedById.get(record.worktreeId)!),
  }));
}

/** List branch-attached Git Worktrees that have no sidecar record at the same physical path. */
export async function listImportCandidates(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly WorktreeImportCandidate[]> {
  const workspace = await requireWorkspaceForRead(context, input.workspaceId);
  await requireWorkspaceRoot(workspace);
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
    if (await readWorktreeStatus(worktree) !== 'ready') continue;
    let managed = false;
    for (const record of snapshot.worktrees) {
      if (await samePhysicalPath(worktree.absolutePath, gitWorktreeRoot(record))) {
        managed = true;
        break;
      }
    }
    if (!managed) {
      const workspacePath = await workspacePathInWorktree(workspace.rootPath, gitRoot, worktree.absolutePath);
      if (!(await worktreeWorkspaceAvailable({ absolutePath: workspacePath, gitRootPath: worktree.absolutePath }))) continue;
      candidates.push({ absolutePath: await canonicalPath(worktree.absolutePath), branch: worktree.branch });
    }
  }
  return candidates;
}

/** Inspect Git readiness and the root checkout without enumerating branch refs. */
export async function getWorkspaceGitState(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<WorkspaceGitState> {
  const workspace = await requireWorkspaceForRead(context, input.workspaceId);
  await requireWorkspaceRoot(workspace);
  await context.git.validateRepository(workspace.rootPath);
  const root = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath) : workspace.rootPath;
  for (const worktree of await context.git.listWorktrees(root)) {
    if (await samePhysicalPath(worktree.absolutePath, root)) {
      return { currentBranch: worktree.detached ? null : worktree.branch ?? null };
    }
  }
  throw providerError('GIT_OPERATION_FAILED', 'Workspace checkout is absent from Git worktree metadata', { workspaceId: input.workspaceId });
}

/** Project local branches against all Git worktrees and mark checkout/current state. */
export async function listBranches(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly BranchRecord[]> {
  const workspace = await requireWorkspaceForRead(context, input.workspaceId);
  await requireWorkspaceRoot(workspace);
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
        ...(branch.kind === undefined ? {} : { kind: branch.kind }),
        ...(branch.remote === undefined ? {} : { remote: branch.remote }),
        isCurrent: branch.kind !== 'remote' && branch.worktreePath !== undefined && await samePhysicalPath(branch.worktreePath, gitRoot),
        checkedOut: branch.kind !== 'remote' && branch.worktreePath !== undefined,
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

/** Explicit fetch has no sidecar writes and returns the current branch projection. */
export async function fetchRemoteBranches(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly BranchRecord[]> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  await context.sidecar.read(input.workspaceId);
  await context.git.validateRepository(workspace.rootPath);
  const gitRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath) : workspace.rootPath;
  if (!context.git.fetchRemoteBranches) throw providerError('GIT_OPERATION_FAILED', 'Git adapter does not support fetching remote branches', { operation: 'fetch remote branches' });
  await context.git.fetchRemoteBranches(gitRoot, { signal: context.signal });
  return listBranches(context, input);
}

/** Create a Git Worktree first, then commit its external relation to the sidecar. */
export async function createWorktree(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly branch: string; readonly newBranch?: string; readonly baseCommit?: string },
): Promise<WorktreeRecord> {
  let baseId = '';
  for (let attempt = 0n; ; attempt++) {
    context.signal.throwIfAborted();
    // Reroll first, then make progress even if an injected random source repeats forever.
    if (attempt < 8n) baseId = generatedId(context.idFactory);
    const worktreeId = attempt < 8n ? baseId : `${baseId}_${attempt - 7n}`;
    try {
      return await createWorktreeAttempt(context, input, worktreeId);
    } catch (error) {
      if (!(error instanceof GeneratedWorktreeNameCollision)) throw error;
    }
  }
}

async function createWorktreeAttempt(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly branch: string; readonly newBranch?: string; readonly baseCommit?: string },
  worktreeId: string,
): Promise<WorktreeRecord> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  const transactional = context.sidecar.runExclusive !== undefined;
  if (!transactional) await context.git.validateRepository(workspace.rootPath);
  const repositoryRoot = !transactional && context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath)
    : workspace.rootPath;

  if (typeof input.branch !== 'string' || input.branch.length === 0) {
    throw providerError('GIT_OPERATION_FAILED', 'A base branch is required', {
      workspaceRoot: workspace.rootPath,
    });
  }

  const baseBranch = input.branch.trim();
  if (input.baseCommit !== undefined && (!isWorktreeGitCommit(input.baseCommit) || input.newBranch === undefined)) {
    throw providerError('GIT_OPERATION_FAILED', 'A captured commit requires a full Git hash and a new branch', {});
  }
  const detachedBase = input.baseCommit !== undefined && baseBranch === `${input.baseCommit}^{commit}`;
  if (input.newBranch !== undefined && typeof input.newBranch !== 'string') {
    throw providerError('GIT_OPERATION_FAILED', 'A new branch name must be a string', {
      workspaceRoot: workspace.rootPath,
      baseBranch,
    });
  }
  const newBranch = input.newBranch?.trim();
  if (baseBranch.length === 0) {
    throw providerError('GIT_OPERATION_FAILED', 'A base branch is required', {
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

  if ((!detachedBase && !isSafeBranchName(baseBranch)) || (newBranch !== undefined && !isSafeBranchName(newBranch))) {
    throw providerError('GIT_OPERATION_FAILED', 'A valid branch short name is required', { baseBranch, newBranch: newBranch ?? '' });
  }
  const targetBranch = newBranch ?? baseBranch;
  let baseRef = input.baseCommit ?? baseBranch;
  if (!transactional) {
    const branches = await readBranchFacts(context.git, workspace.rootPath);
    const base = branches.find((branch) => branch.name === baseBranch);
    if (!detachedBase && base === undefined) {
      throw providerError('GIT_OPERATION_FAILED', `Branch does not exist: ${baseBranch}`, {
        workspaceRoot: workspace.rootPath,
        branch: baseBranch,
      });
    }
    assertLocalWorktreeBranch(base, newBranch);
    baseRef = input.baseCommit ?? (newBranch === undefined ? baseBranch : base?.ref ?? baseBranch);
    if (newBranch !== undefined && localBranchExists(branches, newBranch)) {
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

  const targetPath = path.resolve(context.dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);

  // 创建前同时检查词法和物理目录边界，阻止配置、ID 或 symlink 将目标引回 Workspace 或带出插件根目录。
  // Check lexical and physical directory boundaries before creation so configuration, IDs, or symlinks cannot redirect the target into the Workspace or outside the plugin root.
  validateGeneratedPath(context, workspace.rootPath, targetPath, worktreeId);
  await validatePhysicalGeneratedPath(context, workspace.rootPath, targetPath);

  // The default Workspace-sharded sidecar exposes the transaction seam. Legacy
  // injected stores keep the previous path below for compatibility with older
  // Host compositions and failure-injection tests.
  if (transactional) {
    return context.transaction.create({
      workspaceId: input.workspaceId,
      workspaceRoot: workspace.rootPath,
      targetPath,
      worktreeId,
      ...(detachedBase ? {} : { baseBranch }),
      ...(input.baseCommit === undefined ? {} : { baseCommit: input.baseCommit }),
      newBranch,
      targetBranch,
    });
  }

  const absolutePath = await workspacePathInWorktree(workspace.rootPath, repositoryRoot, targetPath);
  await assertGeneratedNameAvailable(
    worktreeId,
    targetPath,
    await context.sidecar.read(input.workspaceId),
    await context.git.listWorktrees(workspace.rootPath),
  );

  // Git is the first external side effect; the sidecar mutation below is the relation commit point.
  try {
    await context.git.createWorktree(workspace.rootPath, targetPath, baseRef, newBranch);
  } catch (error) {
    throw asGitError('create worktree', workspace.rootPath, targetPath, error);
  }

  let capturedBaseCommit = input.baseCommit;
  if (context.git.resolveCommit) {
    try {
      // Read the Worktree's actual HEAD after Git has created it. The base
      // branch may have moved during the preflight/create window.
      const actualHead = await context.git.resolveCommit(targetPath, 'HEAD', { signal: context.signal });
      capturedBaseCommit ??= actualHead;
    } catch (error) {
      try {
        await context.git.removeWorktree(workspace.rootPath, targetPath);
      } catch (cleanupError) {
        throw providerError(
          'SIDECAR_SYNC_REQUIRED',
          `Created Worktree could not be verified or cleaned up: ${targetPath}`,
          {
            workspaceId: input.workspaceId,
            workspaceRoot: workspace.rootPath,
            targetPath,
            verificationError: describeError(error),
            cleanupError: describeError(cleanupError),
          },
        );
      }
      throw asGitError('resolve created Worktree HEAD', workspace.rootPath, targetPath, error);
    }
  }

  const record: WorktreeRecord = {
    worktreeId,
    workspaceId: input.workspaceId,
    absolutePath,
    ...(absolutePath === targetPath ? {} : { gitRootPath: targetPath }),
    branch: targetBranch,
    source: 'plugin',
    createdAt: new Date().toISOString(),
    ...(detachedBase ? {} : { baseBranch }),
    ...(capturedBaseCommit !== undefined ? { baseCommit: capturedBaseCommit } : {}),
    status: 'active',
  };

  try {
    return await context.sidecar.mutate(input.workspaceId, async (snapshot) => {
      // Recheck ID and branch inside the serialized mutation so concurrent writes cannot create duplicate active records.
      const idConflict = snapshot.worktrees.find((worktree) => worktree.worktreeId === worktreeId);
      if (idConflict) {
        throw providerError('SIDECAR_CORRUPT', `Generated Worktree ID is already recorded: ${worktreeId}`, {
          worktreeId,
          existingStatus: idConflict.status,
        });
      }
      const branchClaims = snapshot.worktrees.filter(
        (worktree) => worktree.status === 'active' && worktree.branch === targetBranch,
      );
      if (branchClaims.length > 0) {
        const live = await context.git.listWorktrees(workspace.rootPath);
        for (const claim of branchClaims) {
          const actual = await findGitWorktreeByPhysicalPath(live, gitWorktreeRoot(claim));
          if (!actual || (!actual.detached && (!actual.branch || actual.branch === targetBranch))) {
            throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already recorded as active: ${targetBranch}`, {
              branch: targetBranch, worktreeId: claim.worktreeId,
            });
          }
        }
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
    const record = await context.transaction.import({
      workspaceId: input.workspaceId,
      workspaceRoot: workspace.rootPath,
      absolutePath: requestedPath,
      worktreeId: generatedId(context.idFactory),
    });
    const gitRoot = context.git.resolveRepositoryRoot
      ? await context.git.resolveRepositoryRoot(workspace.rootPath)
      : workspace.rootPath;
    return projectWorktreePath(record, workspace.rootPath, gitRoot);
  }
  await context.git.validateRepository(workspace.rootPath);
  const gitRoot = context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath)
    : workspace.rootPath;
  const gitWorktrees = await context.git.listWorktrees(workspace.rootPath);
  const gitWorktree = await findGitWorktreeByPhysicalPath(gitWorktrees, requestedPath);
  if (!gitWorktree || !gitWorktree.branch || await readWorktreeStatus(gitWorktree) !== 'ready' || await samePhysicalPath(gitWorktree.absolutePath, gitRoot)) {
    throw providerError('WORKTREE_IMPORT_INVALID', `Path is not an importable Worktree: ${requestedPath}`, {
      workspaceId: input.workspaceId,
      absolutePath: requestedPath,
    });
  }

  const normalizedPath = await canonicalPath(gitWorktree.absolutePath);
  const current = await context.sidecar.read(input.workspaceId);
  const existing = await findSidecarWorktreeByPhysicalPath(current.worktrees, normalizedPath);
  if (existing) return projectWorktreePath(importConflictOrExisting(existing, input.workspaceId, normalizedPath), workspace.rootPath, gitRoot);

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
        await readWorktreeStatus(liveWorktree) !== 'ready' ||
        await samePhysicalPath(liveWorktree.absolutePath, gitRoot)
      ) {
        throw providerError('WORKTREE_IMPORT_INVALID', `Path is not an importable Worktree: ${normalizedPath}`, {
          workspaceId: input.workspaceId,
          absolutePath: normalizedPath,
        });
      }
      const livePath = await canonicalPath(liveWorktree.absolutePath);
      const absolutePath = await workspacePathInWorktree(workspace.rootPath, gitRoot, livePath);
      if (!(await worktreeWorkspaceAvailable({ absolutePath, gitRootPath: livePath }))) {
        throw providerError('WORKTREE_IMPORT_INVALID', 'Workspace directory is unavailable in this Worktree', { absolutePath });
      }
      const concurrent = await findSidecarWorktreeByPhysicalPath(snapshot.worktrees, normalizedPath);
      if (concurrent) return {
        result: await projectWorktreePath(importConflictOrExisting(concurrent, input.workspaceId, normalizedPath), workspace.rootPath, gitRoot),
        snapshot,
        changed: false,
      };
      if (snapshot.worktrees.some((candidate) => candidate.worktreeId === worktreeId)) {
        throw providerError('SIDECAR_CORRUPT', `Generated Worktree ID is already recorded: ${worktreeId}`, { worktreeId });
      }
      const record: WorktreeRecord = {
        worktreeId,
        workspaceId: input.workspaceId,
        absolutePath,
        ...(absolutePath === livePath ? {} : { gitRootPath: livePath }),
        branch: liveWorktree.branch,
        source: 'external',
        importedAt: new Date().toISOString(),
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
  for (const worktree of worktrees) {
    if (await samePhysicalPath(gitWorktreeRoot(worktree), absolutePath)) return worktree;
  }
  return undefined;
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
  unarchiveWorktree,
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
