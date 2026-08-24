import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterVisibleSessionIds,
  isBlankSession,
  sessionDisplayLabel,
  sessionMatchesQuery,
} from '../lib/client/session-view.js';

function sessions(overrides = {}) {
  return {
    ids: ['current-blank', 'stale-blank', 'normal', 'untitled'],
    current: 'current-blank',
    byId: {
      'current-blank': { blank: true, displayTitle: 'generated-current-id' },
      'stale-blank': { blank: true, displayTitle: 'generated-stale-id' },
      normal: { blank: false, displayTitle: 'Research notes' },
      untitled: { blank: false },
    },
    ...overrides,
  };
}

test('detects only the native blank flag', () => {
  const state = sessions();

  assert.equal(isBlankSession('current-blank', state), true);
  assert.equal(isBlankSession('normal', state), false);
  assert.equal(isBlankSession('unknown', state), false);
});

test('keeps the current blank Session and hides stale blank Sessions', () => {
  const state = sessions();

  assert.deepEqual(
    filterVisibleSessionIds(
      ['normal', 'stale-blank', 'current-blank', 'untitled'],
      state,
    ),
    ['normal', 'current-blank', 'untitled'],
  );

  assert.deepEqual(
    filterVisibleSessionIds(
      ['current-blank', 'normal'],
      sessions({ current: undefined }),
    ),
    ['normal'],
  );
});

test('uses the localized New Session label only for blank Sessions', () => {
  const state = sessions();

  assert.equal(sessionDisplayLabel('current-blank', state, 'New Session'), 'New Session');
  assert.equal(sessionDisplayLabel('normal', state, 'New Session'), 'Research notes');
  assert.equal(sessionDisplayLabel('untitled', state, 'New Session'), 'untitled');
});

test('excludes blank Sessions from title and generated-id search', () => {
  const state = sessions();

  assert.equal(sessionMatchesQuery('current-blank', state, 'new session'), false);
  assert.equal(sessionMatchesQuery('current-blank', state, 'generated-current-id'), false);
  assert.equal(sessionMatchesQuery('normal', state, 'research'), true);
  assert.equal(sessionMatchesQuery('untitled', state, 'untitled'), true);
});
