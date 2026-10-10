import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { gitWorktreeRoot, type WorktreeRecord } from '../contract/index.js';
import { sameLexicalPath, samePhysicalPath } from './path-identity.js';
import { providerError } from './types.js';

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Only for an already-active binding: DSH retains a legacy Session's Git-root cwd. */
export async function boundSessionCwdMatchesWorktree(
  cwd: string,
  record: Pick<WorktreeRecord, 'absolutePath' | 'gitRootPath'>,
  compare: (left: string, right: string) => Promise<boolean> = samePhysicalPath,
): Promise<boolean> {
  return path.isAbsolute(cwd) &&
    (await compare(cwd, record.absolutePath) ||
      (record.gitRootPath !== undefined && await compare(cwd, record.gitRootPath)));
}

/** Map the authoritative Workspace's physical repository-relative directory into a checkout. */
export async function workspacePathInWorktree(
  workspaceRoot: string,
  repositoryRoot: string,
  targetRoot: string,
): Promise<string> {
  if (sameLexicalPath(workspaceRoot, repositoryRoot)) return targetRoot;
  const [workspace, repository] = await Promise.all([realpath(workspaceRoot), realpath(repositoryRoot)]);
  if (!inside(repository, workspace)) {
    throw providerError('WORKSPACE_NOT_FOUND', 'Workspace is outside its Git checkout', { workspaceRoot, repositoryRoot });
  }
  return path.resolve(targetRoot, path.relative(repository, workspace));
}

/** Project legacy paths from DSH/Git facts without writing Session or sidecar corrections. */
export async function projectWorktreePath(
  record: WorktreeRecord,
  workspaceRoot: string,
  repositoryRoot: string,
): Promise<WorktreeRecord> {
  if (record.gitRootPath !== undefined) return record;
  const absolutePath = await workspacePathInWorktree(workspaceRoot, repositoryRoot, record.absolutePath);
  return absolutePath === record.absolutePath ? record : { ...record, gitRootPath: record.absolutePath, absolutePath };
}

/** Missing directories and symlinks escaping the checkout cannot become the execution cwd. */
export async function worktreeWorkspaceAvailable(record: Pick<WorktreeRecord, 'absolutePath' | 'gitRootPath'>): Promise<boolean> {
  try {
    if (!(await stat(record.absolutePath)).isDirectory()) return false;
    const [root, workspace] = await Promise.all([realpath(gitWorktreeRoot(record)), realpath(record.absolutePath)]);
    return inside(root, workspace);
  } catch (error) {
    if ((error as { readonly code?: string }).code === 'ENOENT') return false;
    throw error;
  }
}
