import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { WorktreeGitChangedFile, WorktreeGitCommitFiles } from '../contract/index.js';
import { providerError } from '../provider/types.js';

/** One coordinate boundary: Provider paths are checkout-relative, public paths are Workspace-relative. */
export async function workspaceGitPaths(checkoutRoot: string, workspaceDirectory: string) {
  const resolveDirectory = async (absolutePath: string): Promise<string> => {
    try {
      return await realpath(absolutePath);
    } catch (error) {
      throw providerError('WORKTREE_NOT_FOUND', 'Worktree directory is unavailable or needs repair', {
        absolutePath, checkoutRoot, workspaceDirectory,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const [checkout, workspace] = await Promise.all([resolveDirectory(checkoutRoot), resolveDirectory(workspaceDirectory)]);
  const insideCheckout = (absolute: string): boolean => {
    const relative = path.relative(checkout, absolute);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const reject = (value: unknown): never => {
    throw providerError('WORKTREE_STATE_CONFLICT', 'Expected a Workspace-relative changed file inside the Git checkout', {
      path: typeof value === 'string' ? value : '',
    });
  };
  if (!insideCheckout(workspace)) reject(workspaceDirectory);
  const slashRelative = (from: string, to: string): string => path.relative(from, to).split(path.sep).join('/');
  const toCheckout = (value: string): string => {
    if (typeof value !== 'string' || !value || value.includes('\0') || path.isAbsolute(value)) reject(value);
    const absolute = path.resolve(workspace, value);
    // Canonical paths avoid guessing whether an old root-relative input was intended.
    if (!insideCheckout(absolute) || slashRelative(workspace, absolute) !== value) reject(value);
    const relative = slashRelative(checkout, absolute);
    if (!relative) reject(value);
    return relative;
  };
  const toWorkspace = (value: string): string => {
    const absolute = path.resolve(checkout, value);
    if (!value || value.includes('\0') || path.isAbsolute(value) ||
      !insideCheckout(absolute) || slashRelative(checkout, absolute) !== value) reject(value);
    return slashRelative(workspace, absolute);
  };
  const projectFile = (file: WorktreeGitChangedFile): WorktreeGitChangedFile => ({
    ...file,
    path: toWorkspace(file.path),
    ...(file.oldPath === undefined ? {} : { oldPath: toWorkspace(file.oldPath) }),
  });
  return {
    toCheckout,
    projectFiles: (read: WorktreeGitCommitFiles): WorktreeGitCommitFiles => ({
      ...read,
      files: read.files.map(projectFile),
    }),
  };
}
