import assert from 'node:assert/strict';
import test from 'node:test';
import { createDshWorktreeActivityReader } from '../lib/host/worktree-activity.js';

test('incomplete activity coverage is unknown, not idle', async () => {
  const read = createDshWorktreeActivityReader({
    snapshot: async () => ({ complete: false, busySessionIds: [] }),
  });
  assert.deepEqual(await read(['s1']), { state: 'unknown' });
});

test('running child blocks its bound parent', async () => {
  const read = createDshWorktreeActivityReader({
    snapshot: async (ids) => {
      assert.deepEqual(ids, ['s1']);
      return { complete: true, busySessionIds: ['child1'] };
    },
  });
  assert.deepEqual(await read(['s1']), { state: 'busy', sessionIds: ['child1'] });
});

test('empty session list is idle even without source', async () => {
  const read = createDshWorktreeActivityReader(undefined);
  assert.deepEqual(await read([]), { state: 'idle' });
});

test('missing source with sessions is unknown', async () => {
  const read = createDshWorktreeActivityReader(undefined);
  assert.deepEqual(await read(['s1']), { state: 'unknown' });
});

test('throwing source resolves to unknown', async () => {
  const read = createDshWorktreeActivityReader({
    snapshot: async () => {
      throw new Error('boom');
    },
  });
  assert.deepEqual(await read(['s1']), { state: 'unknown' });
});

test('disposed reader returns unknown instead of idle', async () => {
  let disposed = false;
  const read = createDshWorktreeActivityReader(
    {
      snapshot: async () => ({ complete: true, busySessionIds: [] }),
    },
    { isDisposed: () => disposed },
  );
  assert.deepEqual(await read(['s1']), { state: 'idle' });
  disposed = true;
  assert.deepEqual(await read(['s1']), { state: 'unknown' });
});
