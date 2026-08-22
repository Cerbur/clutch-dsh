import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorktreeMove } from '../lib/client/worktree-view.js';

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
});
