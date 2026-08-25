import path from 'node:path';

import type { BranchRecord, WorktreeId, WorktreeRecord, WorkspaceId } from '../contract/index.js';
import { type SidecarSnapshot, providerError } from '../provider/types.js';
import type { WorktreeManagerContext } from './manager-context.js';
import {
  asGitError,
  asSidecarError,
  describeError,
  generatedId,
  pathExists,
  requireWorkspace,
  samePhysicalPath,
  validateGeneratedPath,
  validatePhysicalGeneratedPath,
} from './manager-support.js';

/** Return the sidecar Worktree projection with runtime Git health attached. */
export async function listWorktrees(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId },
): Promise<readonly WorktreeRecord[]> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  const records = (await context.sidecar.read(input.workspaceId)).worktrees;
  let gitWorktrees: readonly { readonly absolutePath: string }[];
  try {
    gitWorktrees = await context.git.listWorktrees(workspace.rootPath);
  } catch {
    return records.map((record) => {
      const { health: _health, ...durableRecord } = record;
      void _health;
      return record.status === 'active'
        ? { ...durableRecord, health: 'repair' as const }
        : durableRecord;
    });
  }
  const nextRecords: WorktreeRecord[] = [];
  for (const record of records) {
    const { health: _health, ...durableRecord } = record;
    void _health;
    if (record.status !== 'active') {
      nextRecords.push(durableRecord);
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
    nextRecords.push({ ...durableRecord, health: ready ? 'ready' : 'repair' });
  }
  return nextRecords;
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
  await context.git.validateRepository(workspace.rootPath);

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

  const branches = await context.git.listBranches(workspace.rootPath);
  if (!branches.includes(baseBranch)) {
    throw providerError('GIT_OPERATION_FAILED', `Local branch does not exist: ${baseBranch}`, {
      workspaceRoot: workspace.rootPath,
      branch: baseBranch,
    });
  }

  const targetBranch = newBranch ?? baseBranch;
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
        worktrees: [...snapshot.worktrees, record],
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

/** Remove Git state first, then mark the relation removed while preserving detached bindings. */
export async function removeWorktree(
  context: WorktreeManagerContext,
  input: { readonly workspaceId: WorkspaceId; readonly worktreeId: string },
): Promise<void> {
  const workspace = await requireWorkspace(context, input.workspaceId);
  let gitRemoved = false;

  try {
    await context.sidecar.mutate(input.workspaceId, async (snapshot) => {
      const record = snapshot.worktrees.find((worktree) => worktree.worktreeId === input.worktreeId);
      if (!record) {
        throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
          worktreeId: input.worktreeId,
          workspaceId: input.workspaceId,
        });
      }
      if (record.status === 'removed') {
        throw providerError('WORKTREE_REMOVED', `Worktree has already been removed: ${input.worktreeId}`, {
          worktreeId: input.worktreeId,
        });
      }

      try {
        await context.git.removeWorktree(workspace.rootPath, record.absolutePath);
      } catch (error) {
        let stillRegistered: boolean;
        try {
          stillRegistered = false;
          for (const worktree of await context.git.listWorktrees(workspace.rootPath)) {
            if (await samePhysicalPath(worktree.absolutePath, record.absolutePath)) {
              stillRegistered = true;
              break;
            }
          }
        } catch {
          throw asGitError('remove worktree', workspace.rootPath, record.absolutePath, error);
        }
        if (stillRegistered) {
          throw asGitError('remove worktree', workspace.rootPath, record.absolutePath, error);
        }
      }
      gitRemoved = true;

      // Preserve Worktree and binding history while changing lifecycle only; DSH Sessions are never read or deleted here.
      const next: SidecarSnapshot = {
        ...snapshot,
        worktrees: snapshot.worktrees.map((candidate) =>
          candidate.worktreeId === record.worktreeId ? { ...candidate, status: 'removed' } : candidate,
        ),
        bindings: snapshot.bindings.map((binding) =>
          binding.worktreeId === record.worktreeId && binding.status === 'active'
            ? { ...binding, status: 'detached' }
            : binding,
        ),
      };
      return { result: undefined, snapshot: next };
    });
  } catch (error) {
    if (gitRemoved) {
      // Git removal cannot be rolled back here, so expose the divergence for a safe retry.
      const sidecarError = asSidecarError(error, input.workspaceId);
      throw providerError(
        'SIDECAR_SYNC_REQUIRED',
        `Git removed Worktree ${input.worktreeId}, but sidecar synchronization failed`,
        {
          workspaceId: input.workspaceId,
          worktreeId: input.worktreeId,
          workspaceRoot: workspace.rootPath,
          sidecarError: sidecarError.message,
        },
      );
    }
    throw error;
  }
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
