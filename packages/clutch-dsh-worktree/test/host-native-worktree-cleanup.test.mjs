import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { registerNativeWorktreeCleanup } from '../lib/host/native-worktree-cleanup.js';
import { WorktreeRemoteService } from '../lib/host/service.js';
import { WorkspaceShardedSidecarRepository } from '../lib/provider/sidecar/repository.js';

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'host-native-cleanup-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const checkout = path.join(root, 'native-checkout');
  const home = path.join(root, 'home');
  await mkdir(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 });
  git('init', '-b', 'main');
  await writeFile(path.join(repo, 'tracked.txt'), 'initial\n');
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'initial');
  git('worktree', 'add', '-b', 'native', checkout);
  const workspace = { id: 'ws', path: repo, sessionIds: ['owner', 'child'] };
  const unrelated = { id: 'unrelated', path: repo, sessionIds: [] };
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('workspaceRegistry', { get: (id) => [workspace, unrelated].find((item) => item.id === id), list: () => [workspace, unrelated] });
  ctx.provide('sessions', { get: () => undefined, list: () => [] });
  ctx.provide('sessionPersistence', { list: async () => [] });
  await ctx.plugin(WorktreeRemoteService, { dshHome: home });
  const service = ctx.get('worktreeManager');
  const imported = await service.importWorktree({ workspaceId: 'ws', absolutePath: checkout });
  assert.equal(imported.ok, true);
  const record = imported.value;
  const sidecar = new WorkspaceShardedSidecarRepository({ dshHome: home });
  const emit = (status) => ctx.emit('worktree/cleanup', { sessionId: 'owner', path: checkout, cleanup: { revision: 1, status } });
  return { ctx, service, sidecar, record, git, checkout, emit };
}

test('mounted Host invalidates only the imported checkout after native cleanup settles without claiming disk cleanup', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.sidecar.getShardPath('ws'), 'utf8');
  const ready = await f.service.listWorktrees({ workspaceId: 'ws' });
  assert.equal(ready.value[0].health, 'ready');
  f.emit('scheduled');
  f.git('worktree', 'remove', f.checkout);
  f.emit('removed');
  const result = await f.service.watchToolChanges({ afterRevision: 0 }, globalThis.AbortSignal.timeout(1500));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.value.changes, [{ workspaceId: 'ws', worktreeId: f.record.worktreeId }]);
  const refreshed = await f.service.listWorktrees({ workspaceId: 'ws' });
  assert.equal(refreshed.value[0].health, 'repair');
  assert.equal(refreshed.value[0].diskCleanup, undefined);
  assert.equal(await readFile(f.sidecar.getShardPath('ws'), 'utf8'), before);
  await assert.rejects(readFile(f.sidecar.getShardPath('unrelated')), { code: 'ENOENT' });
});

test('scheduled physical identity survives removal of a symlinked checkout until settlement', async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'native-cleanup-alias-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout');
  const alias = path.join(root, 'alias');
  await mkdir(checkout);
  await symlink(checkout, alias);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const changes = [];
  registerNativeWorktreeCleanup(ctx, {
    dsh: { listWorkspaces: async () => [{ workspaceId: 'ws' }] },
    sidecar: { read: async () => ({ worktrees: [{ workspaceId: 'ws', worktreeId: 'wt', absolutePath: alias }] }) },
    changed: (...identity) => changes.push(identity),
  });
  const event = (status) => ({ sessionId: 'owner', path: checkout, cleanup: { revision: 1, status } });
  await ctx.parallel('worktree/cleanup', event('scheduled'));
  assert.deepEqual(changes, [], 'admission must never publish a premature ready refresh');
  await rm(checkout, { recursive: true });
  await ctx.parallel('worktree/cleanup', event('removed'));
  assert.deepEqual(changes, [['ws', 'wt']]);
});

async function eventFixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'native-cleanup-events-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout');
  await mkdir(checkout);
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const changes = [];
  let reads = 0;
  const records = new Map([
    ['ws', [{ workspaceId: 'ws', worktreeId: 'wt', absolutePath: path.join(checkout, 'subdirectory'), gitRootPath: checkout }]],
    ['unrelated', [{ workspaceId: 'unrelated', worktreeId: 'other', absolutePath: path.join(root, 'other') }]],
  ]);
  const sidecar = { read: async (workspaceId) => { reads++; return { worktrees: records.get(workspaceId) ?? [] }; } };
  registerNativeWorktreeCleanup(ctx, {
    dsh: { listWorkspaces: async () => [...records.keys()].map((workspaceId) => ({ workspaceId })) },
    sidecar,
    changed: (...identity) => changes.push(identity),
  });
  const event = (status, revision = 1) => ({ sessionId: 'owner', path: checkout, cleanup: { revision, status } });
  return { root, checkout, ctx, changes, records, sidecar, event, reads: () => reads };
}

