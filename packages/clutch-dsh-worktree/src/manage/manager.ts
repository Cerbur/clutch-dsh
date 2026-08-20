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

// 这是词法边界检查，既接受 parent 本身也接受其后代；物理路径边界会在后续单独校验。
// This is a lexical boundary check that accepts parent itself and descendants; physical boundaries are validated separately later.
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

// 优先比较 canonical path 以覆盖符号链接/路径别名；无法 canonicalize 时退回绝对词法比较。
// Prefer canonical paths to cover symlinks and aliases; fall back to absolute lexical comparison when canonicalization is unavailable.
async function samePhysicalPath(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

// 已存在的受信边界不允许是 symlink，避免后续创建绕过 DSH Home 的物理目录约束。
// Existing trusted boundaries may not be symlinks, preventing later creation from escaping the physical DSH Home boundary.
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

/**
 * Worktree/Session 用例编排器：DSH 只提供权威只读事实，Git 承担 worktree 副作用，sidecar 只保存外部关系。
 * Worktree/Session use-case orchestrator: DSH supplies authoritative read-only facts, Git owns worktree side effects, and the sidecar stores only external relations.
 */
export class WorktreeManagerImpl implements WorktreeManagerService {
  private readonly dsh: WorktreeManagerOptions['dsh'];
  private readonly dshHome: string;
  private readonly git: GitWorktreeAdapter;
  private readonly sidecar: SidecarStore;
  private readonly idFactory: () => string;

  /**
   * 使用可注入端口组合 Manager；未注入的 Git 与 sidecar 端口会绑定到本地 Provider 实现。
   * Composes the Manager from injectable ports; omitted Git and sidecar ports bind to local Provider implementations.
   */
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

  /**
   * 返回含 active/removed 状态的 sidecar Worktree 投影。
   * Returns the sidecar Worktree projection, including active/removed state.
   */
  async listWorktrees(input: { workspaceId: WorkspaceId }): Promise<readonly WorktreeRecord[]> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const records = (await this.sidecar.read(input.workspaceId)).worktrees;
    let gitWorktrees: readonly { readonly absolutePath: string }[];
    try {
      gitWorktrees = await this.git.listWorktrees(workspace.rootPath);
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

  /**
   * 将本地分支与所有 Git worktree 联合投影，以便调用方禁用已 checkout 的分支。
   * Projects local branches against every Git worktree so callers can disable branches that are already checked out.
   */
  async listBranches(input: { workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    await this.git.validateRepository(workspace.rootPath);
    const [branches, worktrees] = await Promise.all([
      this.git.listBranches(workspace.rootPath),
      this.git.listWorktrees(workspace.rootPath),
    ]);

    // `checkedOut` 覆盖主 Workspace 和所有 linked worktree；`isCurrent` 只标识与 Workspace root 同一物理路径的条目。
    // `checkedOut` covers the main Workspace and all linked worktrees; `isCurrent` only identifies the entry at the Workspace root's physical path.
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

  /**
   * 创建受 DSH Home 边界管理的 Git Worktree，并仅在 sidecar 提交成功后返回；已 checkout 的
   * base branch 可以通过 newBranch 创建新的本地 branch。持久化失败会补偿删除 Git Worktree。
   * Creates a Git Worktree inside the managed DSH Home boundary and returns only after sidecar
   * commit. An already checked-out base branch can create a new local branch through newBranch.
   * Persistence failure compensates by removing the Git Worktree.
   */
  async createWorktree(input: {
    workspaceId: WorkspaceId;
    branch: string;
    newBranch?: string;
  }): Promise<WorktreeRecord> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    await this.git.validateRepository(workspace.rootPath);

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

    const branches = await this.git.listBranches(workspace.rootPath);
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

    const existingGitWorktrees = await this.git.listWorktrees(workspace.rootPath);
    if (existingGitWorktrees.some((worktree) => worktree.branch === targetBranch)) {
      throw providerError('WORKTREE_BRANCH_CONFLICT', `Branch is already checked out: ${targetBranch}`, {
        workspaceRoot: workspace.rootPath,
        branch: targetBranch,
        baseBranch,
      });
    }

    const worktreeId = generatedId(this.idFactory);
    const targetPath = path.resolve(this.dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);

    // 创建前同时检查词法和物理目录边界，阻止配置、ID 或 symlink 将目标引回 Workspace 或带出插件根目录。
    // Check lexical and physical directory boundaries before creation so configuration, IDs, or symlinks cannot redirect the target into the Workspace or outside the plugin root.
    this.validateGeneratedPath(workspace.rootPath, targetPath, worktreeId);
    await this.validatePhysicalGeneratedPath(workspace.rootPath, targetPath);
    if (await pathExists(targetPath)) {
      throw providerError('GIT_OPERATION_FAILED', `Generated Worktree path already exists: ${targetPath}`, {
        workspaceRoot: workspace.rootPath,
        targetPath,
        worktreeId,
      });
    }

    // Git 是第一个外部副作用；下方 sidecar mutation 是关系提交点，失败时必须反向清理这一步。
    // Git is the first external side effect; the sidecar mutation below is the relation commit point and must compensate this step on failure.
    try {
      await this.git.createWorktree(workspace.rootPath, targetPath, baseBranch, newBranch);
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
      return await this.sidecar.mutate(input.workspaceId, (snapshot) => {
        // 在互斥 mutation 内重新检查 ID/branch，避免 Git 预检之后的并发 sidecar 写入造成重复 active 记录。
        // Recheck ID and branch inside the serialized mutation so a concurrent sidecar write after the Git preflight cannot create duplicate active records.
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

      // sidecar 未提交时删除新建 Worktree；若补偿也失败，显式要求同步修复而不是掩盖残留 Git 状态。
      // Remove the new Worktree when sidecar commit fails; if compensation also fails, require explicit synchronization instead of hiding residual Git state.
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

  /**
   * 先删除 Git Worktree，再原子标记 record 为 removed 并保留 detached bindings；失败阶段决定该操作是否可直接重试或需要同步修复。
   * Removes the Git Worktree first, then atomically marks its record removed and preserves detached bindings; the failure phase determines whether retry or synchronization repair is required.
   */
  async removeWorktree(input: { workspaceId: WorkspaceId; worktreeId: string }): Promise<void> {
    const workspace = await this.requireWorkspace(input.workspaceId);

    // 该标记区分“尚无 Git 副作用”的失败和“Git 已删除但 sidecar 未提交”的部分成功。
    // This marker distinguishes failures before any Git side effect from partial success where Git removed the Worktree but sidecar commit failed.
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
          // Git 已不再报告这个物理 Worktree；这是上一次 sidecar 同步失败后的显式幂等修复路径。
          // Git no longer reports this physical Worktree; this is the explicit idempotent repair path after an earlier sidecar sync failure.
        }
        gitRemoved = true;

        // 保留 Worktree 与 binding 历史，只改变生命周期；DSH Session 从不在此流程中读取或删除。
        // Preserve Worktree and binding history while changing lifecycle only; DSH Sessions are never read or deleted in this flow.
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
        // 此时不能回滚 Git 删除，因此用专用错误暴露 Git/sidecar 不一致，供同一删除操作安全重试。
        // Git removal cannot be rolled back here, so a dedicated error exposes the Git/sidecar divergence for a safe retry of the same removal.
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

  /**
   * 返回 Workspace 的 active/detached Session 关系。
   * Returns active/detached Session relations for the Workspace.
   */
  async listBindings(input: { workspaceId: WorkspaceId }): Promise<readonly SessionBinding[]> {
    await this.requireWorkspace(input.workspaceId);
    return (await this.sidecar.read(input.workspaceId)).bindings;
  }

  /**
   * 将已由 DSH 创建且 cwd 指向目标 Worktree 的 Session 绑定到 sidecar；相同 active 请求幂等，其他既有关系一律冲突。
   * Binds a DSH-created Session whose cwd already targets the Worktree; the same active request is idempotent and every other existing relation conflicts.
   */
  async bindSession(input: {
    workspaceId: WorkspaceId;
    worktreeId: string;
    sessionId: string;
  }): Promise<SessionBinding> {
    const workspace = await this.requireWorkspace(input.workspaceId);

    // 查重、DSH 事实校验和追加发生在同一序列化 mutation 中，防止并发请求绕过单 Session 关系不变量。
    // Duplicate checks, DSH fact validation, and append happen in one serialized mutation so concurrent requests cannot bypass the one-relation-per-Session invariant.
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
          // 精确重试不触发磁盘写入；detached 历史不会被隐式重新激活。
          // An exact retry performs no disk write; detached history is never reactivated implicitly.
          return { result: existing, snapshot, changed: false };
        }
        throw providerError('SESSION_ALREADY_BOUND', `Session is already bound to Worktree ${existing.worktreeId}`, {
          sessionId: input.sessionId,
          worktreeId: existing.worktreeId,
        });
      }

      // Session identity、Workspace/Project 归属和持久化 cwd 都来自 DSH；插件只验证这些事实，不做修正写回。
      // Session identity, Workspace/Project ownership, and persisted cwd come from DSH; the plugin validates these facts without writing corrections back.
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

  /**
   * 派生一次执行的 cwd：无 binding 或 detached 时使用 Workspace root，active 时要求对应 Worktree 记录和目录均有效。
   * Derives cwd for one execution: no binding or detached uses the Workspace root, while active requires both a valid Worktree record and directory.
   */
  async resolveRuntimeCwd(input: { workspaceId: WorkspaceId; sessionId: string }): Promise<string> {
    const workspace = await this.requireWorkspace(input.workspaceId);
    const snapshot = await this.sidecar.read(input.workspaceId);
    const binding = snapshot.bindings.find((candidate) => candidate.sessionId === input.sessionId);

    // detached 是保留关系历史的安全 main fallback；active 关系损坏则在下方明确失败，绝不静默降级。
    // Detached is a safe main fallback that preserves relation history; a broken active relation fails explicitly below and never degrades silently.
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

  // Workspace root 始终从 DSH 只读 adapter 获取并在使用时验证，不复制到 sidecar。
  // The Workspace root always comes from the read-only DSH adapter and is validated at use time rather than copied into the sidecar.
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

  // 第一层使用未解析路径验证目标属于插件根且不位于 Workspace 内。
  // The first layer uses unresolved paths to ensure the target belongs to the plugin root and is not inside the Workspace.
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

  // 第二层拒绝受信祖先 symlink，并以 realpath 后的根重新计算目标，防止物理路径逃逸。
  // The second layer rejects symlinked trusted ancestors and recomputes the target from the realpath root to prevent physical path escape.
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

  // 绑定只接受 DSH 已按目标 Worktree cwd 创建的 Session；Manager 不替用户迁移或改写 Session。
  // Binding accepts only Sessions already created by DSH with the target Worktree cwd; the Manager never migrates or rewrites a Session.
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

/**
 * 创建实现 `WorktreeManagerService` 的默认编排器，同时保留所有底层端口的注入能力。
 * Creates the default `WorktreeManagerService` orchestrator while preserving injection for every low-level port.
 */
export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManagerService {
  return new WorktreeManagerImpl(options);
}
