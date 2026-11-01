import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorktreeCleanupFlow } from '../lib/client/surface/actions/worktree-cleanup-flow.js';

test('committed cleanup refreshes without invoking legacy permission normalization', async () => {
  const calls = [];
  const failure = new Error('permission offline');
  await runWorktreeCleanupFlow({
    clean: async () => {
      calls.push('clean');
    },
    onCommitted: () => {
      calls.push('committed');
    },
    refresh: async () => {
      calls.push('refresh');
    },
    normalize: async () => {
      calls.push('permission');
      throw failure;
    },
    isCurrent: () => true,
    onFollowUpError: (stage, error) => {
      assert.equal(error, failure);
      calls.push(stage + '-error');
    },
  });
  assert.equal(calls.filter((call) => call === 'clean').length, 1);
  assert.ok(calls.indexOf('committed') < calls.indexOf('refresh'));
  assert.deepEqual(calls, ['clean', 'committed', 'refresh']);
});

test('clean rejection does not call onCommitted, refresh, or normalize', async () => {
  const calls = [];
  const cleanError = new Error('clean failed');
  await assert.rejects(
    runWorktreeCleanupFlow({
      clean: async () => {
        calls.push('clean');
        throw cleanError;
      },
      onCommitted: () => {
        calls.push('committed');
      },
      refresh: async () => {
        calls.push('refresh');
      },
      normalize: async () => {
        calls.push('normalize');
      },
      isCurrent: () => true,
      onFollowUpError: (stage) => {
        calls.push(stage + '-error');
      },
    }),
    cleanError,
  );
  assert.deepEqual(calls, ['clean']);
});

test('refresh failure reports the error without changing permissions or replaying cleanup', async () => {
  const calls = [];
  const refreshError = new Error('refresh failed');
  await runWorktreeCleanupFlow({
    clean: async () => {
      calls.push('clean');
    },
    onCommitted: () => {
      calls.push('committed');
    },
    refresh: async () => {
      calls.push('refresh');
      throw refreshError;
    },
    normalize: async () => {
      calls.push('normalize');
    },
    isCurrent: () => true,
    onFollowUpError: (stage, error) => {
      if (stage === 'refresh') assert.equal(error, refreshError);
      calls.push(stage + '-error');
    },
  });
  assert.ok(calls.includes('refresh-error'));
  assert.deepEqual(calls, ['clean', 'committed', 'refresh', 'refresh-error']);
});

test('stale or forgotten worktree stops follow-up operations and error reporting', async () => {
  const calls = [];
  let current = true;
  await runWorktreeCleanupFlow({
    clean: async () => {
      calls.push('clean');
      current = false; // worktree was forgotten or unmounted during clean
    },
    onCommitted: () => {
      calls.push('committed');
    },
    refresh: async () => {
      calls.push('refresh');
    },
    normalize: async () => {
      calls.push('normalize');
    },
    isCurrent: () => current,
    onFollowUpError: (stage) => {
      calls.push(stage + '-error');
    },
  });
  assert.deepEqual(calls, ['clean']);
});
test('late refresh failure after forget does not publish an error or revive state', async () => {
  let isCurrent = true;
  let noticePublished = false;
  let rejectRefresh, started;
  const refreshing = new Promise((resolve) => { started = resolve; });

  const flowPromise = runWorktreeCleanupFlow({
    clean: async () => {},
    onCommitted: () => {},
    refresh: async () => {
      started();
      await new Promise((_resolve, reject) => { rejectRefresh = reject; });
    },
    isCurrent: () => isCurrent,
    onFollowUpError: () => { noticePublished = true; },
  });

  await refreshing;
  // User forgets worktree while refresh is still in-flight.
  isCurrent = false;
  rejectRefresh(new Error('stale read'));
  await flowPromise;

  assert.equal(noticePublished, false);
});
