import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { WorktreeRecord } from '../contract/index.js';
import {
  type DshSessionSummary,
  type DshWorkspaceSummary,
  type SidecarSnapshot,
  WorktreeProviderError,
  isWorktreeProviderError,
  providerError,
} from '../provider/types.js';
import type { WorktreeManagerContext } from './manager-context.js';

// 这是词法边界检查，既接受 parent 本身也接受其后代；物理路径边界会在后续单独校验。
// This is a lexical boundary check that accepts parent itself and descendants; physical boundaries are validated separately later.
export function isSameOrInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch (error) {
    if ((error as { readonly code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
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
export async function samePhysicalPath(left: string, right: string): Promise<boolean> {
  try {
    return (await realpath(left)) === (await realpath(right));
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

// 已存在的受信边界不允许是 symlink，避免后续创建绕过 DSH Home 的物理目录约束。
// Existing trusted boundaries may not be symlinks, preventing later creation from escaping the physical DSH Home boundary.
export async function rejectSymlink(filePath: string, label: string): Promise<void> {
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

export function asGitError(
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

export function asSidecarError(error: unknown, workspaceId: string): WorktreeProviderError {
  if (isWorktreeProviderError(error)) return error;
  return providerError('SIDECAR_UNAVAILABLE', `Sidecar operation failed for Workspace ${workspaceId}`, {
    workspaceId,
    cause: String(error),
  });
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function generatedId(idFactory: () => string): string {
  const worktreeId = idFactory();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(worktreeId)) {
    throw providerError('GIT_OPERATION_FAILED', 'Provider generated an invalid Worktree ID', { worktreeId });
  }
  return worktreeId;
}

export async function requireWorkspace(
  context: WorktreeManagerContext,
  workspaceId: string,
): Promise<DshWorkspaceSummary> {
  const workspace = await context.dsh.getWorkspace(workspaceId);
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
export function validateGeneratedPath(
  context: WorktreeManagerContext,
  workspaceRoot: string,
  targetPath: string,
  worktreeId: string,
): void {
  const pluginRoot = path.resolve(context.dshHome, 'clutch-dsh-worktree');
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
export async function validatePhysicalGeneratedPath(
  context: WorktreeManagerContext,
  workspaceRoot: string,
  targetPath: string,
): Promise<void> {
  await rejectSymlink(context.dshHome, 'DSH Home');
  await rejectSymlink(path.join(context.dshHome, 'clutch-dsh-worktree'), 'plugin sidecar root');
  await rejectSymlink(path.join(context.dshHome, 'clutch-dsh-worktree', 'worktree'), 'Worktree root');

  let canonicalDshHome: string;
  try {
    canonicalDshHome = await realpath(context.dshHome);
  } catch (error) {
    throw providerError('SIDECAR_UNAVAILABLE', `Unable to resolve DSH Home: ${context.dshHome}`, {
      dshHome: context.dshHome,
      cause: String(error),
    });
  }
  const targetRelativeToDshHome = path.relative(context.dshHome, targetPath);
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
export function assertSessionMatchesWorkspace(
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

export type { SidecarSnapshot };
