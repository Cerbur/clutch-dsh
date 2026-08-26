import assert from 'node:assert/strict';
import test from 'node:test';

import { scrollCurrentSessionIntoView } from '../lib/client/worktree-session-position.js';

function fakeRow(sessionId, calls) {
  return {
    dataset: { sessionId },
    scrollIntoView(options) {
      calls.push({ sessionId, options });
    },
  };
}

function fakeRoot(rows) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, '[data-session-id]');
      return rows;
    },
  };
}

test('scrolls only the matching row inside the supplied Worktree root', () => {
  const calls = [];
  const root = fakeRoot([
    fakeRow('other', calls),
    fakeRow('current', calls),
  ]);

  assert.equal(scrollCurrentSessionIntoView(root, 'current'), true);
  assert.deepEqual(calls, [
    { sessionId: 'current', options: { block: 'nearest' } },
  ]);
});

test('does not scroll when the current row is not rendered', () => {
  const calls = [];
  assert.equal(
    scrollCurrentSessionIntoView(fakeRoot([fakeRow('other', calls)]), 'missing'),
    false,
  );
  assert.deepEqual(calls, []);
});