for (const status of ['removed', 'retained', 'failed']) test(`native ${status} settles without admission and refreshes only matching checkout owners`, async (t) => {
  const f = await eventFixture(t);
  // A checkout can be imported by multiple registered Workspaces. Owner Session
  // membership must neither hide those records nor authorize an unrelated record.
  f.records.set('second-owner', [{ workspaceId: 'second-owner', worktreeId: 'second', absolutePath: f.checkout }]);
  f.records.get('ws').push({ workspaceId: 'wrong-owner', worktreeId: 'wrong', absolutePath: f.checkout });
  f.records.get('ws').push({ workspaceId: 'ws', worktreeId: 'cleaned', absolutePath: f.checkout, diskCleanup: 'completed' });
  await f.ctx.parallel('worktree/cleanup', f.event(status));
  assert.deepEqual(f.changes, [['ws', 'wt'], ['second-owner', 'second']]);
});

test('unknown, malformed and relative-path native events do not read or refresh any Workspace', async (t) => {
  const f = await eventFixture(t);
  for (const event of [null, {}, f.event('unknown'), { ...f.event('removed'), path: 'relative' },
    { ...f.event('removed'), cleanup: { revision: -1, status: 'removed' } }]) {
    await f.ctx.parallel('worktree/cleanup', event);
  }
  assert.equal(f.reads(), 0);
  assert.deepEqual(f.changes, []);
});

test('failed shards and uncertain path identity never widen notification scope', async (t) => {
  const f = await eventFixture(t);
  const loop = path.join(f.root, 'loop');
  await symlink(loop, loop);
  f.records.set('uncertain', [{ workspaceId: 'uncertain', worktreeId: 'loop', absolutePath: loop }]);
  f.records.set('broken', []);
  const read = f.sidecar.read;
  f.sidecar.read = async (id) => {
    if (id === 'broken') throw new Error('corrupt sidecar');
    return read(id);
  };
  await f.ctx.parallel('worktree/cleanup', f.event('failed'));
  assert.deepEqual(f.changes, [['ws', 'wt']]);
  f.changes.length = 0;
  await f.ctx.parallel('worktree/cleanup', { ...f.event('failed', 2), path: path.join(f.root, 'missing') });
  assert.deepEqual(f.changes, [], 'ENOENT on one path cannot mask ELOOP on the other');
});

for (const change of ['forgotten', 'moved', 'workspace-removed']) test(`settlement revalidates ${change} ownership captured at admission`, async (t) => {
  const f = await eventFixture(t);
  await f.ctx.parallel('worktree/cleanup', f.event('scheduled'));
  assert.deepEqual(f.changes, []);
  if (change === 'forgotten') f.records.set('ws', []);
  if (change === 'workspace-removed') f.records.delete('ws');
  if (change === 'moved') f.records.get('ws')[0].gitRootPath = path.join(f.root, 'moved');
  await f.ctx.parallel('worktree/cleanup', f.event('removed'));
  assert.deepEqual(f.changes, []);
});

test('settlement waits for in-flight admission matching and publishes once after its final read', async (t) => {
  const f = await eventFixture(t);
  const read = f.sidecar.read;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let entered;
  const reading = new Promise((resolve) => { entered = resolve; });
  let first = true;
  f.sidecar.read = async (id) => {
    if (first) { first = false; entered(); await held; }
    return read(id);
  };
  const scheduled = f.ctx.parallel('worktree/cleanup', f.event('scheduled'));
  await reading;
  const settled = f.ctx.parallel('worktree/cleanup', f.event('removed'));
  assert.deepEqual(f.changes, []);
  release();
  await Promise.all([scheduled, settled]);
  assert.deepEqual(f.changes, [['ws', 'wt']]);
});

test('disposal unregisters events and suppresses pending asynchronous invalidation', async (t) => {
  const f = await eventFixture(t);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let entered;
  const reading = new Promise((resolve) => { entered = resolve; });
  const read = f.sidecar.read;
  f.sidecar.read = async (id) => { entered(); await held; return read(id); };
  const pending = f.ctx.parallel('worktree/cleanup', f.event('removed'));
  await reading;
  await f.ctx.fiber.dispose();
  release();
  await pending;
  assert.deepEqual(f.changes, []);
  const reads = f.reads();
  await f.ctx.parallel('worktree/cleanup', f.event('removed', 2));
  assert.equal(f.reads(), reads);
});

for (const replacement of ['other-checkout', 'uncertain-loop']) test(`admission identity cannot authorize a ${replacement} alias at settlement`, async (t) => {
  const f = await eventFixture(t);
  const alias = path.join(f.root, 'alias');
  await symlink(f.checkout, alias);
  f.records.get('ws')[0].gitRootPath = alias;
  await f.ctx.parallel('worktree/cleanup', f.event('scheduled'));
  await rm(alias);
  const other = path.join(f.root, 'other-checkout');
  await mkdir(other);
  await symlink(replacement === 'uncertain-loop' ? alias : other, alias);
  await f.ctx.parallel('worktree/cleanup', f.event('removed'));
  assert.deepEqual(f.changes, []);
});
