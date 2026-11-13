import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { WorktreeToolChanges } from '../lib/host/worktree-tool-changes.js';
import { createWorktreeToolChangeMonitor } from '../lib/client/worktree-tool-changes.js';
import { createWorktreeConnectionAdapter } from '../lib/client/worktree-connection.js';

test('idle notification polls expire before Desktop admission, release resources, and retain later changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const feed = new WorktreeToolChanges();
  const controller = new globalThis.AbortController();
  const added = t.mock.method(controller.signal, 'addEventListener');
  const removed = t.mock.method(controller.signal, 'removeEventListener');
  let settled = false;
  const pending = feed.watch(0, controller.signal).then((batch) => { settled = true; return batch; });
  t.mock.timers.tick(4999);
  await setImmediate();
  assert.equal(settled, false, 'idle reads should still wait for pushed changes');
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { revision: 0, changes: [] });
  assert.equal(feed.waiters.size, 0);
  assert.equal(added.mock.callCount(), removed.mock.callCount());
  feed.changed('ws', 'wt');
  assert.deepEqual(await feed.watch(0, controller.signal), {
    revision: 1, changes: [{ workspaceId: 'ws', worktreeId: 'wt' }],
  });
  const cancelled = feed.watch(1, controller.signal);
  controller.abort(new Error('request failed'));
  await assert.rejects(cancelled, /request failed/);
  assert.equal(feed.waiters.size, 0);
  assert.equal(added.mock.callCount(), removed.mock.callCount());
  const closing = feed.watch(1, new globalThis.AbortController().signal);
  feed.dispose();
  await assert.rejects(closing, /disposed/);
  assert.equal(feed.waiters.size, 0);
  t.mock.timers.tick(20000);
});

test('change feed coalesces one Workspace, wakes readers, and closes cancelled/disposed waits', async () => {
  const feed = new WorktreeToolChanges();
  const signal = new globalThis.AbortController().signal;
  const pending = feed.watch(0, signal);
  feed.changed('a', 'wt-1');
  assert.deepEqual(await pending, {
    revision: 1,
    changes: [{ workspaceId: 'a', worktreeId: 'wt-1' }],
  });
  feed.changed('a', 'wt-2');
  feed.changed('b', 'wt-3');
  assert.deepEqual(await feed.watch(1, signal), {
    revision: 3,
    changes: [
      { workspaceId: 'a', worktreeId: 'wt-2' },
      { workspaceId: 'b', worktreeId: 'wt-3' },
    ],
  });
  const cancellation = new globalThis.AbortController();
  const aborted = feed.watch(3, cancellation.signal);
  cancellation.abort(new Error('cancelled'));
  await assert.rejects(aborted, /cancelled/);
  const closing = feed.watch(3, signal);
  feed.dispose();
  await assert.rejects(closing, /disposed/);
  await assert.rejects(feed.watch(-1, signal), /Invalid revision/);
});

test('monitor invalidates before notifying, advances its cursor, shares one poll, and aborts on disposal', async () => {
  const feed = new WorktreeToolChanges();
  const calls = [];
  const scopes = [];
  const monitor = createWorktreeToolChangeMonitor({
    read: (revision, signal) => {
      calls.push({ revision, signal });
      return feed.watch(revision, signal);
    },
    changed: ({ workspaceId }) => scopes.push(['invalidate', workspaceId]),
  });
  monitor.subscribe(({ workspaceId }) => scopes.push(['surface', workspaceId]));
  monitor.start();
  monitor.start();
  feed.changed('target', 'wt');
  await setImmediate();
  assert.deepEqual(scopes, [
    ['invalidate', 'target'],
    ['surface', 'target'],
  ]);
  assert.deepEqual(
    calls.map(({ revision }) => revision),
    [0, 1],
  );
  monitor.dispose();
  await setImmediate();
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(calls.length, 2);
  feed.dispose();
});

test('watch request uses the existing /api adapter and forwards cancellation through the Gateway boundary', async () => {
  const calls = [];
  const adapter = createWorktreeConnectionAdapter({
    async call(...args) {
      calls.push(args);
      return {
        ok: true,
        value: { ok: true, value: { revision: 4, changes: [] } },
      };
    },
  });
  const controller = new globalThis.AbortController();
  assert.deepEqual(await adapter.watchToolChanges(3, controller.signal), {
    revision: 4,
    changes: [],
  });
  assert.deepEqual(calls[0].slice(0, 3), [
    '/api',
    'worktreeManager/watchToolChanges',
    { args: { input: { afterRevision: 3 } } },
  ]);
  adapter.dispose();
});

test('connection reset retires the old poll and reads a new Host from revision zero', async () => {
  const first = new WorktreeToolChanges();
  const next = new WorktreeToolChanges();
  const calls = [];
  const seen = [];
  let feed = first;
  const monitor = createWorktreeToolChangeMonitor({
    read: (revision, signal) => {
      calls.push({ revision, signal });
      return feed.watch(revision, signal);
    },
    changed: (change) => seen.push(change.workspaceId),
  });
  monitor.start();
  first.changed('old', 'wt-old');
  await setImmediate();
  feed = next;
  next.changed('new', 'wt-new');
  monitor.reset();
  await setImmediate();
  assert.deepEqual(seen, ['old', 'new']);
  assert.equal(calls[1].signal.aborted, true);
  assert.equal(calls[2].revision, 0);
  monitor.dispose();
  first.dispose();
  next.dispose();
});
