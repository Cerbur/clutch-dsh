import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

import {
  ACTIVITY_WINDOWS,
  DEFAULT_ACTIVITY_WINDOW,
  activityCandidateSessionIds,
  activityWindowSince,
  countSessionsInWindow,
  effectiveActivityWindow,
  filterSessionIdsByActivity,
  isActivityWindowId,
  isSessionActiveInWindow,
  startOfLocalDay,
} from '../lib/client/view/activity-filter.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;

function presentation({ updatedAt, ongoing = false, warning = false } = {}) {
  return {
    status: {
      state: warning ? 'warning' : ongoing ? 'ongoing' : 'done',
      labelKey: warning ? 'waitingApproval' : ongoing ? 'running' : 'idle',
      runningSubagentCount: 0,
    },
    running: ongoing,
    ongoing,
    runningSubagentCount: 0,
    completed: false,
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function scopeOf({ byId = {}, presentations = {}, currentSessionId } = {}) {
  return {
    sessions: { byId },
    sessionPresentations: presentations,
    ...(currentSessionId === undefined ? {} : { currentSessionId }),
  };
}

test('bounded windows use local calendar and rolling bounds', () => {
  const now = new Date(2026, 10, 3, 15, 30, 0, 0).getTime();
  assert.equal(activityWindowSince('all', now), undefined);
  assert.equal(activityWindowSince('last24h', now), now - DAY);
  assert.equal(activityWindowSince('last7d', now), now - 7 * DAY);
  const today = activityWindowSince('today', now);
  assert.equal(today, startOfLocalDay(now));
  const start = new Date(today);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
  assert.equal(start.getMilliseconds(), 0);
  assert.equal(start.getDate(), 3);
  assert.equal(start.getMonth(), 10);
});

test('an unreadable clock disables the bound instead of hiding every row', () => {
  assert.equal(activityWindowSince('today', Number.NaN), undefined);
  assert.equal(activityWindowSince('last7d', Number.NaN), undefined);
});

test('persisted values are guarded before they scope a visible tree', () => {
  assert.equal(DEFAULT_ACTIVITY_WINDOW, 'all');
  for (const window of ACTIVITY_WINDOWS) {
    assert.equal(isActivityWindowId(window), true);
    assert.equal(effectiveActivityWindow(window), window);
  }
  // Values written by an older Client or a corrupted store fall back to All.
  assert.equal(effectiveActivityWindow(undefined), 'all');
  assert.equal(effectiveActivityWindow('yesterday'), 'all');
  assert.equal(effectiveActivityWindow(7), 'all');
  assert.equal(effectiveActivityWindow(null), 'all');
});

test('all keeps every Session, including rows without activity facts', () => {
  const scope = scopeOf({ byId: { idle: {} } });
  assert.equal(isSessionActiveInWindow('idle', 'all', Date.now(), scope), true);
  assert.equal(isSessionActiveInWindow('missing', 'all', Date.now(), scope), true);
});

test('updatedAt inside the window is inclusive at the lower bound', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0, 0).getTime();
  const scope = scopeOf({
    byId: { edge: {}, inside: {}, outside: {} },
    presentations: {
      edge: presentation({ updatedAt: now - DAY }),
      inside: presentation({ updatedAt: now - HOUR }),
      outside: presentation({ updatedAt: now - DAY - 1 }),
    },
  });
  assert.equal(isSessionActiveInWindow('edge', 'last24h', now, scope), true);
  assert.equal(isSessionActiveInWindow('inside', 'last24h', now, scope), true);
  assert.equal(isSessionActiveInWindow('outside', 'last24h', now, scope), false);
  assert.equal(isSessionActiveInWindow('edge', 'last7d', now, scope), true);
});

test('running and pending-interaction Sessions stay active with a stale timestamp', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0, 0).getTime();
  const stale = now - 30 * DAY;
  const scope = scopeOf({
    byId: { running: {}, waiting: {}, done: {} },
    presentations: {
      running: presentation({ updatedAt: stale, ongoing: true }),
      waiting: presentation({ updatedAt: stale, warning: true }),
      done: presentation({ updatedAt: stale }),
    },
  });
  assert.equal(isSessionActiveInWindow('running', 'today', now, scope), true);
  assert.equal(isSessionActiveInWindow('waiting', 'today', now, scope), true);
  assert.equal(isSessionActiveInWindow('done', 'today', now, scope), false);
});

test('the selected Session stays visible in every range', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0, 0).getTime();
  const scope = scopeOf({
    byId: { current: {}, other: {} },
    presentations: {
      current: presentation({ updatedAt: now - 90 * DAY }),
      other: presentation({ updatedAt: now - 90 * DAY }),
    },
    currentSessionId: 'current',
  });
  assert.equal(isSessionActiveInWindow('current', 'today', now, scope), true);
  assert.equal(isSessionActiveInWindow('other', 'today', now, scope), false);
});

test('the Session summary is the fallback when the presentation omits updatedAt', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0, 0).getTime();
  const scope = scopeOf({
    byId: { summaryOnly: { updatedAt: now - HOUR } },
    presentations: { summaryOnly: presentation() },
  });
  assert.equal(isSessionActiveInWindow('summaryOnly', 'last24h', now, scope), true);
  const missing = scopeOf({ byId: { untouched: {} }, presentations: {} });
  assert.equal(isSessionActiveInWindow('untouched', 'last24h', now, missing), false);
});

