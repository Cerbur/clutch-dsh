import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceCheckoutWatcher } from '../lib/host/checkout-head-watcher.js';

const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

for (const failure of ['silent', 'throw', 'error']) {
  test(`HEAD observation survives ${failure} native watcher failure`, async (t) => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'checkout-watch-fallback-'));
    const gitDir = path.join(temp, 'metadata');
    const worktree = path.join(temp, 'wt');
    await mkdir(gitDir);
    await mkdir(worktree);
    const head = path.join(gitDir, 'HEAD');
    await writeFile(head, 'ref: refs/heads/main\n');
    await writeFile(path.join(worktree, '.git'), 'gitdir: ../metadata\n');
    const native = new EventEmitter();
    native.close = () => {};
    t.mock.method(fs, 'watch', () => {
      if (failure === 'throw') throw Object.assign(new Error('watch unavailable'), { code: 'EMFILE' });
      if (failure === 'error') globalThis.setTimeout(() => native.emit('error', new Error('watch failed')), 0);
      return native;
    });
    syncBuiltinESMExports();
    const changes = [];
    let disposed = false;
    const watcher = new WorkspaceCheckoutWatcher({
      isDisposed: () => disposed,
      onChanged: (workspaceId, root) => changes.push([workspaceId, root]),
      debounceMs: 10,
      pollIntervalMs: 25,
    });
    t.after(async () => {
      watcher.dispose();
      t.mock.restoreAll();
      syncBuiltinESMExports();
      await rm(temp, { recursive: true, force: true });
    });
    await watcher.observe('ws', worktree);
    await sleep(100); // Let the registration reconciliation finish before switching.
    assert.deepEqual(changes, []);
    await writeFile(path.join(gitDir, 'HEAD.lock'), 'ref: refs/heads/next\n');
    await rename(path.join(gitDir, 'HEAD.lock'), head);
    await waitFor(() => changes.length === 1);
    assert.deepEqual(changes, [['ws', worktree]]);
    await writeFile(head, 'ref: refs/heads/next\n');
    await writeFile(path.join(gitDir, 'index'), 'unrelated');
    await sleep(100);
    assert.equal(changes.length, 1, 'unchanged HEAD and index writes must not refresh');
    await writeFile(head, '0123456789012345678901234567890123456789\n');
    await waitFor(() => changes.length === 2);
    disposed = true;
    await writeFile(head, 'ref: refs/heads/stopped\n');
    await sleep(100);
    assert.equal(changes.length, 2, 'the host lifecycle gate stops notifications');
    watcher.dispose();
    await writeFile(head, 'ref: refs/heads/disposed\n');
    await sleep(100);
    assert.equal(changes.length, 2);
  });
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  assert.fail('timed out waiting for checkout HEAD change');
}

test('a branch switch in a .git directory reports only that Workspace', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'checkout-watch-'));
  const gitDir = path.join(temp, '.git');
  const head = path.join(gitDir, 'HEAD');
  await mkdir(gitDir);
  await writeFile(head, 'ref: refs/heads/main\n');
  const changes = [];
  const watcher = new WorkspaceCheckoutWatcher({
    isDisposed: () => false,
    onChanged: (workspaceId, gitRootPath) => changes.push([workspaceId, gitRootPath]),
  });
  t.after(async () => {
    watcher.dispose();
    await rm(temp, { recursive: true, force: true });
  });

  await watcher.observe('ws', temp);
  await writeFile(head, 'ref: refs/heads/next\n');
  await waitFor(() => changes.length > 0);
  assert.deepEqual(changes, [['ws', temp]]);
});

test('a linked-worktree .git file resolves its gitdir before watching HEAD', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'checkout-watch-linked-'));
  const gitDir = path.join(temp, 'main', '.git', 'worktrees', 'wt');
  const worktree = path.join(temp, 'wt');
  await mkdir(gitDir, { recursive: true });
  await mkdir(worktree);
  await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feat\n');
  await writeFile(path.join(worktree, '.git'), `gitdir: ${gitDir}\n`);
  const changes = [];
  const watcher = new WorkspaceCheckoutWatcher({
    isDisposed: () => false,
    onChanged: (workspaceId, gitRootPath) => changes.push([workspaceId, gitRootPath]),
  });
  t.after(async () => {
    watcher.dispose();
    await rm(temp, { recursive: true, force: true });
  });

  await watcher.observe('ws', worktree);
  await writeFile(path.join(gitDir, 'HEAD'), 'ref: refs/heads/other\n');
  await waitFor(() => changes.length > 0);
  assert.deepEqual(changes, [['ws', worktree]]);
});

test('repeated observation is inert and disposal stops reporting', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'checkout-watch-dispose-'));
  const gitDir = path.join(temp, '.git');
  const head = path.join(gitDir, 'HEAD');
  await mkdir(gitDir);
  await writeFile(head, 'ref: refs/heads/main\n');
  const changes = [];
  const watcher = new WorkspaceCheckoutWatcher({
    isDisposed: () => false,
    onChanged: (workspaceId) => changes.push(workspaceId),
  });
  t.after(async () => {
    watcher.dispose();
    await rm(temp, { recursive: true, force: true });
  });

  await watcher.observe('ws', temp);
  await watcher.observe('ws', temp);
  await writeFile(head, 'ref: refs/heads/next\n');
  await waitFor(() => changes.length > 0);
  await sleep(1200); // Polling after the native event must not duplicate the notification.
  assert.deepEqual(changes, ['ws']);

  watcher.dispose();
  await writeFile(head, 'ref: refs/heads/third\n');
  await sleep(300);
  assert.deepEqual(changes, ['ws']);
});
