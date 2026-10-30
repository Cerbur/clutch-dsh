import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { JSDOM } from 'jsdom';
import ts from 'typescript';
import * as activity from '../lib/client/session/active-sessions.js';
import * as sessionView from '../lib/client/session/session-view.js';
import * as labels from '../lib/client/session/session-labels.js';
import { nativeStatusFixture } from './native-session-status-fixture.mjs';

const workspace = (ids) => ({
  items: [{ workspaceId: 'repo', title: 'Repository', sessionIds: ids }],
});
const view = (bindings = [], worktrees = []) => [{ workspaceId: 'repo', bindings, worktrees }];

test('activity membership includes complete native activity, without idle, archived, blank or catalog-only rows', () => {
  const rows = {
    run: { running: true, updatedAt: 30 },
    wait: { pendingInteraction: 'approval', updatedAt: 40 },
    unread: { completed: true, updatedAt: 20 },
    idle: { running: false },
    blank: { blank: true, running: true },
    archived: { running: true },
    child: { origin: 'subagent', parentId: 'parent', running: true },
    parent: { running: false, updatedAt: 10 },
    bound: { running: true, updatedAt: 50 },
  };
  const sessions = { ids: Object.keys(rows).filter((id) => id !== 'child'), byId: rows };
  const workspaces = workspace(Object.keys(rows).filter((id) => id !== 'bound'));
  workspaces.archivedSessionIds = ['archived'];
  const views = view(
    [{ sessionId: 'bound', worktreeId: 'wt' }],
    [{ worktreeId: 'wt', branch: 'feature/bell' }],
  );
  const original = JSON.stringify({ sessions, workspaces, views });
  const entries = activity.activeSessions(
    sessions,
    sessionView.deriveSessionPresentationIndex(sessions),
    workspaces,
    views,
  );
  assert.deepEqual(
    entries.map((entry) => entry.sessionId),
    ['bound', 'wait', 'run', 'unread', 'parent'],
  );
  assert.equal(entries[0].worktree, 'feature/bell');
  assert.equal(entries[0].workspaceTitle, 'Repository');
  assert.equal(entries[1].worktree, null);
  assert.equal(entries.at(-1).presentation.status.labelKey, 'subagentsRunning');
  assert.equal(JSON.stringify({ sessions, workspaces, views }), original);
  assert.equal(activity.activeSessions(sessions, {}, workspaces, views).length, 0);
});

test('activity never guesses Main before relationship facts arrive and deduplicates members', () => {
  const sessions = { ids: ['s'], byId: { s: { running: true } } };
  const presentations = sessionView.deriveSessionPresentationIndex(sessions);
  assert.equal(
    activity.activeSessions(sessions, presentations, workspace(['s']), [])[0].worktree,
    undefined,
  );
  const views = view([{ sessionId: 's', worktreeId: 'missing', status: 'detached' }]);
  const entries = activity.activeSessions(sessions, presentations, workspace(['s', 's']), views);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].worktree, undefined);
});

test('native status-only completion, acknowledgement, rerun and interaction update bell membership', async () => {
  const f = await nativeStatusFixture();
  try {
    const entries = () => {
      const source = f.render();
      return activity.activeSessions(
        source.sessions,
        source.sessionPresentations,
        workspace(['s']),
        view(),
      );
    };
    const byId = f.list.getSnapshot().byId;
    assert.equal(entries()[0].presentation.status.state, 'ongoing');
    f.running(false);
    assert.strictEqual(f.list.getSnapshot().byId, byId);
    assert.equal(entries()[0].presentation.status.state, 'done');
    assert.equal(f.status().completionUnread, true, 'listing never acknowledges the native owner');
    // Native list replay catches up before mainView retention rebaselines status.
    f.list.set({ ...f.list.getSnapshot(), byId: { s: { ...byId.s, running: false } } });
    f.open();
    assert.deepEqual(entries(), []);
    f.running(true);
    assert.equal(entries()[0].presentation.status.state, 'ongoing');
    const publish = f.ctx.uiSession.registerPendingInteraction(() => 1);
    const release = publish({ key: 'approval', kind: 'approval', sessionId: 's' }, async () => {});
    assert.equal(entries()[0].presentation.status.state, 'warning');
    release();
    f.running(false);
    assert.deepEqual(entries(), [], 'completion in mainView is already read');
  } finally {
    await f.dispose();
  }
});

test('display clocks track observed run/stop, ignore title/status replays and prune removed sessions', () => {
  const project = (running, updatedAt = 100) =>
    sessionView.deriveSessionPresentationIndex({ byId: { s: { running, updatedAt } } });
  let clocks = activity.activityClocks(new Map(), project(true), 1000);
  assert.equal(clocks.get('s').since, 100, 'first observation uses native row baseline');
  clocks = activity.activityClocks(clocks, project(true), 1500);
  assert.equal(clocks.get('s').since, 100);
  clocks = activity.activityClocks(clocks, project(false), 2000);
  assert.equal(clocks.get('s').since, 2000);
  clocks = activity.activityClocks(clocks, project(false), 3000);
  assert.equal(clocks.get('s').since, 2000);
  clocks = activity.activityClocks(clocks, project(true), 4000);
  assert.equal(clocks.get('s').since, 4000);
  clocks = activity.activityClocks(clocks, project(true, 4500), 5000);
  assert.equal(clocks.get('s').since, 4500);
  assert.equal(activity.activityClocks(clocks, {}, 6000).size, 0);
});

