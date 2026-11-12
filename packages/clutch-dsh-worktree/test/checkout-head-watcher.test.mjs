import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceCheckoutWatcher } from '../lib/host/checkout-head-watcher.js';

const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

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
  await sleep(200);
  assert.deepEqual(changes, ['ws']);

  watcher.dispose();
  await writeFile(head, 'ref: refs/heads/third\n');
  await sleep(300);
  assert.deepEqual(changes, ['ws']);
});
