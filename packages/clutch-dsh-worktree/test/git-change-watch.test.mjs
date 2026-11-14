import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitChangeWatches } from '../lib/host/git-change-watch.js';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const { AbortController } = globalThis;

test('startup reconciliation covers a dropped native event and remains one-shot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let closed = 0;
  let emitChange;
  t.mock.method(fs, 'watch', (_directory, _options, listener) => {
    emitChange = listener;
    const watcher = new EventEmitter();
    watcher.close = () => { closed++; };
    return watcher; // Simulate a native startup window silently dropping all events.
  });
  syncBuiltinESMExports();
  const watches = new GitChangeWatches();
  t.after(() => { watches.dispose(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  const signal = new AbortController().signal;
  const id = await watches.start('/missing-startup-fixture', signal);
  const first = watches.next(id, 0, signal);
  t.mock.timers.tick(5000);
  const revision = await first;
  assert.ok(revision > 0, 'startup must reconcile even if native events are lost');
  const idle = watches.next(id, revision, signal);
  t.mock.timers.tick(5000);
  assert.equal(await idle, revision, 'reconciliation must not become five-second Git polling');
  watches.stop(id);
  assert.equal(closed, 1);
  const cancelled = await watches.start('/missing-startup-fixture', signal);
  const pending = watches.next(cancelled, 0, signal);
  watches.stop(cancelled);
  await assert.rejects(pending, /expired/);
  t.mock.timers.tick(5000);
  assert.equal(closed, 2, 'closing before startup reconciliation releases the watcher');
  await assert.rejects(watches.next(cancelled, 0, signal), /expired/);
  const coalesced = await watches.start('/missing-startup-fixture', signal);
  const changed = watches.next(coalesced, 0, signal);
  t.mock.timers.tick(900);
  emitChange('change', 'file.txt');
  t.mock.timers.tick(100);
  assert.equal(await changed, 1);
  const quiet = watches.next(coalesced, 1, signal);
  t.mock.timers.tick(5000);
  assert.equal(await quiet, 1, 'startup consumes the pending debounce instead of emitting twice');
  watches.stop(coalesced);
});

test('idle waits drain in five seconds and abandoned leases expire', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const watches = new GitChangeWatches();
  t.after(() => watches.dispose());
  const signal = new AbortController().signal;
  const id = await watches.start('/nonexistent-popover-checkout', signal);
  const idle = watches.next(id, 0, signal);
  t.mock.timers.tick(5000);
  assert.equal(await idle, 0, 'idle wait produces no refresh revision');
  t.mock.timers.tick(10000);
  await assert.rejects(watches.next(id, 0, signal), /expired/);
});

test('Git leases observe working files, index and shared refs and release pending waits', async (t) => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'popover-watch-'));
  const root = path.join(temp, 'checkout');
  const git = path.join(temp, 'metadata');
  const common = path.join(temp, 'common');
  await mkdir(root);
  await mkdir(git);
  await mkdir(path.join(common, 'refs', 'heads'), { recursive: true });
  await writeFile(path.join(root, '.git'), 'gitdir: ../metadata\n');
  await writeFile(path.join(git, 'commondir'), '../common\n');
  const watches = new GitChangeWatches();
  t.after(async () => { watches.dispose(); await rm(temp, { recursive: true, force: true }); });
  const controller = new AbortController();
  const id = await watches.start(root, controller.signal);
  let revision = 0;
  for (const file of [path.join(root, 'file.txt'), path.join(git, 'index'),
    path.join(common, 'refs', 'heads', 'main'), path.join(common, 'packed-refs')]) {
    const pending = watches.next(id, revision, controller.signal);
    await writeFile(file, 'changed');
    const next = await pending;
    assert.ok(next > revision, file);
    revision = next;
  }
  const pending = watches.next(id, revision, controller.signal);
  watches.stop(id);
  await assert.rejects(pending, /expired/);
  await assert.rejects(watches.next(id, revision, controller.signal), /expired/);
});

test('abort and Host disposal terminate notification waits; cancelled setup retains no lease', async () => {
  const watches = new GitChangeWatches();
  const controller = new AbortController();
  const id = await watches.start('/nonexistent-popover-checkout', controller.signal);
  const pending = watches.next(id, 0, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  watches.stop(id);
  await assert.rejects(watches.start('/missing', controller.signal), { name: 'AbortError' });
  const signal = new AbortController().signal;
  const nextId = await watches.start('/missing', signal);
  const disposed = watches.next(nextId, 0, signal);
  watches.dispose();
  await assert.rejects(disposed, /expired/);
  await assert.rejects(watches.start('/missing', signal), /disposed/);
});
