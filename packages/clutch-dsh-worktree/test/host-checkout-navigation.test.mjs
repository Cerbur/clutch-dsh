import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { WorktreeRemoteService } from '../lib/host/service.js';

const sleep = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(t) {
  const temp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'host-head-navigation-')));
  const root = path.join(temp, 'repo');
  await mkdir(root);
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  }).trim();
  git('init', '-b', 'main');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
  git('branch', 'next');
  const workspace = { id: 'ws', path: root, sessionIds: [] };
  const ctx = new Context();
  ctx.provide('workspaceRegistry', { get: (id) => id === 'ws' ? workspace : undefined, list: () => [workspace] });
  ctx.provide('sessions', { get: () => undefined, list: () => [] });
  ctx.provide('sessionPersistence', { list: async () => [] });
  t.after(async () => {
    ctx.fiber.dispose();
    await rm(temp, { recursive: true, force: true });
  });
  await ctx.plugin(WorktreeRemoteService, { dshHome: path.join(temp, 'home') });
  const service = ctx.get('worktreeManager');
  const read = service.remote.readWorkspaceNavigation.bind(service.remote);
  const navigation = () => service.readWorkspaceNavigation({ workspaceId: 'ws' });
  const changed = async (afterRevision = 0) => {
    const result = await service.watchToolChanges({ afterRevision }, globalThis.AbortSignal.timeout(5000));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.value.changes, [{ workspaceId: 'ws', worktreeId: 'main:ws' }]);
    return result.value.revision;
  };
  return { ctx, service, git, read, navigation, changed };
}

test('popover watch resolves Main on Host and rejects unrelated identities', async (t) => {
  const { service, git } = await fixture(t);
  const signal = new globalThis.AbortController().signal;
  const started = await service.startGitWatch({ workspaceId: 'ws', worktreeId: 'main' }, signal);
  assert.equal(started.ok, true);
  const waiting = service.watchGitChanges({ watchId: started.value, afterRevision: 0 }, signal);
  git('switch', 'next');
  assert.ok((await waiting).value > 0);
  assert.deepEqual(await service.stopGitWatch({ watchId: started.value }), { ok: true, value: null });
  await assert.rejects(service.watchGitChanges({ watchId: started.value, afterRevision: 0 }, signal), /expired/);
  await assert.rejects(service.startGitWatch({ workspaceId: 'ws', worktreeId: 'not-owned' }, signal), /unavailable/);
  const missing = await service.startGitWatch({ workspaceId: 'unknown', worktreeId: 'main' }, signal);
  assert.equal(missing.ok, false);
});

for (const mounted of [false, true]) {
  test(`navigation snapshot is reconciled when HEAD switches before observe (mounted: ${mounted})`, async (t) => {
    const f = await fixture(t);
    if (mounted) {
      assert.equal((await f.navigation()).value.checkout.currentHead.name, 'main');
      await sleep(200);
    }
    f.service.remote.readWorkspaceNavigation = async (input) => {
      const result = await f.read(input);
      f.git('switch', 'next');
      return result;
    };
    const stale = await f.navigation();
    assert.equal(stale.value.checkout.currentHead.name, 'main');
    assert.equal(f.git('branch', '--show-current'), 'next');
    await f.changed();
    f.service.remote.readWorkspaceNavigation = f.read;
    assert.equal((await f.navigation()).value.checkout.currentHead.name, 'next');
    await sleep(1200);
    const settledRevision = f.service.toolChanges.revision;
    await Promise.all([f.navigation(), f.navigation()]);
    await sleep(1200);
    assert.equal(f.service.toolChanges.revision, settledRevision, 'fresh repeated reads must not notify in a loop');
    assert.equal(f.service.checkoutWatcher.entries.size, 1);
  });
}

test('concurrent first navigation reads share observation and reconcile their stale snapshots', async (t) => {
  const f = await fixture(t);
  const ready = deferred();
  const release = deferred();
  let count = 0;
  f.service.remote.readWorkspaceNavigation = async (input) => {
    const result = await f.read(input);
    if (++count === 2) ready.resolve();
    await release.promise;
    return result;
  };
  const first = f.navigation();
  const second = f.navigation();
  await ready.promise;
  f.git('switch', 'next');
  release.resolve();
  for (const result of await Promise.all([first, second])) {
    assert.equal(result.value.checkout.currentHead.name, 'main');
  }
  await f.changed();
  assert.equal(f.service.checkoutWatcher.entries.size, 1);
  assert.equal(f.service.checkoutWatcher.pending.size, 0);
  f.service.remote.readWorkspaceNavigation = f.read;
  assert.equal((await f.navigation()).value.checkout.currentHead.name, 'next');
});

test('a late stale navigation result invalidates once even after the watcher observed the new HEAD', async (t) => {
  const f = await fixture(t);
  await f.navigation();
  await sleep(200);
  const ready = deferred();
  const release = deferred();
  f.service.remote.readWorkspaceNavigation = async (input) => {
    const result = await f.read(input);
    ready.resolve();
    await release.promise;
    return result;
  };
  const late = f.navigation();
  await ready.promise;
  f.git('switch', 'next');
  await f.changed();
  f.service.remote.readWorkspaceNavigation = f.read;
  assert.equal((await f.navigation()).value.checkout.currentHead.name, 'next');
  await sleep(1200);
  const revision = f.service.toolChanges.revision;
  release.resolve();
  assert.equal((await late).value.checkout.currentHead.name, 'main');
  const reconciled = await f.changed(revision);
  assert.equal((await f.navigation()).value.checkout.currentHead.name, 'next');
  await sleep(1200);
  assert.equal(f.service.toolChanges.revision, reconciled, 'a late result must not reset the watcher baseline');
});

test('navigation completing after Host disposal cannot install a watcher or notify', async (t) => {
  const f = await fixture(t);
  const ready = deferred();
  const release = deferred();
  f.service.remote.readWorkspaceNavigation = async (input) => {
    const result = await f.read(input);
    ready.resolve();
    await release.promise;
    return result;
  };
  const late = f.navigation();
  await ready.promise;
  f.ctx.fiber.dispose();
  f.git('switch', 'next');
  release.resolve();
  assert.equal((await late).ok, true);
  await sleep(200);
  assert.equal(f.service.checkoutWatcher.entries.size, 0);
  assert.equal(f.service.checkoutWatcher.pending.size, 0);
  assert.equal(f.service.toolChanges.revision, 0);
});
