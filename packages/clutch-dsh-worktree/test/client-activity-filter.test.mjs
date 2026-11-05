import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';

import {
  ACTIVITY_WINDOWS,
  DEFAULT_ACTIVITY_WINDOW,
  DEFAULT_ACTIVITY_WINDOWS,
  activityCandidateSessionIds,
  activityWindowSince,
  countSessionsInWindow,
  effectiveActivityWindow,
  effectiveActivityWindows,
  filterSessionIdsByActivity,
  isActivityWindowId,
  isSessionActiveInWindow,
  nextActivityWindow,
  startOfLocalDay,
  toggleActivityWindow,
} from '../lib/client/view/activity-filter.js';
import { createWorktreeViewStore } from '../lib/client/view/view-mode-store.js';

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

test('the visible-range preference guards corruption and never becomes empty', () => {
  assert.deepEqual(DEFAULT_ACTIVITY_WINDOWS, ACTIVITY_WINDOWS);
  // Fresh profiles and older persisted payloads without the field show every tab.
  assert.deepEqual(effectiveActivityWindows(undefined), ACTIVITY_WINDOWS);
  assert.deepEqual(effectiveActivityWindows(null), ACTIVITY_WINDOWS);
  assert.deepEqual(effectiveActivityWindows([]), ACTIVITY_WINDOWS);
  assert.deepEqual(effectiveActivityWindows(['yesterday', 7]), ACTIVITY_WINDOWS);
  // Valid entries are de-duplicated and restored to selector order.
  assert.deepEqual(effectiveActivityWindows(['all', 'today', 'today']), ['today', 'all']);
  assert.deepEqual(effectiveActivityWindows(['last7d']), ['last7d']);
});

test('toggling a range keeps the remaining tabs ordered and refuses an empty set', () => {
  assert.deepEqual(toggleActivityWindow(ACTIVITY_WINDOWS, 'last24h', false), [
    'today',
    'last7d',
    'all',
  ]);
  assert.deepEqual(toggleActivityWindow(['today', 'all'], 'last7d', true), [
    'today',
    'last7d',
    'all',
  ]);
  // Re-showing an already visible range and hiding the last one are no-ops.
  assert.equal(toggleActivityWindow(ACTIVITY_WINDOWS, 'today', true), ACTIVITY_WINDOWS);
  assert.deepEqual(toggleActivityWindow(['all'], 'all', false), ['all']);
});

test('hiding the selected range hands over to the next visible tab', () => {
  assert.equal(nextActivityWindow('today', ['last24h', 'last7d']), 'last24h');
  assert.equal(nextActivityWindow('last24h', ['today', 'all']), 'all');
  // Wrapping at the end keeps a bounded choice instead of forcing All.
  assert.equal(nextActivityWindow('all', ['today', 'last7d']), 'today');
  assert.equal(nextActivityWindow('last7d', ['all']), 'all');
});

test('the store updates visibility and selection atomically and never empties the bar', () => {
  const instance = createWorktreeViewStore().create();
  const snapshot = () => instance.getSnapshot();
  assert.deepEqual(snapshot().activityWindows, ACTIVITY_WINDOWS);

  instance.actions.setActivityWindow('today');
  instance.actions.setActivityWindowVisible('today', false);
  assert.deepEqual(snapshot().activityWindows, ['last24h', 'last7d', 'all']);
  // Hiding the selected tab hands the selection to the next visible range.
  assert.equal(snapshot().activityWindow, 'last24h');

  instance.actions.setActivityWindowVisible('last24h', false);
  instance.actions.setActivityWindowVisible('last7d', false);
  assert.deepEqual(snapshot().activityWindows, ['all']);
  assert.equal(snapshot().activityWindow, 'all');

  // The final range stays visible even if its checkbox is forced off.
  instance.actions.setActivityWindowVisible('all', false);
  assert.deepEqual(snapshot().activityWindows, ['all']);
  assert.equal(snapshot().activityWindow, 'all');

  // Inactive structure is kept by default and can be hidden on request.
  assert.equal(snapshot().showInactiveStructure, true);
  instance.actions.setShowInactiveStructure(false);
  assert.equal(snapshot().showInactiveStructure, false);
  instance.actions.setShowInactiveStructure(true);
  assert.equal(snapshot().showInactiveStructure, true);
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
    '@deepseek-ai/dsh-client-ui-primitives': {
      Menu: function Menu() {
        return null;
      },
    },
    '../../dsh-icons.js': {
      IconCheckOutline16: () => null,
      IconSlidersTwoOutline16: () => null,
    },
    '../../worktree.css': { default: styles },
    '../shared.js': { cx: (...names) => names.filter(Boolean).join(' ') },
  };
  const exports = {};
  new Function('require', 'exports', output)((name) => dependencies[name], exports);
  return exports.ActivityFilterBar;
}

