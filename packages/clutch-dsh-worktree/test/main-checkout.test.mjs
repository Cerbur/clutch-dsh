import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, realpath, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path';
import { LocalGitAdapter, createWorktreeManager, WorkspaceShardedSidecarRepository } from '../lib/index.js';
import { loadWorktreeView } from '../lib/client/view/worktree-view-read.js';
import { createMainWorktreeRecord } from '../lib/client/dashboard/dashboard-selection.js';
import { buildSessionFileAddress } from '../lib/client/dashboard/git/file-address.js';

test('Main in a monorepo subdirectory uses Workspace-relative file addresses', () => {
  const record = createMainWorktreeRecord(
    { workspaceId: 'ws', path: '/repo/packages/plugin' },
    'main',
    '',
    { gitRootPath: '/repo' },
  );
  const address = buildSessionFileAddress('session', 'src/index.ts', record.absolutePath, record.absolutePath, record.gitRootPath);
  assert.equal(address, 'dsh-resource://file/session/session/src/index.ts');
});

const execFile = promisify(execFileCallback);
const git = (cwd, args) => execFile('git', args, { cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });

test('real nested checkout projects branch, exact tags and detached commits without persisting HEAD', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'main-checkout-'));
  const repo = path.join(temp, 'repo');
  const working = path.join(repo, 'packages/app');
  const dshHome = path.join(temp, 'home');
  await mkdir(working, { recursive: true });
  await mkdir(dshHome);
  const sidecar = new WorkspaceShardedSidecarRepository({ dshHome });
  const adapter = new LocalGitAdapter();
  const manager = createWorktreeManager({ dshHome, sidecar, git: adapter, dsh: {
    async getWorkspace(id) { return id === 'ws' ? { workspaceId: id, projectId: 'p', rootPath: working } : undefined; },
    async getSession() { return undefined; }, async listSessions() { return []; },
  } });
  try {
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.email', 'test@example.invalid']);
    await git(repo, ['config', 'user.name', 'Main Test']);
    await writeFile(path.join(working, 'index.ts'), 'export {};\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'initial']);
    const commit = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
    await git(repo, ['tag', 'v1.0.0']);
    await git(repo, ['tag', '-a', 'annotated', '-m', 'release']);
    let checkout = await manager.getWorkspaceCheckout({ workspaceId: 'ws' });
    assert.equal(checkout.gitRootPath, await realpath(repo));
    assert.deepEqual(checkout.currentHead, { kind: 'branch', name: 'main', commit });
    await git(repo, ['checkout', 'v1.0.0']);
    checkout = await manager.getWorkspaceCheckout({ workspaceId: 'ws' });
    assert.equal(checkout.currentHead.kind, 'tag');
    assert.ok(['v1.0.0', 'annotated'].includes(checkout.currentHead.name));
    assert.equal(checkout.currentHead.commit, commit);
    const branches = await manager.listBranches({ workspaceId: 'ws' });
    assert.deepEqual(branches, [{ name: 'main', ref: 'refs/heads/main', kind: 'local', isCurrent: false, checkedOut: false }]);
    const view = await loadWorktreeView(manager, 'ws');
    assert.equal(view.readiness.status, 'ready');
    assert.equal(view.checkout.currentHead.kind, 'tag');
    const main = createMainWorktreeRecord({ workspaceId: 'ws', path: working }, null, '', view.checkout);
    assert.equal(main.currentBranch, null);
    assert.equal(buildSessionFileAddress('s', 'index.ts', main.absolutePath, main.absolutePath, main.gitRootPath),
      'dsh-resource://file/session/s/index.ts');
    const created = await manager.createWorktree({ workspaceId: 'ws', branch: 'HEAD', fromHead: true, newBranch: 'from-tag' });
    assert.equal(created.baseCommit, commit);
    assert.equal(created.baseBranch, undefined);
    assert.equal(created.absolutePath, path.join(created.gitRootPath, 'packages/app'));
    await git(created.gitRootPath, ['checkout', 'v1.0.0']);
    const observed = (await manager.listWorktrees({ workspaceId: 'ws' }))[0];
    assert.equal(observed.currentHead.kind, 'tag');
    assert.equal(observed.currentBranch, null);
    assert.equal(observed.health, 'branch-drift');
    const unrelated = path.join(temp, 'unmanaged-detached');
    await git(repo, ['worktree', 'add', '--detach', unrelated, commit]);
    const resolveHead = adapter.resolveCheckoutHead.bind(adapter);
    const probes = [];
    adapter.resolveCheckoutHead = async (_root, row) => {
      probes.push(row.absolutePath);
      throw new Error('display resolution unavailable');
    };
    const degradedCheckout = await manager.getWorkspaceCheckout({ workspaceId: 'ws' });
    assert.equal(Object.hasOwn(degradedCheckout, 'currentHead'), false);
    assert.deepEqual(probes, [await realpath(repo)]);
    probes.length = 0;
    const degradedRows = await manager.listWorktrees({ workspaceId: 'ws' });
    assert.deepEqual(probes, [await realpath(created.gitRootPath)]);
    assert.equal(degradedRows.length, 1);
    assert.equal(degradedRows[0].health, 'branch-drift');
    assert.equal(degradedRows[0].currentBranch, null);
    assert.equal(Object.hasOwn(degradedRows[0], 'currentHead'), false);
    adapter.resolveCheckoutHead = resolveHead;
    await sidecar.upsertWorktree(observed);
    const raw = JSON.parse(await readFile(path.join(dshHome, 'clutch-dsh-worktree/workspaces/ws.json'), 'utf8'));
    assert.equal(raw.schemaVersion, 7);
    assert.equal(Object.hasOwn(raw.worktrees[0], 'currentHead'), false);
    assert.equal(Object.hasOwn(raw.worktrees[0], 'currentBranch'), false);
    await git(repo, ['checkout', 'main']);
    await writeFile(path.join(working, 'index.ts'), '// second\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'second']);
    const detached = (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim();
    const beforeConflict = await sidecar.read('ws');
    await assert.rejects(manager.createWorktree({
      workspaceId: 'ws', branch: 'HEAD', fromHead: true, expectedHeadCommit: commit, newBranch: 'stale-head',
    }), { code: 'WORKTREE_STATE_CONFLICT' });
    assert.deepEqual(await sidecar.read('ws'), beforeConflict);
    await assert.rejects(git(repo, ['show-ref', '--verify', 'refs/heads/stale-head']));
    await git(repo, ['checkout', '--detach', detached]);
    checkout = await manager.getWorkspaceCheckout({ workspaceId: 'ws' });
    assert.equal(checkout.currentHead.kind, 'commit');
    assert.equal(checkout.currentHead.commit, detached);
    assert.ok(detached.startsWith(checkout.currentHead.name));
    await git(repo, ['branch', '-d', 'main']);
    await git(repo, ['branch', '-d', 'from-tag']);
    assert.equal((await loadWorktreeView(manager, 'ws')).readiness.status, 'ready');
    const fromCommit = await manager.createWorktree({ workspaceId: 'ws', branch: 'HEAD', fromHead: true,
      expectedHeadCommit: detached, newBranch: 'from-commit' });
    assert.equal(fromCommit.baseCommit, detached);
    await assert.rejects(manager.createWorktree({ workspaceId: 'ws', branch: 'v1.0.0', newBranch: 'invalid-tag-selector' }),
      (error) => error.code === 'GIT_OPERATION_FAILED');
    await assert.rejects(manager.getWorkspaceCheckout({ workspaceId: 'unknown' }), (error) => error.code === 'WORKSPACE_NOT_FOUND');
    const rows = await adapter.listWorktrees(repo);
    const row = rows.find((row) => row.absolutePath === checkout.gitRootPath);
    assert.equal(row.currentHead, undefined);
    assert.equal((await adapter.resolveCheckoutHead(repo, row)).kind, 'commit');
  } finally {
    await manager.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('legacy injected Manager remains readable without a checkout capability', async () => {
  const view = await loadWorktreeView({
    async listWorktrees() { return []; }, async listBranches() { return [{ name: 'main', isCurrent: true, checkedOut: true }]; },
    async listBindings() { return []; },
  }, 'ws');
  assert.equal(view.checkout, undefined);
  assert.equal(view.readiness.status, 'ready');
});

test('Main resolves the owning linked checkout through a nested Workspace path alias', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'linked-main-checkout-'));
  const repo = path.join(temp, 'repo');
  const linked = path.join(temp, 'linked');
  const alias = path.join(temp, 'linked-alias');
  const dshHome = path.join(temp, 'home');
  await mkdir(path.join(repo, 'packages/app'), { recursive: true });
  await mkdir(dshHome);
  let manager;
  try {
    await git(repo, ['init', '-b', 'main']);
    await git(repo, ['config', 'user.email', 'test@example.invalid']);
    await git(repo, ['config', 'user.name', 'Linked Main Test']);
    await writeFile(path.join(repo, 'packages/app/index.ts'), '// main\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-m', 'main']);
    await git(repo, ['worktree', 'add', '-b', 'linked-branch', linked]);
    await writeFile(path.join(linked, 'packages/app/index.ts'), '// linked\n');
    await git(linked, ['add', '.']);
    await git(linked, ['commit', '-m', 'linked']);
    await git(linked, ['tag', 'linked-tag']);
    await git(linked, ['checkout', '--detach', 'linked-tag']);
    await symlink(linked, alias, 'junction');
    const workspace = { workspaceId: 'ws', projectId: 'p', rootPath: path.join(alias, 'packages/app') };
    manager = createWorktreeManager({ dshHome, dsh: {
      async getWorkspace(id) { return id === 'ws' ? workspace : undefined; },
      async getSession() { return undefined; },
      async listSessions() { return []; },
    } });
    const checkout = await manager.getWorkspaceCheckout({ workspaceId: 'ws' });
    assert.equal(checkout.gitRootPath, await realpath(linked));
    assert.equal(checkout.workspacePath, await realpath(workspace.rootPath));
    assert.equal(checkout.currentHead.kind, 'tag');
    assert.equal(checkout.currentHead.name, 'linked-tag');
    assert.notEqual(checkout.currentHead.commit, (await git(repo, ['rev-parse', 'HEAD'])).stdout.trim());
    const main = createMainWorktreeRecord({ workspaceId: 'ws', path: workspace.rootPath }, undefined, '', checkout);
    const address = parseFileAddress(buildSessionFileAddress('s', 'index.ts', main.absolutePath, main.absolutePath, main.gitRootPath));
    assert.equal(address.scope, 'session');
    assert.equal(address.path, 'index.ts');
    assert.equal(await readFile(path.join(workspace.rootPath, address.path), 'utf8'), '// linked\n');
    const created = await manager.createWorktree({ workspaceId: 'ws', branch: 'HEAD', fromHead: true, newBranch: 'from-linked-tag' });
    assert.equal(created.baseCommit, checkout.currentHead.commit);
    assert.equal(await readFile(path.join(created.absolutePath, 'index.ts'), 'utf8'), '// linked\n');
  } finally {
    await manager?.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test('checkout failures omit optional data and preserve successful branches', async () => {
  const manager = {
    async listWorktrees() { return []; },
    async listBranches() { return [{ name: 'main', isCurrent: true, checkedOut: true }]; },
    async listBindings() { return []; },
    async getWorkspaceCheckout() { throw { code: 'WORKSPACE_ROOT_MISSING', message: 'missing root' }; },
  };
  for (const failure of [
    { code: 'WORKSPACE_ROOT_MISSING', message: 'missing root' },
    { code: 'WORKSPACE_NOT_GIT_REPOSITORY', message: 'no repository' },
    new Error('checkout unavailable'),
  ]) {
    for (const synchronous of [false, true]) {
      manager.getWorkspaceCheckout = synchronous
        ? () => { throw failure; } : async () => { throw failure; };
      const view = await loadWorktreeView(manager, 'ws');
      assert.equal(view.readiness.status, 'ready');
      assert.deepEqual(view.branches, [{ name: 'main', isCurrent: true, checkedOut: true }]);
      assert.equal(Object.hasOwn(view, 'checkout'), false);
    }
  }
  manager.listBranches = async () => [];
  assert.equal((await loadWorktreeView(manager, 'ws')).readiness.status, 'noLocalBranch');
  manager.getWorkspaceCheckout = async () => ({ currentHead: { kind: 'commit', name: 'abcdef0', commit: 'a'.repeat(40) } });
  assert.equal((await loadWorktreeView(manager, 'ws')).readiness.status, 'ready');
  manager.listBranches = async () => { throw { code: 'WORKTREE_REQUIRES_INITIAL_COMMIT' }; };
  assert.equal((await loadWorktreeView(manager, 'ws')).readiness.status, 'noInitialCommit');
});
