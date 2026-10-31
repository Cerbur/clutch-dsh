import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { WorktreeErrorDetails, WorktreeRecord } from '../contract/index.js';
import {
  type DshSessionSummary,
  type DshWorkspaceSummary,
  type SidecarSnapshot,
  WorktreeProviderError,
  isWorktreeProviderError,
  providerError,
} from '../provider/types.js';
import type { WorktreeManagerContext } from './manager-context.js';
import { samePhysicalPath, sameLexicalPath } from '../provider/path-identity.js';
import { boundSessionCwdMatchesWorktree, projectWorktreePath, worktreeWorkspaceAvailable } from '../provider/worktree-path.js';
import { assertGeneratedPath, workspaceWorktreePool } from '../provider/generated-path.js';

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

// 只有 `stat` 明确返回 ENOENT 才判定根目录确实不存在；其他 I/O 错误都保留
// WORKSPACE_NOT_FOUND 语义，并携带原始错误信息供诊断。
// Only an explicit ENOENT from `stat` proves the root directory is gone. Other I/O
// failures keep WORKSPACE_NOT_FOUND and preserve the original error details for diagnosis.
type WorkspaceRootState = 'directory' | 'missing' | 'not-directory';

function throwWorkspaceRootUnavailable(
  workspaceId: string,
  rootPath: string,
  rootState: Exclude<WorkspaceRootState, 'directory'>,
): never {
  if (rootState === 'missing') {
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

function throwWorkspaceRootIoFailure(
  workspaceId: string,
  rootPath: string,
  operation: 'inspect' | 'resolve',
  error: unknown,
): never {
  const details: Record<string, string> = {
    workspaceId,
    rootPath,
    cause: String(error),
  };
  if (typeof error === 'object' && error !== null) {
    const fileSystemError = error as {
      readonly code?: unknown;
      readonly path?: unknown;
      readonly syscall?: unknown;
    };
    if (typeof fileSystemError.code === 'string') details.causeCode = fileSystemError.code;
    if (typeof fileSystemError.path === 'string') details.causePath = fileSystemError.path;
    if (typeof fileSystemError.syscall === 'string') details.syscall = fileSystemError.syscall;
  }
  const message = operation === 'inspect'
    ? `Unable to inspect Workspace root: ${rootPath}`
    : `Unable to resolve Workspace root: ${rootPath}`;
  throw providerError('WORKSPACE_NOT_FOUND', message, details);
}

/** Classify the root once so all Workspace gates treat stat and resolution failures consistently. */
async function inspectWorkspaceRoot(workspaceId: string, rootPath: string): Promise<WorkspaceRootState> {
  let rootStat: Awaited<ReturnType<typeof stat>>;
  try {
    rootStat = await stat(rootPath);
  } catch (error) {
    if ((error as { readonly code?: string }).code === 'ENOENT') return 'missing';
    throwWorkspaceRootIoFailure(workspaceId, rootPath, 'inspect', error);
  }
  if (!rootStat.isDirectory()) return 'not-directory';
  try {
    await realpath(rootPath);
  } catch (error) {
    // Resolution errors are not evidence that stat observed a missing root.
    throwWorkspaceRootIoFailure(workspaceId, rootPath, 'resolve', error);
  }
  return 'directory';
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
  const rootState = await inspectWorkspaceRoot(workspaceId, rootPath);
  if (rootState === 'missing' && options.allowMissingRoot) return { ...workspace, rootPath };
  if (rootState !== 'directory') throwWorkspaceRootUnavailable(workspaceId, rootPath, rootState);
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
  if (!path.isAbsolute(workspace.rootPath)) {
    throw providerError('WORKSPACE_NOT_FOUND', `Workspace root has a non-absolute path: ${workspace.rootPath}`, {
      workspaceId: workspace.workspaceId,
      rootPath: workspace.rootPath,
    });
  }
  const rootState = await inspectWorkspaceRoot(workspace.workspaceId, workspace.rootPath);
  if (rootState !== 'directory') throwWorkspaceRootUnavailable(workspace.workspaceId, workspace.rootPath, rootState);
}

/** New checkouts live in one dedicated pool inside the original Workspace. */
export function validateGeneratedPath(
  context: WorktreeManagerContext, workspaceRoot: string, targetPath: string, worktreeId: string,
): void {
  if (isSameOrInside(workspaceRoot, path.resolve(context.dshHome)) ||
    !sameLexicalPath(path.resolve(targetPath), path.join(workspaceWorktreePool(workspaceRoot), worktreeId)) ||
    path.basename(worktreeId) !== worktreeId) {
    throw providerError('GIT_OPERATION_FAILED', 'Generated Worktree path is outside the allowed boundary', {
      workspaceRoot, targetPath, worktreeId,
    });
  }
}

export async function validatePhysicalGeneratedPath(
  context: WorktreeManagerContext, workspaceRoot: string, targetPath: string,
): Promise<void> {
  // Sidecar still lives in DSH Home; preserve its independent trust checks.
  await rejectSymlink(context.dshHome, 'DSH Home');
  await rejectSymlink(path.join(context.dshHome, 'clutch-dsh-worktree'), 'plugin sidecar root');
  await assertGeneratedPath(context.dshHome, workspaceRoot, targetPath, false);
}

// Bind only after DSH has published the target effective cwd; original membership stays authoritative.
// Legacy Worktree-header Sessions remain supported without migration or metadata edits.
export async function assertSessionMatchesWorkspace(
  session: DshSessionSummary,
  workspace: DshWorkspaceSummary,
  worktree: WorktreeRecord,
  existingBinding = false,
): Promise<void> {
  const matches = (cwd: string) => existingBinding
    ? boundSessionCwdMatchesWorktree(cwd, worktree)
    : samePhysicalPath(cwd, worktree.absolutePath);
  if (
    (session.workspaceId !== undefined && session.workspaceId !== workspace.workspaceId) ||
    (session.originalCwd !== undefined &&
      !(await matches(session.originalCwd)) &&
      !(session.workspaceId === workspace.workspaceId && await samePhysicalPath(session.originalCwd, workspace.rootPath))) ||
    (session.projectId !== undefined &&
      workspace.projectId !== undefined &&
      session.projectId !== workspace.projectId) ||
    !(path.isAbsolute(session.cwd) &&
      (await matches(session.cwd)))
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

/** Resolve old Git-root records through current DSH/Git facts; new records already capture the directory. */
export async function resolveWorktreeWorkspaceRecord(
  context: WorktreeManagerContext,
  workspace: DshWorkspaceSummary,
  record: WorktreeRecord,
  details: WorktreeErrorDetails = {},
): Promise<WorktreeRecord> {
  const repositoryRoot = record.gitRootPath === undefined && context.git.resolveRepositoryRoot
    ? await context.git.resolveRepositoryRoot(workspace.rootPath)
    : workspace.rootPath;
  const projected = await projectWorktreePath(record, workspace.rootPath, repositoryRoot);
  if (!(await worktreeWorkspaceAvailable(projected))) {
    throw providerError('WORKTREE_NOT_FOUND', 'Workspace directory is unavailable inside the Worktree', {
      ...details,
      workspaceId: workspace.workspaceId,
      worktreeId: record.worktreeId,
      absolutePath: projected.absolutePath,
    });
  }
  return projected;
}

export type { SidecarSnapshot };