function barProps(window, counts, setWindow, options = {}) {
  const visible = options.visible ?? ACTIVITY_WINDOWS;
  const visibility = [];
  return {
    t: (key, params) => (params === undefined ? key : key + JSON.stringify(params)),
    activity: {
      window,
      active: window !== 'all',
      now: 0,
      setWindow,
      visibleWindows: visible,
      isWindowVisible: (candidate) => visible.includes(candidate),
      setWindowVisible: (candidate, next) => {
        visibility.push([candidate, next]);
        options.setWindowVisible?.(candidate, next);
      },
      menuOpen: options.menuOpen ?? false,
      setMenuOpen: (open) => {
        options.setMenuOpen?.(open);
      },
      showInactiveStructure: options.showInactiveStructure ?? true,
      setShowInactiveStructure: (next) => {
        options.setShowInactiveStructure?.(next);
      },
      isActive: () => true,
      scopeSessionIds: (sessionIds) => sessionIds,
      hasActiveSession: (sessionIds) => sessionIds.length > 0,
      count: (candidate) => counts[candidate] ?? 0,
    },
    visibility,
  };
}

test('the range bar exposes one pressed segment per range and routes the choice', async () => {
  const ActivityFilterBar = await loadFilterBar();
  const chosen = [];
  const counts = { today: 2, last24h: 4, last7d: 6, all: 9 };
  const props = barProps('last24h', counts, (window) => chosen.push(window));
  const element = ActivityFilterBar(props);

  assert.equal(element.type, 'div');
  const tabs = element.props.children[0];
  assert.equal(tabs.type, 'div');
  assert.equal(tabs.props.role, 'group');
  const segments = tabs.props.children;
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
  const segments = element.props.children[0].props.children;

  for (const segment of segments) {
    // A zero count renders nothing (JSX keeps a `false` child), never an empty badge.
    const badge = segment.props.children[1];
    assert.ok(!badge);
    assert.equal(segment.props['aria-label'].includes('"count":0'), true);
  }
  segments[0].props.onClick();
  assert.deepEqual(chosen, ['today']);
});

test('only checked ranges render as tabs', async () => {
  const ActivityFilterBar = await loadFilterBar();
  const counts = { today: 2, last24h: 4, last7d: 6, all: 9 };
  const element = ActivityFilterBar(
    barProps('all', counts, () => {}, { visible: ['today', 'all'] }),
  );
  const segments = element.props.children[0].props.children;
  assert.deepEqual(
    segments.map((segment) => segment.props['data-activity-window']),
    ['today', 'all'],
  );
});

