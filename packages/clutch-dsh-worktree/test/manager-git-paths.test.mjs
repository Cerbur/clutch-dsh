import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { workspaceGitPaths } from '../lib/manage/manager-git-paths.js';

test('missing, dangling and non-directory Git paths report a repairable provider error', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-path-errors-'));
  try {
    const checkout = path.join(root, 'checkout');
    await mkdir(checkout);
    const missing = path.join(root, 'missing');
    const dangling = path.join(root, 'dangling');
    await symlink(missing, dangling, 'junction');
    const file = path.join(root, 'file');
    await writeFile(file, '');
    for (const [gitRoot, workspace] of [
      [missing, checkout], [checkout, missing], [checkout, dangling], [checkout, path.join(file, 'child')],
    ]) {
      await assert.rejects(workspaceGitPaths(gitRoot, workspace), (error) => {
        assert.equal(error.code, 'WORKTREE_NOT_FOUND');
        assert.ok(error.details.absolutePath);
        assert.match(error.details.cause, /ENOENT|ENOTDIR/u);
        return true;
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