test('production bell opens empty, renders native states, navigates, dismisses and disposes its timer', async () => {
  const dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>');
  const { document } = dom.window;
  const originals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const timers = new Set();
  const originalSetInterval = dom.window.setInterval.bind(dom.window);
  const originalClearInterval = dom.window.clearInterval.bind(dom.window);
  dom.window.setInterval = (...args) => {
    const id = originalSetInterval(...args);
    timers.add(id);
    return id;
  };
  dom.window.clearInterval = (id) => {
    timers.delete(id);
    originalClearInterval(id);
  };
  const position = { left: 12, top: 44 };
  const dependencies = {
    react: React,
    'react/jsx-runtime': jsx,
    'react-dom': { createPortal },
    '@deepseek-ai/dsh-client-ui-primitives': {
      MenuSurface: React.forwardRef((props, ref) => React.createElement('div', { ...props, ref })),
      StateDot: ({ state }) => React.createElement('i', { 'data-state': state }),
      Tooltip: ({ children }) => children,
      useAnchoredPosition: () => position,
      useDismissOnOutsidePointer(root, open, setOpen, panel) {
        React.useEffect(() => {
          if (!open) return;
          const dismiss = (event) => {
            if (!root.current?.contains(event.target) && !panel.current?.contains(event.target))
              setOpen(false);
          };
          document.addEventListener('pointerdown', dismiss);
          return () => document.removeEventListener('pointerdown', dismiss);
        }, [open]);
      },
    },
    '../../session/active-sessions.js': activity,
    '../../session/session-view.js': sessionView,
    '../../session/session-labels.js': labels,
    '../../worktree.css': { default: {} },
  };
  const source = await readFile(
    new URL('../src/client/surface/components/SessionActivityBell.tsx', import.meta.url),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  const root = createRoot(document.getElementById('root'));
  const calls = [];
  const props = {
    entries: [],
    sessions: { ids: [], byId: {} },
    presentations: {},
    t: (key, values) => key + (values ? JSON.stringify(values) : ''),
    hidden: false,
    onOpenSession: (...args) => calls.push(args),
  };
  const render = async () =>
    React.act(() => root.render(React.createElement(exports.SessionActivityBell, props)));
  const click = async (selector) => React.act(() => document.querySelector(selector).click());
  const bell = () => document.querySelector('[data-session-activity]');
  try {
    await render();
    assert.equal(bell().dataset.sessionActivity, 'empty');
    await click('[data-session-activity]');
    assert.match(document.querySelector('[role="dialog"]').textContent, /activity.empty/);
    assert.equal(timers.size, 1);
    assert.deepEqual(calls, []);
    props.sessions = {
      ids: ['run', 'done', 'wait'],
      byId: {
        run: { displayTitle: 'Run task', running: true, updatedAt: Date.now() - 90000 },
        done: { completed: true },
        wait: { pendingInteraction: 'approval' },
      },
    };
    props.presentations = sessionView.deriveSessionPresentationIndex(props.sessions);
    props.entries = activity.activeSessions(
      props.sessions,
      props.presentations,
      workspace(props.sessions.ids),
      view(),
    );
    await render();
    assert.equal(bell().dataset.sessionActivity, 'active');
    assert.deepEqual(
      [...document.querySelectorAll('[data-state]')].map((item) => item.dataset.state),
      ['ongoing', 'done', 'warning'],
    );
    assert.match(
      document.querySelector('[data-activity-session="run"]').textContent,
      /Run task.*Repository.*worktree.main.*activity.runningFor/,
    );
    assert.equal(document.querySelectorAll('[data-activity-session]').length, 3);
    await click('[data-activity-session="done"]');
    assert.deepEqual(calls, [['repo', 'done']]);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(timers.size, 0);
    const realNow = Date.now;
    const reopenedAt = realNow() + 60000;
    Date.now = () => reopenedAt;
    try {
      await click('[data-session-activity]');
      const expectedTime = props.t('activity.runningFor', {
        t: labels.sessionTimeLabel(props.t, { unit: 'minutes', n: 2 }),
      });
      assert.ok(
        document.querySelector('[data-activity-session="run"]').textContent.includes(expectedTime),
        'reopening after one minute displays the current duration before the next timer tick',
      );
    } finally {
      Date.now = realNow;
    }
    await React.act(() =>
      document.dispatchEvent(
        new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    assert.equal(document.activeElement, bell());
    assert.equal(bell().getAttribute('aria-expanded'), 'false');
    await click('[data-session-activity]');
    await React.act(() =>
      document
        .getElementById('outside')
        .dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })),
    );
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await click('[data-session-activity]');
    props.hidden = true;
    await render();
    assert.equal(document.querySelector('[role="dialog"]'), null);
    props.hidden = false;
    await render();
    assert.equal(bell().getAttribute('aria-expanded'), 'false');
    await click('[data-session-activity]');
    await React.act(() => root.unmount());
    assert.equal(timers.size, 0);
  } finally {
    await React.act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, descriptor);
    }
  }
});