test('the right-edge menu toggles visible ranges and keeps the last one checked', async () => {
  const ActivityFilterBar = await loadFilterBar();
  const counts = { today: 2, last24h: 4, last7d: 6, all: 9 };
  const menuState = [];
  const props = barProps('today', counts, () => {}, {
    visible: ['today', 'all'],
    setMenuOpen: (open) => menuState.push(open),
  });
  const element = ActivityFilterBar(props);
  const menu = element.props.children[1];
  const trigger = menu.props.anchor;

  assert.deepEqual(menu.props.items, [
    { type: 'label', id: 'visible-filters', text: 'filter.visible' },
  ]);
  assert.equal(trigger.props['data-activity-config'], true);
  assert.equal(trigger.props['aria-haspopup'], 'menu');
  assert.equal(trigger.props['aria-expanded'], false);
  assert.equal(trigger.props['aria-label'], 'filter.choose');
  trigger.props.onClick();
  assert.deepEqual(menuState, [true]);

  const options = menu.props.children
    .flat()
    .filter((option) => option.props['data-activity-option'] !== undefined);
  assert.deepEqual(
    options.map((option) => option.props['data-activity-option']),
    ['today', 'last24h', 'last7d', 'all'],
  );
  assert.deepEqual(
    options.map((option) => option.props['aria-checked']),
    [true, false, false, true],
  );
  // Rows outside the visible set stay actionable so they can be re-shown.
  assert.deepEqual(
    options.map((option) => option.props.disabled),
    [false, false, false, false],
  );
  assert.equal(
    options[0].props['aria-label'],
    'filter.count{"label":"filter.today","count":2}',
  );

  options[1].props.onClick();
  options[0].props.onClick();
  assert.deepEqual(props.visibility, [
    ['last24h', true],
    ['today', false],
  ]);
});

test('the only remaining range cannot be unchecked', async () => {
  const ActivityFilterBar = await loadFilterBar();
  const element = ActivityFilterBar(
    barProps('today', { today: 1, last24h: 0, last7d: 0, all: 1 }, () => {}, {
      visible: ['today'],
    }),
  );
  const options = element.props.children[1].props.children
    .flat()
    .filter((option) => option.props['data-activity-option'] !== undefined);
  assert.deepEqual(
    options.map((option) => option.props.disabled),
    [true, false, false, false],
  );
  assert.equal(options[0].props.title, 'filter.keepOne');
});


test('the range can hide inactive structure when its default preference is turned off', async () => {
  const readSurface = (file) =>
    readFile(new URL(`../src/client/surface/components/${file}`, import.meta.url), 'utf8');
  const tree = await readSurface('WorkspaceTree.tsx');

  // Turning off showInactiveStructure hides a Workspace/Worktree with no in-range
  // Session; the default keeps structure and management actions.
  assert.match(tree, /activity\.showInactiveStructure/);
  assert.match(tree, /worktreeSurvivesWindow/);
  assert.match(tree, /activity\.hasActiveSession/);
  assert.match(tree, /filter\.empty/);
  assert.match(tree, /activity\.scopeSessionIds/);

  for (const file of ['ActiveWorktree.tsx', 'ArchivedWorktree.tsx']) {
    const source = await readSurface(file);
    assert.match(
      source,
      /activity\.active\s*&&\s*!activity\.showInactiveStructure\s*&&\s*worktreeSessionIds\.length === 0/,
    );
    assert.match(source, /activity\.scopeSessionIds/);
  }
});

test('the range menu can keep inactive Workspace structure', async () => {
  const ActivityFilterBar = await loadFilterBar();
  const changes = [];
  const element = ActivityFilterBar(
    barProps('today', { today: 1, last24h: 0, last7d: 0, all: 1 }, () => {}, {
      showInactiveStructure: true,
      setShowInactiveStructure: (next) => changes.push(next),
    }),
  );
  const toggle = element.props.children[1].props.children
    .flat()
    .find((child) => child.props['data-activity-keep-inactive'] !== undefined);

  assert.equal(toggle.props['aria-checked'], true);
  assert.equal(toggle.props['aria-label'], 'filter.keepInactive');
  assert.equal(toggle.props.title, 'filter.keepInactiveHint');
  toggle.props.onClick();
  assert.deepEqual(changes, [false]);
});
