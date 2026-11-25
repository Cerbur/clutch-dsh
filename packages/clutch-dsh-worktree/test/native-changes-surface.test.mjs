import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import * as selection from '../lib/client/dashboard/dashboard-selection.js';
import * as navigation from '../lib/client/dashboard/dashboard-navigation.js';
import * as sessions from '../lib/client/dashboard/dashboard-sessions.js';
import { createNativeChangesNavigation } from '../lib/client/dashboard/git/native-changes-navigation.js';
import { en, zh } from '../lib/client/locales.js';
import * as center from '../lib/client/surface/notification-center.js';
import * as queue from '../lib/client/surface/notification-queue.js';
import * as diagnostics from '../lib/client/settings/diagnostics.js';
import { useSurfaceMutation } from '../lib/client/surface/actions/useSurfaceMutation.js';
import { forkRecoveryError } from '../lib/client/surface/shared.js';
import { createWorktreeSessionForkCoordinator } from '../lib/client/session/worktree-session-fork.js';

async function clientModule(file) {
  const compiled = ts.transpileModule(await readFile(new URL('../src/client/' + file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  return (modules) => {
    const exports = {};
    new Function('require', 'exports', compiled)((name) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return jsx;
      return modules[name] ?? new Proxy({}, {
        get: (_target, key) => String(key).startsWith('use') ? () => ({}) : () => null,
      });
    }, exports);
    return exports;
  };
}

const surfaceModule = await clientModule('WorktreeSurface.tsx');
const errorCopy = (await clientModule('view/worktree-error-copy.ts'))({});
const notifications = (await clientModule('surface/components/NotificationToasts.tsx'))({
  '../notification-queue.js': queue, '../notification-center.js': center,
  '../../view/worktree-error-copy.js': errorCopy,
  '@deepseek-ai/dsh-client-ui-primitives': { Toast: ({ text }) => React.createElement('output', null, text) },
});
const { SurfaceContent } = (await clientModule('surface/components/SurfaceContent.tsx'))({
  '../shared.js': { forkRecoveryError },
  './NotificationToasts.js': notifications, '../notification-queue.js': queue,
  '../../view/worktree-error-copy.js': errorCopy,
});
const { WorktreeSettings } = (await clientModule('settings/WorktreeSettings.tsx'))({
  './diagnostics.js': diagnostics, '../view/worktree-error-copy.js': errorCopy,
  '@deepseek-ai/dsh-client-ui-primitives': { SegmentedTabs: () => null, Tag: 'span', Button: 'button' },
});

async function fixture(t, { main, external, openNativeChanges }) {
  const dom = new JSDOM('<div id="root"></div><div id="sidebar"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  const record = { workspaceId: 'ws', worktreeId: main ? 'main:ws' : 'wt', absolutePath: '/checkout',
    status: 'active', source: main ? undefined : 'plugin', branch: 'feature' };
  const source = { mode: 'worktree', currentSessionId: 'old', workspaceIds: ['ws'], forkRecoverySnapshot: { pending: [] },
    workspaces: { items: [{ workspaceId: 'ws', path: '/checkout', sessionIds: ['old', 'matching'] }] },
    sessions: { ids: ['old', 'matching'], byId: {}, phase: 'ready' }, archivedSessionIds: [], sessionPresentations: {} };
  const view = { workspaceId: 'ws', readiness: { status: 'ready' }, worktrees: main ? [] : [record], branches: [], knownSessionIds: ['old', 'matching'],
    bindings: main ? [] : ['old', 'matching'].map((sessionId) => ({ workspaceId: 'ws', worktreeId: 'wt', sessionId, status: 'active' })) };
  const listeners = new Set();
  let snapshot = { workspaceId: 'ws', worktreeId: record.worktreeId, sessionId: 'old' };
  const store = { subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => snapshot, set: (next) => { snapshot = next; for (const fn of listeners) fn(); } };
  const f = { record, source, document: dom.window.document, opened: [], resources: [], mounts: 0, dashboard: undefined,
    verify: async ({ sessionId }) => sessionId === 'matching', error: undefined };
  function Dashboard(props) {
    f.dashboard = props;
    React.useEffect(() => { f.mounts++; return () => { f.dashboard = undefined; }; }, []);
    return React.createElement('div', { 'data-dashboard': true });
  }
  const modules = {
    'react-dom': ReactDOM,
    './dashboard/dashboard-selection.js': selection,
    './dashboard/dashboard-navigation.js': navigation,
    './dashboard/dashboard-sessions.js': sessions,
    './dashboard/WorktreeDashboard.js': { WorktreeDashboard: Dashboard },
    './surface/components/NotificationToasts.js': notifications,
    './surface/components/SurfaceContent.js': { SurfaceContent: (input) => {
      f.openDashboard = input.props.openDashboard;
      f.error = input.mutation.actionError;
      return React.createElement(SurfaceContent, input);
    } },
    './surface/state/useSurfaceSources.js': { useSurfaceSources: () => source },
    './surface/state/useSurfaceRefresh.js': { useSurfaceRefresh: () => ({ viewByWorkspace: new Map([['ws', view]]), readState: { status: 'ready', views: [view] } }) },
    './surface/actions/useSurfaceMutation.js': { useSurfaceMutation },
    './surface/actions/useLifecycleActions.js': { useLifecycleActions: () => ({ recoveryAction: () => null }) },
    './surface/state/useSessionOrdering.js': { useSessionOrdering: () => ({ orderedSessionIdsByAccount: new Map() }) },
    './view/view-mode.js': { workspaceSessionIds: () => ['old', 'matching'] },
  };
  const { WorktreeSurface } = surfaceModule(modules);
  const native = createNativeChangesNavigation({ manager: { canOpenNativeChanges: (input) => f.verify(input) },
    screen: () => ({ ready: true, workspaceId: 'ws', sessionId: source.currentSessionId,
      cwd: source.currentSessionId === 'matching' ? '/checkout' : '/moved', mountedSessionId: source.currentSessionId }),
    sidebar: () => ({ accepts: () => true, open: (address) => f.resources.push(address) }),
    openSession: (id) => f.opened.push(id) });
  const props = { t: (key) => en[key], dashboardStore: external ? store : undefined,
    sidebarSeat: { element: dom.window.document.getElementById('sidebar') },
    openSession: (id) => { f.opened.push(id); f.onNavigate?.(id); },
    openNativeChanges: openNativeChanges ?? ((...args) => native.open(...args)) };
  const render = (locale = en, showSettings = false) => {
    props.t = (key) => locale[key];
    root.render(React.createElement(React.Fragment, null, React.createElement(WorktreeSurface, props),
      React.createElement(notifications.NotificationPresenter, { t: props.t }),
      showSettings && React.createElement(WorktreeSettings, { t: props.t })));
  };
  f.render = (...args) => React.act(async () => render(...args));
  f.selectSync = (id) => {
    source.currentSessionId = id;
    ReactDOM.flushSync(() => render());
  };
  f.switchTo = async (id) => { source.currentSessionId = id; await f.render(); };
  t.after(async () => {
    native.dispose(); await React.act(async () => root.unmount()); dom.window.close();
    center.worktreeNotifications.dispose();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await f.render();
  if (!external) await React.act(async () => f.openDashboard(record));
  return f;
}

test('historical fork repair appears only in Settings across reloads, but a new failed fork shows its toast', async (t) => {
  const f = await fixture(t, { external: true });
  const options = {
    sessions: { getSnapshot: () => ({ phase: 'ready', ids: ['parent', 'old-child'],
      byId: { parent: {}, 'old-child': { parentId: 'parent' } } }) },
    fork: async () => 'new-child',
    findBindings: async () => ({ bySessionId: new Map([['parent', { status: 'found',
      binding: { workspaceId: 'ws', worktreeId: 'wt', status: 'active', sessionId: 'parent' } }]]) }),
    bindSession: async () => { throw Object.assign(new Error('checkout missing'), { code: 'WORKTREE_NOT_FOUND' }); },
  };
  for (const withNewFork of [false, true]) {
    const coordinator = createWorktreeSessionForkCoordinator(options);
    await coordinator.reconcile();
    f.source.forkRecoverySnapshot = coordinator.recovery.getSnapshot();
    await f.render(zh);
    await f.render(zh, true);
    assert.equal(f.document.querySelector('output'), null);
    const entry = f.document.querySelector('[data-worktree-diagnostic]');
    assert.match(entry.textContent, /old-child/);
    assert.match(entry.querySelector('pre').textContent, /WORKTREE_NOT_FOUND/);
    assert.ok(entry.textContent.includes(zh['action.openCreatedSession']));
    if (withNewFork) {
      await coordinator.fork({ sessionId: 'parent' });
      f.source.forkRecoverySnapshot = coordinator.recovery.getSnapshot();
      await f.render(zh, true);
      assert.ok(f.document.querySelector('output').textContent.includes(zh['error.worktreeNotFound']));
    }
    coordinator.dispose();
  }
});

test('a synchronous native selection commit preserves the Dashboard and retry feedback', async (t) => {
  const f = await fixture(t, { external: true });
  const mounts = f.mounts;
  f.onNavigate = f.selectSync;
  await React.act(async () => f.dashboard.onOpenNativeChanges());
  assert.equal(f.source.currentSessionId, 'matching');
  assert.ok(f.dashboard);
  assert.equal(f.mounts, mounts);
  assert.equal(f.error?.code, 'NATIVE_CHANGES_SESSION_SWITCHING');
});

for (const result of ['session-switching', 'forge-restart-required']) {
  test(`Dashboard ${result} renders localized guidance in the toast and Settings without a refresh retry`, async (t) => {
    const f = await fixture(t, { external: true,
      openNativeChanges: result === 'session-switching' ? undefined : async () => result });
    await React.act(async () => f.dashboard.onOpenNativeChanges());
    for (const locale of [en, zh]) {
      await f.render(locale, true);
      const message = locale[`dashboard.git.native.${result}`];
      assert.equal(f.document.querySelector('output').textContent, `${message} ${locale['settings.toastHint']}`);
      const issue = f.document.querySelector('[data-worktree-diagnostic]');
      assert.equal(issue.querySelector('p').textContent, message);
      assert.equal(issue.querySelector('button'), null);
    }
  });
}

for (const cancel of ['close', 'mode', 'unrelated']) test(`a ${cancel} during Host validation retires native navigation`, async (t) => {
  const f = await fixture(t, { external: true });
  let release;
  f.verify = () => new Promise((resolve) => { release = resolve; });
  let action;
  await React.act(async () => { action = f.dashboard.onOpenNativeChanges(); });
  if (cancel === 'close') await React.act(async () => f.dashboard.onClose());
  if (cancel === 'mode') { f.source.mode = 'workspace-session'; await f.render(); }
  if (cancel === 'unrelated') await f.switchTo('unrelated');
  await React.act(async () => { release(true); await action; });
  assert.deepEqual(f.opened, []);
  assert.deepEqual(f.resources, []);
  assert.equal(f.error, undefined);
});

test('changing the selected Base while Host verification waits cancels Dashboard native open', async (t) => {
  const f = await fixture(t, { external: true });
  let finish;
  f.verify = () => new Promise((resolve) => { finish = resolve; });
  let current = true;
  let pending;
  await React.act(async () => {
    pending = f.dashboard.onOpenNativeChanges('refs/heads/selected', () => current);
  });
  current = false;
  await React.act(async () => { finish(true); await pending; });
  assert.deepEqual(f.resources, []);
});

test('closing while native selection is pending prevents a late Dashboard reopening', async (t) => {
  const f = await fixture(t, { external: true });
  await React.act(async () => f.dashboard.onOpenNativeChanges());
  await React.act(async () => f.dashboard.onClose());
  await f.switchTo('matching');
  assert.equal(f.dashboard, undefined);
  assert.deepEqual(f.resources, []);
});

test('failed native selection clears its pending Dashboard identity', async (t) => {
  const f = await fixture(t, { external: true });
  f.onNavigate = () => { throw new Error('navigation unavailable'); };
  await React.act(async () => f.dashboard.onOpenNativeChanges());
  assert.equal(f.error?.code, 'NATIVE_CHANGES_VERIFICATION_FAILED');
  await f.switchTo('matching');
  assert.equal(f.dashboard, undefined);
});

for (const main of [false, true]) for (const external of [false, true]) {
  test(`native Changes retains the mounted ${main ? 'Main' : 'Worktree'} Dashboard across Session selection (external: ${external})`, async (t) => {
    const f = await fixture(t, { main, external });
    const mounts = f.mounts;
    await React.act(async () => f.dashboard.onOpenNativeChanges());
    assert.deepEqual(f.opened, ['matching']);
    assert.deepEqual(f.resources, [], 'never open the old Session store');
    await f.switchTo('matching');
    assert.ok(f.dashboard, 'the retry entry remains available after selecting the matching Session');
    assert.equal(f.mounts, mounts, 'Session selection must not remount the Dashboard or reset its Git tab');
    assert.equal(f.error?.code, 'NATIVE_CHANGES_SESSION_SWITCHING');
    await React.act(async () => f.dashboard.onOpenNativeChanges());
    assert.deepEqual(f.resources, ['dsh-resource://forge-changes/matching/local']);
    await f.switchTo('unrelated');
    assert.equal(f.dashboard, undefined, 'an unrelated Session switch still dismisses the Dashboard');
  });
}
