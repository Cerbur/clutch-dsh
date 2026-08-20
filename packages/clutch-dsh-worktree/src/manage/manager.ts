import { randomUUID } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  BranchRecord,
  SessionBinding,
  WorktreeRecord,
  WorkspaceId,
} from '../contract/index.js';

import { LocalGitAdapter } from '../provider/git.js';
import { WorkspaceShardedSidecarRepository } from '../provider/sidecar.js';
import {
  type DshSessionSummary,
  type DshWorkspaceSummary,
  type GitWorktreeAdapter,
  type SidecarSnapshot,
  type SidecarStore,
  WorktreeProviderError,
  isWorktreeProviderError,
  providerError,
} from '../provider/types.js';
import type { WorktreeManagerOptions, WorktreeManagerService } from './types.js';

function isSameOrInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if ((error as { readonly code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as { readonly code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}

async function samePhysicalPath(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

async function rejectSymlink(filePath: string, label: string): Promise<void> {
  try {
    if ((await lstat(filePath)).isSymbolicLink()) {
      throw providerError('GIT_OPERATION_FAILED', `${label} must not be a symlink: ${filePath}`, {
        path: filePath,
      });
    }
  } catch (error) {
    if ((error as { readonly code?: string }).code === 'ENOENT') return;
    if (isWorktreeProviderError(error)) throw error;
    throw providerError('GIT_OPERATION_FAILED', `Unable to inspect ${label}: ${filePath}`, {
      path: filePath,
      cause: String(error),
    });
  }
}

function asGitError(
  operation: string,
  workspaceRoot: string,
  targetPath: string | undefined,
  error: unknown,
): WorktreeProviderError {
  if (isWorktreeProviderError(error)) return error;
  return providerError('GIT_OPERATION_FAILED', `Git ${operation} failed: ${String(error)}`, {
    workspaceRoot,
    ...(targetPath ? { targetPath } : {}),
    operation,
  });
}

function asSidecarError(error: unknown, workspaceId: string): WorktreeProviderError {
  if (isWorktreeProviderError(error)) return error;
  return providerError('SIDECAR_UNAVAILABLE', `Sidecar operation failed for Workspace ${workspaceId}`, {
    workspaceId,
    cause: String(error),
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function generatedId(idFactory: () => string): string {
  const worktreeId = idFactory();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(worktreeId)) {
    throw providerError('GIT_OPERATION_FAILED', 'Provider generated an invalid Worktree ID', { worktreeId });
  }
  return worktreeId;
}

export class WorktreeManagerImpl implements WorktreeManagerService {
  private readonly dsh: WorktreeManagerOptions['dsh'];
  private readonly dshHome: string;
  private readonly git: GitWorktreeAdapter;
  private readonly sidecar: SidecarStore;
  private readonly idFactory: () => string;

  constructor(options: WorktreeManagerOptions) {
    if (!path.isAbsolute(options.dshHome)) {
      throw providerError('SIDECAR_UNAVAILABLE', 'DSH Home must be an absolute path', {
        dshHome: options.dshHome,
      });
    }
    this.dsh = options.dsh;
    this.dshHome = path.resolve(options.dshHome);
    this.git = options.git ?? new LocalGitAdapter();
    this.sidecar = options.sidecar ?? new WorkspaceShardedSidecarRepository({ dshHome: this.dshHome });
    this.idFactory = options.idFactory ?? (() => `wt_${randomUUID()}`);
  }

  async listWorktrees(input: { workspaceId: WorkspaceId }): Promise<readonly WorktreeRecord[]> {
    await this.requireWorkspace(input.workspaceId);
    return (await this.sidecar.read(input.workspaceId)).worktrees;
  }

  async listBranches(input: { workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    await this.git.validateRepository(workspace.rootPath);
    const [branches, worktrees] = await Promise.all([
      this.git.listBranches(workspace.rootPath),
      this.git.listWorktrees(workspace.rootPath),
    ]);
    const checkedOut = new Set(worktrees.flatMap((worktree) => (worktree.branch ? [worktree.branch] : [])));
    let currentBranch: string | undefined;
    for (const worktree of worktrees) {
      if (await samePhysicalPath(worktree.absolutePath, workspace.rootPath)) {
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

  async createWorktree(input: { workspaceId: WorkspaceId; branch: string }): Promise<WorktreeRecord> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    await this.git.validateRepository(workspace.rootPath);

    if (typeof input.branch !== 'string' || input.branch.length === 0) {
      throw providerError('GIT_OPERATION_FAILED', 'A local branch is required', {
        workspaceRoot: workspace.rootPath,
      });
    }

    const branches = await this.git.listBranches(workspace.rootPath);
    if (!branches.includes(input.branch)) {
      throw providerError('GIT_OPERATION_FAILED', `Local branch does not exist: ${input.branch}`, {
        workspaceRoot: workspace.rootPath,
        branch: input.branch,
      });
    }

    const existingGitWorktrees = await this.git.listWorktrees(workspace.rootPath);
    if (existingGitWorktrees.some((worktree) => worktree.branch === input.branch)) {
      throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already checked out: ${input.branch}`, {
        workspaceRoot: workspace.rootPath,
        branch: input.branch,
      });
    }

    const worktreeId = generatedId(this.idFactory);
    const targetPath = path.resolve(this.dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);
    this.validateGeneratedPath(workspace.rootPath, targetPath, worktreeId);
    await this.validatePhysicalGeneratedPath(workspace.rootPath, targetPath);
    if (await pathExists(targetPath)) {
      throw providerError('GIT_OPERATION_FAILED', `Generated Worktree path already exists: ${targetPath}`, {
        workspaceRoot: workspace.rootPath,
        targetPath,
        worktreeId,
      });
    }

    try {
      await this.git.createWorktree(workspace.rootPath, targetPath, input.branch);
    } catch (error) {
      throw asGitError('create worktree', workspace.rootPath, targetPath, error);
    }

    const record: WorktreeRecord = {
      worktreeId,
      workspaceId: input.workspaceId,
      absolutePath: targetPath,
      branch: input.branch,
      status: 'active',
    };

    try {
      return await this.sidecar.mutate(input.workspaceId, (snapshot) => {
        const idConflict = snapshot.worktrees.find((worktree) => worktree.worktreeId === worktreeId);
        if (idConflict) {
          throw providerError('SIDECAR_CORRUPT', `Generated Worktree ID is already recorded: ${worktreeId}`, {
            worktreeId,
            existingStatus: idConflict.status,
          });
        }
        const branchConflict = snapshot.worktrees.find(
          (worktree) => worktree.status === 'active' && worktree.branch === input.branch,
        );
        if (branchConflict) {
          throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already recorded as active: ${input.branch}`, {
            branch: input.branch,
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
      try {
        await this.git.removeWorktree(workspace.rootPath, targetPath);
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

  async removeWorktree(input: { workspaceId: WorkspaceId; worktreeId: string }): Promise<void> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    let gitRemoved = false;

    try {
      await this.sidecar.mutate(input.workspaceId, async (snapshot) => {
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
          await this.git.removeWorktree(workspace.rootPath, record.absolutePath);
        } catch (error) {
          let stillRegistered: boolean;
          try {
            stillRegistered = false;
            for (const worktree of await this.git.listWorktrees(workspace.rootPath)) {
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
          // Git already no longer reports this exact Worktree. This is the
          // explicit reconciliation path after a prior sidecar sync failure.
        }
        gitRemoved = true;

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

  async listBindings(input: { workspaceId: WorkspaceId }): Promise<readonly SessionBinding[]> {
    await this.requireWorkspace(input.workspaceId);
    return (await this.sidecar.read(input.workspaceId)).bindings;
  }

  async bindSession(input: {
    workspaceId: WorkspaceId;
    worktreeId: string;
    sessionId: string;
  }): Promise<SessionBinding> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    return this.sidecar.mutate(input.workspaceId, async (snapshot) => {
      const worktree = snapshot.worktrees.find((candidate) => candidate.worktreeId === input.worktreeId);
      if (!worktree) {
        throw providerError('WORKTREE_NOT_FOUND', `Worktree not found: ${input.worktreeId}`, {
          workspaceId: input.workspaceId,
          worktreeId: input.worktreeId,
        });
      }
      if (worktree.status === 'removed') {
        throw providerError('WORKTREE_REMOVED', `Worktree has been removed: ${input.worktreeId}`, {
          workspaceId: input.workspaceId,
          worktreeId: input.worktreeId,
        });
      }

      const existing = snapshot.bindings.find((binding) => binding.sessionId === input.sessionId);
      if (existing) {
        if (existing.worktreeId === input.worktreeId && existing.status === 'active') {
          return { result: existing, snapshot, changed: false };
        }
        throw providerError('SESSION_ALREADY_BOUND', `Session is already bound to Worktree ${existing.worktreeId}`, {
          sessionId: input.sessionId,
          worktreeId: existing.worktreeId,
        });
      }

      const session = await this.dsh.getSession(input.sessionId);
      if (!session) {
        throw providerError('SESSION_NOT_FOUND', `Session not found: ${input.sessionId}`, {
          sessionId: input.sessionId,
        });
      }
      this.assertSessionMatchesWorkspace(session, workspace, worktree);

      const binding: SessionBinding = {
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
        sessionId: input.sessionId,
        status: 'active',
      };
      return {
        result: binding,
        snapshot: { ...snapshot, bindings: [...snapshot.bindings, binding] },
      };
    });
  }

  async resolveRuntimeCwd(input: { workspaceId: WorkspaceId; sessionId: string }): Promise<string> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const snapshot = await this.sidecar.read(input.workspaceId);
    const binding = snapshot.bindings.find((candidate) => candidate.sessionId === input.sessionId);
    if (!binding || binding.status === 'detached') return workspace.rootPath;

    const worktree = snapshot.worktrees.find((candidate) => candidate.worktreeId === binding.worktreeId);
    if (!worktree) {
      throw providerError('WORKTREE_NOT_FOUND', `Active binding points to a missing Worktree: ${binding.worktreeId}`, {
        workspaceId: input.workspaceId,
        worktreeId: binding.worktreeId,
        sessionId: input.sessionId,
      });
    }
    if (worktree.status !== 'active') {
      throw providerError('WORKTREE_REMOVED', `Active binding points to a removed Worktree: ${worktree.worktreeId}`, {
        workspaceId: input.workspaceId,
        worktreeId: worktree.worktreeId,
        sessionId: input.sessionId,
      });
    }
    if (!(await isDirectory(worktree.absolutePath))) {
      throw providerError('WORKTREE_NOT_FOUND', `Active Worktree path does not exist: ${worktree.absolutePath}`, {
        workspaceId: input.workspaceId,
        worktreeId: worktree.worktreeId,
        sessionId: input.sessionId,
        absolutePath: worktree.absolutePath,
      });
    }
    return worktree.absolutePath;
  }

  private async requireWorkspace(workspaceId: WorkspaceId): Promise<DshWorkspaceSummary> {
    const workspace = await this.dsh.getWorkspace(workspaceId);
    if (!workspace || workspace.workspaceId !== workspaceId || !path.isAbsolute(workspace.rootPath)) {
      throw providerError('WORKSPACE_NOT_FOUND', `Workspace is missing or has a non-absolute root: ${workspaceId}`, {
        workspaceId,
        rootPath: workspace?.rootPath ?? '',
      });
    }
    const rootPath = path.resolve(workspace.rootPath);
    if (!(await isDirectory(rootPath))) {
      throw providerError('WORKSPACE_NOT_FOUND', `Workspace root does not exist: ${rootPath}`, {
        workspaceId,
        rootPath,
      });
    }
    try {
      await realpath(rootPath);
    } catch (error) {
      throw providerError('WORKSPACE_NOT_FOUND', `Unable to resolve Workspace root: ${rootPath}`, {
        workspaceId,
        rootPath,
        cause: String(error),
      });
    }
    return { ...workspace, rootPath };
  }

  private validateGeneratedPath(workspaceRoot: string, targetPath: string, worktreeId: string): void {
    const pluginRoot = path.resolve(this.dshHome, 'clutch-dsh-worktree');
    if (!isSameOrInside(pluginRoot, targetPath) || isSameOrInside(workspaceRoot, targetPath)) {
      throw providerError('GIT_OPERATION_FAILED', 'Generated Worktree path is outside the allowed boundary', {
        workspaceRoot,
        targetPath,
        worktreeId,
      });
    }
  }

  private async validatePhysicalGeneratedPath(workspaceRoot: string, targetPath: string): Promise<void> {
    await rejectSymlink(this.dshHome, 'DSH Home');
    await rejectSymlink(path.join(this.dshHome, 'clutch-dsh-worktree'), 'plugin sidecar root');
    await rejectSymlink(path.join(this.dshHome, 'clutch-dsh-worktree', 'worktree'), 'Worktree root');

    let canonicalDshHome: string;
    try {
      canonicalDshHome = await realpath(this.dshHome);
    } catch (error) {
      throw providerError('SIDECAR_UNAVAILABLE', `Unable to resolve DSH Home: ${this.dshHome}`, {
        dshHome: this.dshHome,
        cause: String(error),
      });
    }
    const targetRelativeToDshHome = path.relative(this.dshHome, targetPath);
    const canonicalTarget = path.resolve(canonicalDshHome, targetRelativeToDshHome);
    const canonicalWorkspace = await realpath(workspaceRoot);
    if (!isSameOrInside(canonicalDshHome, canonicalTarget) || isSameOrInside(canonicalWorkspace, canonicalTarget)) {
      throw providerError('GIT_OPERATION_FAILED', 'Generated Worktree path crosses a physical boundary', {
        workspaceRoot: canonicalWorkspace,
        dshHome: canonicalDshHome,
        targetPath: canonicalTarget,
      });
    }
  }

  private assertSessionMatchesWorkspace(
    session: DshSessionSummary,
    workspace: DshWorkspaceSummary,
    worktree: WorktreeRecord,
  ): void {
    if (
      (session.workspaceId !== undefined && session.workspaceId !== workspace.workspaceId) ||
      (session.projectId !== undefined &&
        workspace.projectId !== undefined &&
        session.projectId !== workspace.projectId) ||
      !path.isAbsolute(session.cwd) ||
      path.resolve(session.cwd) !== path.resolve(worktree.absolutePath)
    ) {
      throw providerError('SESSION_CWD_MISMATCH', `Session cwd or Workspace association does not match Worktree`, {
        sessionId: session.sessionId,
        workspaceId: workspace.workspaceId,
        expectedCwd: worktree.absolutePath,
        actualCwd: session.cwd,
        sessionWorkspaceId: session.workspaceId ?? '',
        sessionProjectId: session.projectId ?? '',
      });
    }
  }
}

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManagerService {
  return new WorktreeManagerImpl(options);
}
