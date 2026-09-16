import assert from 'node:assert/strict';
import test from 'node:test';

import { scrollCurrentSessionIntoView } from '../lib/client/session/worktree-session-position.js';

function fakeRow(sessionId, calls, rect = { top: 120, bottom: 140 }) {
  return {
    dataset: { sessionId },
    getBoundingClientRect() {
      return rect;
    },
    scrollIntoView(options) {
      calls.push({ sessionId, options });
    },
  };
}

function fakeRoot(rows) {
  return {
    scrollTop: 0,
    clientHeight: 100,
    getBoundingClientRect() {
      return { top: 0, bottom: 100 };
    },
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
    fakeRow('current', calls, { top: 120, bottom: 140 }),
  ]);

  assert.equal(scrollCurrentSessionIntoView(root, 'current'), true);
  assert.equal(root.scrollTop, 40);
  assert.deepEqual(calls, []);
});

test('does not scroll when the current row is not rendered', () => {
  const calls = [];
  assert.equal(
    scrollCurrentSessionIntoView(fakeRoot([fakeRow('other', calls)]), 'missing'),
    false,
  );
  assert.deepEqual(calls, []);
});

test('keeps the navigation position when the current row is already visible', () => {
  const calls = [];
  const row = {
    ...fakeRow('current', calls),
    getBoundingClientRect() {
      return { top: 360, bottom: 390 };
    },
  };
  const root = {
    ...fakeRoot([row]),
    scrollTop: 240,
    clientHeight: 300,
    getBoundingClientRect() {
      return { top: 100, bottom: 400 };
    },
  };

  assert.equal(scrollCurrentSessionIntoView(root, 'current'), true);
  assert.equal(root.scrollTop, 240);
  assert.deepEqual(calls, []);
});
