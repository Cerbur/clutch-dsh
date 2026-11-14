import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GitChangeWatches } from '../lib/host/git-change-watch.js';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { EventEmitter, getEventListeners } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const { AbortController } = globalThis;

for (const stage of ['stat', 'gitdir', 'commondir']) {
  for (const lateFailure of [false, true]) {
    test(`abort immediately cleans resources while ${stage} stays blocked (late failure: ${lateFailure})`, async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const timers = new Map();
      const setTimer = globalThis.setTimeout;
      const clearTimer = globalThis.clearTimeout;
      t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
        const timer = setTimer(() => { timers.delete(timer); callback(...args); }, delay);
        timers.set(timer, delay);
        return timer;
      });
      t.mock.method(globalThis, 'clearTimeout', (timer) => {
        timers.delete(timer); return clearTimer(timer);
      });
      let ready;
      const blocked = new Promise((resolve) => { ready = resolve; });
      let finish;
      const pause = (value) => new Promise((resolve, reject) => {
        finish = () => lateFailure ? reject(new Error('late I/O failure')) : resolve(value);
        ready();
      });
      let reads = 0;
      t.mock.method(fsp, 'stat', async () => {
        reads++;
        return stage === 'stat' ? pause({ isFile: () => true }) : { isFile: () => true };
      });
      t.mock.method(fsp, 'readFile', async (file) => {
        reads++;
        const kind = path.basename(file) === '.git' ? 'gitdir' : 'commondir';
        const value = kind === 'gitdir' ? 'gitdir: ../metadata' : '../common';
        return stage === kind ? pause(value) : value;
      });
      let emitChange;
      let opened = 0;
      let closed = 0;
      t.mock.method(fs, 'watch', (_directory, _options, listener) => {
        emitChange = listener;
        opened++;
        const watcher = new EventEmitter();
        watcher.close = () => { closed++; };
        return watcher;
      });
      syncBuiltinESMExports();
      const watches = new GitChangeWatches();
      t.after(() => { watches.dispose(); t.mock.restoreAll(); syncBuiltinESMExports(); });
      const controller = new AbortController();
      const starting = watches.start('/slow-checkout', controller.signal);
      const rejected = assert.rejects(starting, { name: 'AbortError' });
      await blocked;
      assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
      emitChange('change', 'before-abort.txt');
      assert.deepEqual([...timers.values()].sort((a, b) => a - b), [200, 15_000]);
      controller.abort();
      // Do not unblock the filesystem: cleanup must not depend on its completion.
      assert.equal(closed, 1);
      assert.equal(timers.size, 0, 'expiry and pending debounce are cancelled immediately');
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      emitChange('change', 'late-native-event.txt');
      t.mock.timers.tick(60_000);
      assert.equal(timers.size, 0, 'late callbacks cannot schedule more timers');
      const readsAtAbort = reads;
      finish();
      await rejected;
      assert.equal(reads, readsAtAbort, 'late I/O must not start the next setup read');
      assert.equal(opened, 1);
      assert.equal(closed, 1);
      assert.equal(timers.size, 0);
    });
  }
}

for (const retirement of ['expiry', 'expiry-read-error', 'abort', 'dispose']) {
  test(`slow initialization cannot revive a lease after ${retirement}`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const scheduled = t.mock.method(globalThis, 'setTimeout');
    let finish;
    let opened = 0;
    let closed = 0;
    t.mock.method(fsp, 'stat', () => new Promise((resolve, reject) => {
      finish = () => retirement === 'expiry-read-error'
        ? reject(new Error('late filesystem failure')) : resolve({ isFile: () => false });
    }));
    t.mock.method(fsp, 'readFile', async () => { throw new Error('no commondir'); });
    t.mock.method(fs, 'watch', () => {
      opened++;
      const watcher = new EventEmitter();
      watcher.close = () => { closed++; };
      return watcher;
    });
    syncBuiltinESMExports();
    const watches = new GitChangeWatches();
    t.after(() => { watches.dispose(); t.mock.restoreAll(); syncBuiltinESMExports(); });
    const controller = new AbortController();
    const starting = watches.start('/slow-checkout', controller.signal);
    const rejected = assert.rejects(starting, retirement === 'abort' ? { name: 'AbortError' }
      : retirement === 'dispose' ? /disposed/ : /expired/);
    assert.equal(opened, 1, 'the root watcher exists while metadata initialization is pending');
    if (retirement.startsWith('expiry')) {
      t.mock.timers.tick(15_000);
      assert.equal(closed, 1, 'expiry releases the initial watcher before initialization resumes');
    } else if (retirement === 'abort') controller.abort();
    else watches.dispose();
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0,
      'retirement must detach setup cancellation even while I/O remains pending');
    const timersBeforeResume = scheduled.mock.callCount();
    finish();
    await rejected;
    assert.equal(opened, 1, 'late setup must not register more watchers');
    assert.equal(closed, 1);
    assert.equal(scheduled.mock.callCount(), timersBeforeResume,
      'late setup must not schedule an unowned startup timer or renew an expired lease');
    watches.dispose();
    t.mock.timers.tick(60_000);
    assert.equal(scheduled.mock.callCount(), timersBeforeResume);
  });
}

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
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0,
    'successful setup must detach its temporary cancellation listener');
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
