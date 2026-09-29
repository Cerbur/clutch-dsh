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
import { samePhysicalPath } from '../provider/path-identity.js';

export { samePhysicalPath };

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

/** Resolve an existing path to its physical identity, preserving an absolute fallback for unavailable paths. */
export async function canonicalPath(filePath: string): Promise<string> {
  try {
    return await realpath(filePath);
  } catch {
    return path.resolve(filePath);
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

// 只有 `stat` 明确返回 ENOENT 才判定根目录确实不存在；其他情况（未知 Workspace、
// 非绝对 root、存在但不是目录、无法解析）保留 `WORKSPACE_NOT_FOUND` 语义。
// Only an explicit ENOENT from `stat` proves the root directory is gone. Every other
// case (unknown Workspace, non-absolute root, existing non-directory, unresolvable root)
// keeps its own `WORKSPACE_NOT_FOUND` semantics.
function throwWorkspaceRootUnavailable(workspaceId: string, rootPath: string, rootMissing: boolean): never {
  if (rootMissing) {
    throw providerError('WORKSPACE_ROOT_MISSING', `Workspace root directory is missing: ${rootPath}`, {
      workspaceId,
      rootPath,
    });
  }
  throw providerError('WORKSPACE_NOT_FOUND', `Workspace root is not a directory: ${rootPath}`, {
    workspaceId,
    rootPath,
  });
}

export async function requireWorkspace(
  context: WorktreeManagerContext,
  workspaceId: string,
  options: { readonly allowMissingRoot?: boolean } = {},
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
    const rootMissing = !(await pathExists(rootPath));
    if (rootMissing && options.allowMissingRoot) return { ...workspace, rootPath };
    throwWorkspaceRootUnavailable(workspaceId, rootPath, rootMissing);
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

/** Allow sidecar-backed read projections when DSH still knows a Workspace whose root is gone. */
export async function requireWorkspaceForRead(
  context: WorktreeManagerContext,
  workspaceId: string,
): Promise<DshWorkspaceSummary> {
  return requireWorkspace(context, workspaceId, { allowMissingRoot: true });
}

/** Reject Git-dependent reads when the tolerated Workspace root is not an available directory. */
export async function requireWorkspaceRoot(workspace: DshWorkspaceSummary): Promise<void> {
  if (await isDirectory(workspace.rootPath)) return;
  throwWorkspaceRootUnavailable(
    workspace.workspaceId,
    workspace.rootPath,
    !(await pathExists(workspace.rootPath)),
  );
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
export async function assertSessionMatchesWorkspace(
  session: DshSessionSummary,
  workspace: DshWorkspaceSummary,
  worktree: WorktreeRecord,
): Promise<void> {
  if (
    (session.workspaceId !== undefined && session.workspaceId !== workspace.workspaceId) ||
    (session.projectId !== undefined &&
      workspace.projectId !== undefined &&
      session.projectId !== workspace.projectId) ||
    !(path.isAbsolute(session.cwd) &&
      (await samePhysicalPath(session.cwd, worktree.absolutePath)))
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
