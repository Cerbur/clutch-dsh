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
import { en } from '../lib/client/locales.js';

const compiled = ts.transpileModule(await readFile(new URL('../src/client/WorktreeSurface.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

async function fixture(t, { main, external }) {
  const dom = new JSDOM('<div id="root"></div><div id="sidebar"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  const record = { workspaceId: 'ws', worktreeId: main ? 'main:ws' : 'wt', absolutePath: '/checkout',
    status: 'active', source: main ? undefined : 'plugin', branch: 'feature' };
  const source = { mode: 'worktree', currentSessionId: 'old', workspaceIds: ['ws'],
    workspaces: { items: [{ workspaceId: 'ws', path: '/checkout', sessionIds: ['old', 'matching'] }] },
    sessions: { ids: ['old', 'matching'], byId: {}, phase: 'ready' }, archivedSessionIds: [], sessionPresentations: {} };
  const view = { worktrees: main ? [] : [record], branches: [], knownSessionIds: ['old', 'matching'],
    bindings: main ? [] : ['old', 'matching'].map((sessionId) => ({ workspaceId: 'ws', worktreeId: 'wt', sessionId, status: 'active' })) };
  const listeners = new Set();
  let snapshot = { workspaceId: 'ws', worktreeId: record.worktreeId, sessionId: 'old' };
  const store = { subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => snapshot, set: (next) => { snapshot = next; for (const fn of listeners) fn(); } };
  const f = { record, source, opened: [], resources: [], mounts: 0, dashboard: undefined,
    verify: async ({ sessionId }) => sessionId === 'matching', error: undefined };
  const mutation = { setActionError: (error) => { f.error = error; } };
  function Dashboard(props) {
    f.dashboard = props;
    React.useEffect(() => { f.mounts++; return () => { f.dashboard = undefined; }; }, []);
    return React.createElement('div', { 'data-dashboard': true });
  }
  const modules = {
    react: React, 'react/jsx-runtime': jsx, 'react-dom': ReactDOM,
    './dashboard/dashboard-selection.js': selection,
    './dashboard/dashboard-navigation.js': navigation,
    './dashboard/dashboard-sessions.js': sessions,
    './dashboard/WorktreeDashboard.js': { WorktreeDashboard: Dashboard },
    './surface/components/NotificationToasts.js': { NotificationProvider: ({ children }) => children },
    './surface/components/SurfaceContent.js': { SurfaceContent: ({ props }) => { f.openDashboard = props.openDashboard; return null; } },
    './surface/state/useSurfaceSources.js': { useSurfaceSources: () => source },
    './surface/state/useSurfaceRefresh.js': { useSurfaceRefresh: () => ({ viewByWorkspace: new Map([['ws', view]]) }) },
    './surface/actions/useSurfaceMutation.js': { useSurfaceMutation: () => mutation },
    './surface/state/useSessionOrdering.js': { useSessionOrdering: () => ({ orderedSessionIdsByAccount: new Map() }) },
    './view/view-mode.js': { workspaceSessionIds: () => ['old', 'matching'] },
  };
  const exports = {};
  new Function('require', 'exports', compiled)((name) => modules[name] ?? new Proxy({}, {
    get: (_target, key) => String(key).startsWith('use') ? () => ({}) : () => null,
  }), exports);
  const native = createNativeChangesNavigation({ manager: { canOpenNativeChanges: (input) => f.verify(input) },
    screen: () => ({ ready: true, workspaceId: 'ws', sessionId: source.currentSessionId,
      cwd: source.currentSessionId === 'matching' ? '/checkout' : '/moved', mountedSessionId: source.currentSessionId }),
    sidebar: () => ({ accepts: () => true, open: (address) => f.resources.push(address) }),
    openSession: (id) => f.opened.push(id) });
  const props = { t: (key) => en[key], dashboardStore: external ? store : undefined,
    sidebarSeat: { element: dom.window.document.getElementById('sidebar') },
    openSession: (id) => { f.opened.push(id); f.onNavigate?.(id); },
    openNativeChanges: (...args) => native.open(...args) };
  f.render = () => React.act(async () => { root.render(React.createElement(exports.WorktreeSurface, props)); });
  f.selectSync = (id) => {
    source.currentSessionId = id;
    ReactDOM.flushSync(() => root.render(React.createElement(exports.WorktreeSurface, props)));
  };
  f.switchTo = async (id) => { source.currentSessionId = id; await f.render(); };
  t.after(async () => {
    native.dispose(); await React.act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await f.render();
  if (!external) await React.act(async () => f.openDashboard(record));
  return f;
}

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
