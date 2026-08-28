import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveSessionPresentationIndex,
  filterVisibleSessionIds,
  hasOngoingSession,
  isBlankSession,
  relativeTime,
  sessionStatus,
  sessionDisplayLabel,
  sessionMatchesQuery,
} from '../lib/client/session-view.js';
import { en, zh } from '../lib/client/locales.js';

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
    filterVisibleSessionIds(['normal', 'stale-blank', 'current-blank', 'untitled'], state),
    ['normal', 'current-blank', 'untitled'],
  );

  assert.deepEqual(
    filterVisibleSessionIds(['current-blank', 'normal'], sessions({ current: undefined })),
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

test('matches native relative-time buckets and ignores invalid timestamps', () => {
  const now = 365 * 86_400_000;

  assert.deepEqual(relativeTime(now, now), { unit: 'now', n: 0 });
  assert.deepEqual(relativeTime(now - 59_999, now), { unit: 'now', n: 0 });
  assert.deepEqual(relativeTime(now - 5 * 60_000, now), { unit: 'minutes', n: 5 });
  assert.deepEqual(relativeTime(now - 3 * 3_600_000, now), { unit: 'hours', n: 3 });
  assert.deepEqual(relativeTime(now - 2 * 86_400_000, now), { unit: 'days', n: 2 });
  assert.deepEqual(relativeTime(now - 60 * 86_400_000, now), { unit: 'months', n: 2 });
  assert.deepEqual(relativeTime(0, now), { unit: 'years', n: 1 });
  assert.deepEqual(relativeTime(now + 10_000, now), { unit: 'now', n: 0 });
  assert.equal(relativeTime(Number.NaN, now), undefined);
  assert.equal(relativeTime(undefined, now), undefined);
});

test('keeps native Session status priority when pending and running overlap', () => {
  assert.deepEqual(sessionStatus({ pendingInteraction: 'approval', running: true }, 2), {
    state: 'warning',
    labelKey: 'waitingApproval',
    runningSubagentCount: 2,
  });
  assert.deepEqual(sessionStatus({ running: true }, 2), {
    state: 'ongoing',
    labelKey: 'running',
    runningSubagentCount: 2,
  });
  assert.deepEqual(sessionStatus({ running: false }, 2), {
    state: 'ongoing',
    labelKey: 'subagentsRunning',
    runningSubagentCount: 2,
  });
  assert.deepEqual(sessionStatus({ completed: true }, 0), {
    state: 'done',
    labelKey: 'completed',
    runningSubagentCount: 0,
  });
  assert.deepEqual(sessionStatus({}, 0), {
    state: 'done',
    labelKey: 'idle',
    runningSubagentCount: 0,
  });
});

test('derives native subagent activity from parentId and origin', () => {
  const state = {
    byId: {
      parent: { displayTitle: 'Parent', running: false, updatedAt: 10 },
      child: {
        displayTitle: 'Child',
        parentId: 'parent',
        origin: 'subagent',
        running: true,
        updatedAt: 20,
      },
      fork: {
        displayTitle: 'Fork',
        parentId: 'parent',
        running: true,
        updatedAt: 30,
      },
    },
  };

  const index = deriveSessionPresentationIndex(state);

  assert.equal(index.parent?.ongoing, true);
  assert.equal(index.parent?.runningSubagentCount, 1);
  assert.equal(index.parent?.status.labelKey, 'subagentsRunning');
  assert.equal(index.fork?.runningSubagentCount, 0);
  assert.equal(index.fork?.status.labelKey, 'running');
});

test('aggregates ongoing activity from complete group membership', () => {
  const presentations = {
    running: { ongoing: true },
    pendingRunning: { ongoing: true },
    idle: { ongoing: false },
  };

  assert.equal(hasOngoingSession(['idle', 'running'], presentations), true);
  assert.equal(hasOngoingSession(['idle', 'pendingRunning'], presentations), true);
  assert.equal(hasOngoingSession(['idle'], presentations), false);
  assert.equal(
    hasOngoingSession(['search-hidden-running'], {
      'search-hidden-running': { ongoing: true },
    }),
    true,
  );
});

test('keeps the locale status and time labels synchronized', () => {
  const keys = [
    'session.status.running',
    'session.status.subagentsRunning.one',
    'session.status.subagentsRunning.other',
    'session.status.idle',
    'session.status.waitingApproval',
    'session.status.planReview',
    'session.status.waitingAnswer',
    'session.status.completed',
    'session.time.now',
    'session.time.minutes',
    'session.time.hours',
    'session.time.days',
    'session.time.months',
    'session.time.years',
  ];

  for (const key of keys) {
    assert.equal(typeof zh[key], 'string', `missing zh locale key ${key}`);
    assert.equal(typeof en[key], 'string', `missing en locale key ${key}`);
  }
});
