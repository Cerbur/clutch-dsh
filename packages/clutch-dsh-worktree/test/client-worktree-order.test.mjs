import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveWorktreeMove,
  toRetryableWorktreeOrderError,
} from '../lib/client/worktree-view.js';

test('resolves a before-half drop to the target anchor', () => {
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt3', 'before'),
    { beforeWorktreeId: 'wt3' },
  );
});

test('resolves an after-half drop to the following anchor', () => {
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt2', 'after'),
    { beforeWorktreeId: 'wt3' },
  );
});

test('represents a real move after the last row with an omitted anchor', () => {
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt2', 'after'),
    { beforeWorktreeId: 'wt3' },
  );
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt2', 'wt3', 'after'),
    {},
  );
  assert.deepEqual(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt1', 'wt3', 'after'),
    {},
  );
});

test('returns undefined for missing IDs and unchanged placements', () => {
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'missing', 'wt2', 'before'), undefined);
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'wt1', 'missing', 'before'), undefined);
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'wt1', 'wt1', 'before'), undefined);
  assert.equal(resolveWorktreeMove(['wt1', 'wt2'], 'wt1', 'wt2', 'before'), undefined);
  assert.equal(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt2', 'wt1', 'after'),
    undefined,
    'dropping after the adjacent predecessor is a no-op',
  );
  assert.equal(
    resolveWorktreeMove(['wt1', 'wt2', 'wt3'], 'wt2', 'wt2', 'after'),
    undefined,
    'dropping after the source row itself is a no-op',
  );
});

test('makes Worktree ordering failures retryable without losing diagnostics', () => {
  const details = {
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    beforeWorktreeId: 'wt-missing',
    role: 'anchor',
  };

  assert.deepEqual(
    toRetryableWorktreeOrderError({
      code: 'WORKTREE_ORDER_INVALID',
      message: 'Cannot reorder before an unknown Worktree.',
      details,
      retryable: false,
    }),
    {
      code: 'WORKTREE_ORDER_INVALID',
      message: 'Cannot reorder before an unknown Worktree.',
      details,
      retryable: true,
    },
  );
});
