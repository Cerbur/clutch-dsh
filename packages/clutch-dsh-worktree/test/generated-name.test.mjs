import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createWorktreeManager,
  WorkspaceShardedSidecarRepository,
  LocalGitAdapter,
} from '../lib/index.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'short-worktree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const repo = path.join(root, 'repo');
  await mkdir(home);
  await mkdir(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '-b', 'main');
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'initial',
  );
  const dsh = { getWorkspace: async (workspaceId) => ({ workspaceId, rootPath: repo }) };
  const sidecar = new WorkspaceShardedSidecarRepository({ dshHome: home });
  const manager = (options = {}) => {
    const value = createWorktreeManager({ dsh, dshHome: home, sidecar, ...options });
    t.after(() => value.close());
    return value;
  };
  const directory = path.join(home, 'clutch-dsh-worktree', 'worktree');
  await mkdir(directory, { recursive: true });
  return { root, repo, home, git, sidecar, manager, directory };
}

test('rerolls files, dangling symlinks and prunable registrations before any Git create', async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, 'wt_file'), 'keep');
  await symlink(path.join(f.root, 'absent'), path.join(f.directory, 'wt_link'));
  const stale = path.join(f.directory, 'wt_stale');
  f.git('worktree', 'add', '-b', 'stale', stale);
  await rm(stale, { recursive: true });
  let calls = 0;
  class CountingGit extends LocalGitAdapter {
    async createWorktree(...args) {
      calls++;
      return super.createWorktree(...args);
    }
  }
  const ids = ['wt_file', 'wt_link', 'wt_stale', 'wt_available'];
  const manager = f.manager({ idFactory: () => ids.shift(), git: new CountingGit() });
  const created = await manager.createWorktree({
    workspaceId: 'one',
    branch: 'main',
    newBranch: 'created',
  });
  assert.equal(created.worktreeId, 'wt_available');
  assert.equal(calls, 1);
  assert.equal(await readFile(path.join(f.directory, 'wt_file'), 'utf8'), 'keep');
  const snapshot = await f.sidecar.read('one');
  assert.equal(snapshot.revision, '2');
  assert.equal(snapshot.pendingOperation, undefined);
  assert.deepEqual(snapshot.worktrees, [created]);
});

test('suffix fallback skips occupied suffixes even when the factory always repeats', async (t) => {
  const f = await fixture(t);
  for (const name of ['wt_repeat', 'wt_repeat_1', 'wt_repeat_2']) {
    await mkdir(path.join(f.directory, name));
  }
  let calls = 0;
  const manager = f.manager({
    idFactory: () => {
      calls++;
      return 'wt_repeat';
    },
  });
  const created = await manager.createWorktree({
    workspaceId: 'one',
    branch: 'main',
    newBranch: 'created',
  });
  assert.equal(created.worktreeId, 'wt_repeat_3');
  assert.equal(calls, 8);
});

for (const separateRepository of [false, true]) {
  test(`concurrent managers sharing a generated directory create distinct worktrees (separate repository: ${separateRepository})`, async (t) => {
    const f = await fixture(t);
    let secondDsh;
    if (separateRepository) {
      const secondRepo = path.join(f.root, 'second-repo');
      execFileSync('git', ['clone', f.repo, secondRepo], { stdio: 'pipe' });
      secondDsh = { getWorkspace: async (workspaceId) => ({ workspaceId, rootPath: secondRepo }) };
    }
    const first = f.manager({ idFactory: () => 'wt_shared' });
    const second = f.manager({
      idFactory: () => 'wt_shared',
      ...(secondDsh ? { dsh: secondDsh } : {}),
    });
    const created = await Promise.all([
      first.createWorktree({ workspaceId: 'one', branch: 'main', newBranch: 'first' }),
      second.createWorktree({ workspaceId: 'two', branch: 'main', newBranch: 'second' }),
    ]);
    assert.equal(new Set(created.map((record) => record.absolutePath)).size, 2);
    for (const record of created) {
      assert.deepEqual((await f.sidecar.read(record.workspaceId)).worktrees, [record]);
    }
  });
}

test('legacy sidecar injection also skips occupied names before Git creation', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.directory, 'wt_legacy'));
  const manager = f.manager({
    idFactory: () => 'wt_legacy',
    sidecar: {
      read: (workspaceId) => f.sidecar.read(workspaceId),
      mutate: (workspaceId, mutation) => f.sidecar.mutate(workspaceId, mutation),
    },
  });
  const created = await manager.createWorktree({
    workspaceId: 'one',
    branch: 'main',
    newBranch: 'legacy',
  });
  assert.equal(created.worktreeId, 'wt_legacy_1');
  assert.deepEqual((await f.sidecar.read('one')).worktrees, [created]);
});

test('ordinary Git failures are not retried as generated-name collisions', async (t) => {
  const f = await fixture(t);
  let calls = 0;
  class FailingGit extends LocalGitAdapter {
    async createWorktree() {
      calls++;
      throw new Error('permission denied');
    }
  }
  const manager = f.manager({ git: new FailingGit() });
  await assert.rejects(
    manager.createWorktree({ workspaceId: 'one', branch: 'main', newBranch: 'created' }),
    { code: 'GIT_OPERATION_FAILED' },
  );
  assert.equal(calls, 1);
  assert.equal((await f.sidecar.read('one')).pendingOperation, undefined);
});

test('retained sidecar paths through a parent alias are skipped even with a different ID', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.root, 'managed-alias');
  await symlink(f.directory, alias, 'dir');
  await f.sidecar.upsertWorktree({
    workspaceId: 'one',
    worktreeId: 'old_identity',
    absolutePath: path.join(alias, 'wt_retained'),
    branch: 'old',
    source: 'external',
    status: 'removed',
    diskCleanup: 'completed',
  });
  const ids = ['wt_retained', 'wt_fresh'];
  const created = await f.manager({ idFactory: () => ids.shift() }).createWorktree({
    workspaceId: 'one',
    branch: 'main',
    newBranch: 'created',
  });
  assert.equal(created.worktreeId, 'wt_fresh');
  assert.equal((await f.sidecar.read('one')).worktrees.length, 2);
});

test('closing the manager interrupts repeated collision retries', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.directory, 'wt_busy'));
  let manager;
  let creates = 0;
  class ClosingGit extends LocalGitAdapter {
    async validateRepository(root) {
      void manager.close();
      return super.validateRepository(root);
    }
    async createWorktree() {
      creates++;
    }
  }
  manager = f.manager({ idFactory: () => 'wt_busy', git: new ClosingGit() });
  await assert.rejects(
    manager.createWorktree({ workspaceId: 'one', branch: 'main', newBranch: 'created' }),
    /Worktree manager is closing/,
  );
  await manager.close();
  assert.equal(creates, 0);
});