test('filtering preserves source order and returns the input for All', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0, 0).getTime();
  const ids = ['b', 'a', 'c'];
  const scope = scopeOf({
    byId: { a: {}, b: {}, c: {} },
    presentations: {
      a: presentation({ updatedAt: now - 10 * DAY }),
      b: presentation({ updatedAt: now - DAY }),
      c: presentation({ updatedAt: now - 2 * HOUR }),
    },
  });
  assert.deepEqual(filterSessionIdsByActivity(ids, 'last24h', now, scope), ['b', 'c']);
  assert.deepEqual(filterSessionIdsByActivity(ids, 'last7d', now, scope), ['b', 'c']);
  assert.deepEqual(filterSessionIdsByActivity(ids, 'all', now, scope), ids);
});

test('candidate Sessions exclude archived and blank rows', () => {
  const source = {
    ids: ['live', 'blank', 'archived'],
    byId: { live: {}, blank: { blank: true }, archived: {} },
  };
  assert.deepEqual(activityCandidateSessionIds(source, ['archived']), ['live']);
  assert.deepEqual(activityCandidateSessionIds(source, []), ['live', 'archived']);
});

test('range counts follow the same predicate as the tree', () => {
  const now = new Date(2026, 10, 3, 12, 0, 0, 0).getTime();
  const source = {
    ids: ['recent', 'midweek', 'old', 'blank', 'archived'],
    byId: { recent: {}, midweek: {}, old: {}, blank: { blank: true }, archived: {} },
  };
  const scope = scopeOf({
    byId: source.byId,
    presentations: {
      recent: presentation({ updatedAt: now - HOUR }),
      midweek: presentation({ updatedAt: now - 2 * DAY }),
      old: presentation({ updatedAt: now - 20 * DAY }),
      archived: presentation({ updatedAt: now - HOUR }),
    },
    currentSessionId: 'old',
  });
  const candidates = activityCandidateSessionIds(source, ['archived']);
  assert.deepEqual(candidates, ['recent', 'midweek', 'old']);
  assert.equal(countSessionsInWindow(candidates, 'all', now, scope), 3);
  assert.equal(countSessionsInWindow(candidates, 'today', now, scope), 2);
  assert.equal(countSessionsInWindow(candidates, 'last24h', now, scope), 2);
  assert.equal(countSessionsInWindow(candidates, 'last7d', now, scope), 3);
});

async function loadFilterBar() {
  const source = await readFile(
    new URL('../src/client/surface/components/ActivityFilterBar.tsx', import.meta.url),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const styles = new Proxy({}, { get: (_target, name) => String(name) });
  const dependencies = {
    'react/jsx-runtime': jsxRuntime,
    '../../worktree.css': { default: styles },
    '../shared.js': { cx: (...names) => names.filter(Boolean).join(' ') },
  };
  const exports = {};
  new Function('require', 'exports', output)((name) => dependencies[name], exports);
  return exports.ActivityFilterBar;
}

function barProps(window, counts, setWindow) {
  return {
    t: (key, params) => (params === undefined ? key : key + JSON.stringify(params)),
    activity: {
      window,
      active: window !== 'all',
      now: 0,
      setWindow,
      isActive: () => true,
      scopeSessionIds: (sessionIds) => sessionIds,
      hasActiveSession: (sessionIds) => sessionIds.length > 0,
      count: (candidate) => counts[candidate] ?? 0,
    },
  };
}

test('the range bar exposes one pressed segment per range and routes the choice', async () => {
  const ActivityFilterBar = await loadFilterBar();
  const chosen = [];
  const counts = { today: 2, last24h: 4, last7d: 6, all: 9 };
  const element = ActivityFilterBar(
    barProps('last24h', counts, (window) => chosen.push(window)),
  );

  assert.equal(element.type, 'div');
  assert.equal(element.props.role, 'group');
  const segments = element.props.children;
  assert.deepEqual(
    segments.map((segment) => segment.props['data-activity-window']),
    ['today', 'last24h', 'last7d', 'all'],
  );
  assert.deepEqual(
    segments.map((segment) => segment.props['aria-pressed']),
    [false, true, false, false],
  );
  // Each segment carries the localized range plus its own count in the accessible name.
  assert.equal(
    segments[0].props['aria-label'],
    'filter.count{"label":"filter.today","count":2}',
  );

  for (const segment of segments) segment.props.onClick();
  assert.deepEqual(chosen, ['today', 'last24h', 'last7d', 'all']);
});

test('an empty range renders no count badge but keeps the segment operable', async () => {
  const ActivityFilterBar = await loadFilterBar();
  const chosen = [];
  const element = ActivityFilterBar(barProps('today', { today: 0, all: 0 }, (w) => chosen.push(w)));
  const segments = element.props.children;

  for (const segment of segments) {
    // A zero count renders nothing (JSX keeps a `false` child), never an empty badge.
    const badge = segment.props.children[1];
    assert.ok(!badge);
    assert.equal(segment.props['aria-label'].includes('"count":0'), true);
  }
  segments[0].props.onClick();
  assert.deepEqual(chosen, ['today']);
});

