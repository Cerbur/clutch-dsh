import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_NS,
  en,
  zh,
} from '../lib/client/locales.js';

test('exports the Worktree namespace and balanced zh/en dictionaries', () => {
  assert.equal(WORKTREE_NS, 'worktree');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.ok(Object.keys(zh).length >= 60);
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string', 'zh.' + key + ' must be a string');
    assert.ok(value.length > 0, 'zh.' + key + ' must not be empty');
    assert.equal(typeof en[key], 'string', 'en.' + key + ' must be a string');
    assert.ok(en[key].length > 0, 'en.' + key + ' must not be empty');
  }
});

test('keeps parameter placeholders in the translated templates', () => {
  assert.match(zh['workspace.options'], /\{name\}/);
  assert.match(en['workspace.options'], /\{name\}/);
  assert.match(zh['session.expandMore'], /\{count\}/);
  assert.match(en['session.expandMore'], /\{count\}/);
  assert.match(zh['error.sessionBindingFailed'], /\{sessionId\}/);
  assert.match(zh['error.sessionBindingFailed'], /\{reason\}/);
  assert.match(en['error.sessionBindingFailed'], /\{sessionId\}/);
  assert.match(en['error.sessionBindingFailed'], /\{reason\}/);
});
