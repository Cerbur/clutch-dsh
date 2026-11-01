import path from 'node:path';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { providerError } from './types.js';
import { sameLexicalPath } from './path-identity.js';

/** A dedicated pool inside the immutable Session workspace, including subdirectory Workspaces. */
export const workspaceWorktreePool = (root: string): string => path.resolve(root, '.agents', 'clutch-worktrees');

export function generatedPathAncestors(dshHome: string, root: string, target: string): readonly string[] | undefined {
  const pool = workspaceWorktreePool(root);
  if (sameLexicalPath(path.dirname(path.resolve(target)), pool)) return [path.join(root, '.agents'), pool, target];
  const legacy = path.resolve(dshHome, 'clutch-dsh-worktree', 'worktree');
  const relative = path.relative(legacy, path.resolve(target));
  const insideWorkspace = path.relative(path.resolve(root), path.resolve(target));
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative) &&
    (insideWorkspace.startsWith(`..${path.sep}`) || insideWorkspace === '..' || path.isAbsolute(insideWorkspace)))
    return [dshHome, path.dirname(legacy), legacy, target];
  return undefined;
}

export async function assertGeneratedPath(dshHome: string, root: string, target: string, checkTarget = true): Promise<void> {
  const ancestors = generatedPathAncestors(dshHome, root, target);
  if (!ancestors) throw providerError('WORKTREE_IDENTITY_CHANGED', 'Worktree path is outside its trusted pool', { targetPath: target });
  for (const ancestor of checkTarget ? ancestors : ancestors.slice(0, -1)) {
    try {
      if ((await lstat(ancestor)).isSymbolicLink())
        throw providerError('WORKTREE_IDENTITY_CHANGED', 'Worktree pool or target is a symlink', { targetPath: target, path: ancestor });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

/** Only the plugin-owned pool gets an ignore file; existing repository ignore files are untouched. */
export async function prepareWorktreePool(dshHome: string, root: string, target: string): Promise<void> {
  if (!sameLexicalPath(path.dirname(path.resolve(target)), workspaceWorktreePool(root))) return;
  await assertGeneratedPath(dshHome, root, target);
  const pool = workspaceWorktreePool(root);
  await mkdir(pool, { recursive: true });
  await assertGeneratedPath(dshHome, root, target);
  const physicalRoot = await realpath(root);
  const physicalPool = await realpath(pool);
  if (!sameLexicalPath(physicalPool, workspaceWorktreePool(physicalRoot)))
    throw providerError('WORKTREE_IDENTITY_CHANGED', 'Worktree pool escaped its Workspace', { targetPath: target });
  const ignore = path.join(pool, '.gitignore');
  try {
    await writeFile(ignore, '*\n', { flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if ((await lstat(ignore)).isSymbolicLink() || await readFile(ignore, 'utf8') !== '*\n')
      throw providerError('WORKTREE_STATE_CONFLICT', 'Worktree pool ignore file is not plugin-owned', { path: ignore });
  }
}
