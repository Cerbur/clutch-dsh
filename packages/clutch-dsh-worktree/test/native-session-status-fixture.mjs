import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import * as cordis from '@deepseek-ai/cordis';
import * as store from '@deepseek-ai/dsh-client-store';
import * as slots from '@deepseek-ai/dsh-client-ui-slots';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import * as sessionView from '../lib/client/session/session-view.js';
import * as selection from '../lib/client/session/session-selection.js';
import * as labels from '../lib/client/session/session-labels.js';
import * as dashboardSelection from '../lib/client/dashboard/dashboard-selection.js';
import * as acquisition from '../lib/client/dashboard/worktree-acquisition-facts.js';
import { effectiveViewMode } from '../lib/client/view/view-mode.js';

async function handoff(specifier) {
  const code = await readFile(new URL(import.meta.resolve(specifier)), 'utf8');
  const entries = [];
  new Function('window', code)({ __ModuleLoader__: { load: (entry) => entries.push(entry) } });
  assert.equal(entries.length, 1);
  const modules = {
    '@deepseek-ai/cordis': cordis,
    '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-client-ui-slots': slots,
    react: React,
    'react/jsx-runtime': jsx,
    'react-dom': { createPortal: (node) => node },
    'react-dom/client': {},
  };
  return entries[0].factory((name) => {
    assert.ok(name in modules, 'Unexpected native dependency: ' + name);
    return modules[name];
  });
}

// Deterministic browser-free hook scheduler: memo dependencies and real external
// subscriptions are retained across renders. No native status owner is mocked.
export function hookScheduler() {
  const seats = [];
  let cursor = 0;
  let dirty = true;
  let result;
  const react = {
    useState(initial) {
      const i = cursor++;
      seats[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [
        seats[i].value,
        (next) => {
          const value = typeof next === 'function' ? next(seats[i].value) : next;
          if (!Object.is(value, seats[i].value)) dirty = true;
          seats[i].value = value;
        },
      ];
    },
    useRef(initial) {
      return react.useState(() => ({ current: initial }))[0];
    },
    useMemo(calculate, deps) {
      const i = cursor++;
      if (!seats[i] || deps.some((value, j) => !Object.is(value, seats[i].deps[j]))) {
        seats[i] = { value: calculate(), deps };
      }
      return seats[i].value;
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const i = cursor++;
      if (seats[i]?.subscribe !== subscribe) {
        seats[i]?.cleanup?.();
        seats[i] = {
          subscribe,
          cleanup: subscribe(() => {
            dirty = true;
          }),
        };
      }
      return getSnapshot();
    },
    useEffect() {},
    useLayoutEffect() {},
    useId: () => 'status-regression',
  };
  return {
    react,
    get dirty() {
      return dirty;
    },
    render(fn, force = false) {
      if (dirty || force) {
        cursor = 0;
        dirty = false;
        result = fn();
      }
      return result;
    },
    dispose() {
      for (const seat of seats) seat?.cleanup?.();
    },
  };
}

async function source(file, dependencies) {
  const code = await readFile(new URL('../src/client/' + file, import.meta.url), 'utf8');
  const output = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((name) => {
    assert.ok(name in dependencies, 'Unexpected production dependency: ' + name);
    return dependencies[name];
  }, exports);
  return exports;
}

export async function nativeStatusFixture(
  rows = { s: { running: true } },
  listedIds = Object.keys(rows),
) {
  const ctx = new Context();
  const list = store.createSnapshotStore({
    phase: 'ready',
    ids: listedIds,
    byId: Object.fromEntries(
      Object.entries(rows).map(([id, row]) => [
        id,
        {
          id,
          blank: false,
          displayTitle: id,
          updatedAt: 1,
          retainedBy: {},
          ...row,
        },
      ]),
    ),
  });
  const events = new Map();
  ctx.provide('sessions', {
    list,
    binding: () => undefined,
    retainInfo: (id) => ({
      getSnapshot: () => ({ retainedBy: list.getSnapshot().byId[id]?.retainedBy ?? {} }),
      subscribe: () => () => {},
    }),
  });
  ctx.provide('remote', {
    $on(name, listener) {
      events.set(name, listener);
      return () => events.delete(name);
    },
  });
  const runtime = await handoff('@deepseek-ai/dsh-client-ui-renderer/client');
  await ctx.plugin(runtime.SlotRegistry).await();
  const native = await handoff('@deepseek-ai/dsh-client-ui-session/client');
  await ctx.plugin(native).await();
  const root = ctx.slots.hostFace().root.getSnapshot();
  assert.strictEqual(root.hooks.sessionStatus, ctx.uiSession.sessionStatus);
  const h = hookScheduler();
  const empty = store.createSnapshotStore({});
  const workspace = store.createSnapshotStore({ items: [] });
  const { useSurfaceSources } = await source('surface/state/useSurfaceSources.tsx', {
    react: h.react,
    '../../session/session-view.js': sessionView,
    '../../session/session-selection.js': selection,
    '../../view/view-mode.js': { effectiveViewMode },
    '../../overlay/sidebar-overlay-geometry.js': { useSidebarOverlayGeometry: () => ({}) },
    '../shared.js': {
      EMPTY_FORK_RECOVERY_STORE: empty,
      EMPTY_FULL_ACCESS_CONFIRMATION_SNAPSHOT: () => undefined,
      EMPTY_FULL_ACCESS_CONFIRMATION_SUBSCRIBE: () => () => {},
      EMPTY_PERMISSION_NOTICE_SNAPSHOT: () => undefined,
      EMPTY_PERMISSION_NOTICE_SUBSCRIBE: () => () => {},
      useStableWorkspaceIds: () => [],
    },
  });
  const selector = (observable) => (select) =>
    select(h.react.useSyncExternalStore(observable.subscribe, observable.getSnapshot));
  const props = {
    available: true,
    manager: {},
    useStore: () => 'worktree',
    useSessions: selector(root.hooks.sessions),
    useSessionStatus: selector(root.hooks.sessionStatus),
    useWorkspaces: selector(workspace),
    expandState: empty,
    sessionOrder: empty,
  };
  return {
    ctx,
    list,
    props,
    h,
    render: (force = false) => h.render(() => useSurfaceSources({ props }), force),
    status: (id = 's') => ctx.uiSession.sessionStatus.getSnapshot().get(id),
    running: (value, id = 's') => events.get('api-session/status')(id, value),
    open(id = 's') {
      const current = list.getSnapshot();
      list.set({
        ...current,
        byId: { ...current.byId, [id]: { ...current.byId[id], retainedBy: { mainView: 1 } } },
      });
    },
    async dispose() {
      h.dispose();
      await ctx.fiber.dispose();
    },
  };
}

// Execute canonical production JSX. Platform widgets remain opaque elements;
// assertions inspect actual StateDot props and public row status attributes.
export async function statusRenderers() {
  let active;
  const schedulers = new Map();
  const h = {
    react: new Proxy({}, { get: (_target, name) => active.react[name] }),
    render(key, fn) {
      if (!schedulers.has(key)) schedulers.set(key, hookScheduler());
      active = schedulers.get(key);
      return active.render(fn, true);
    },
  };
  const widget = (name) => name;
  const icons = new Proxy({}, { get: (_target, name) => widget(name) });
  const common = { react: h.react, 'react/jsx-runtime': jsx };
  const row = await source('surface/components/rows.tsx', {
    ...common,
    '@deepseek-ai/dsh-client-ui-primitives': {
      HoverCard: 'HoverCard',
      Menu: 'Menu',
      StateDot: 'StateDot',
    },
    '../../dsh-icons.js': icons,
    '../state/useTitleMarquee.js': { useTitleMarquee: () => ({}) },
    '../../dashboard/dashboard-icon.js': { IconDashboard: 'DashboardIcon' },
    '../../session/session-view.js': sessionView,
    '../../worktree.css': { default: {} },
    '../selectors.js': { sessionLabel: (id) => id },
  });
  const dashboard = await source('dashboard/WorktreeDashboard.tsx', {
    '../branch/GitBranchSelector.js': { GitBranchPicker: () => null },
    ...common,
    '@deepseek-ai/dsh-client-ui-primitives': {
      StateDot: 'StateDot',
      Button: 'Button',
      Tooltip: 'Tooltip',
      Modal: 'Modal',
      Input: 'Input',
    },
    '../dsh-icons.js': icons,
    '../surface/components/NotificationToasts.js': { NotificationToasts: 'Toasts' },
    '../view/worktree-view.js': {},
    '../view/worktree-error-copy.js': {},
    './dashboard-overlay.js': {},
    './dashboard-selection.js': dashboardSelection,
    './worktree-acquisition-facts.js': acquisition,
    './vscode-url.js': {},
    './OpenInAppButton.js': { OpenInAppButton: 'OpenInAppButton' },
    './WorktreeInstructions.js': { WorktreeInstructions: 'Instructions' },
    '../settings/ToolSettings.js': { ToolSettings: 'ToolSettings' },
    './git/WorktreeGitPanel.js': { WorktreeGitPanel: 'GitPanel' },
    './git/WorktreeGitOverview.js': {
      useWorktreeGitOverview: () => ({ status: 'unavailable' }),
      WorktreeGitOverviewValue: 'GitOverview',
    },
    '../session/session-selection.js': selection,
    '../session/session-view.js': sessionView,
    '../session/session-labels.js': labels,
    './dashboard.css': { default: {} },
  });
  const t = (key) => key;
  const drag = {};
  const record = {
    workspaceId: 'ws',
    worktreeId: 'wt',
    branch: 'feature',
    absolutePath: '/test/wt',
    status: 'active',
    source: 'plugin',
  };
  return {
    session(presentation) {
      return h.render(
        'session',
        () =>
          row.WorktreeSessionRow({
            t,
            sessionId: 's',
            label: 's',
            blank: false,
            drag,
            presentation,
          }),
        true,
      );
    },
    group(status, expanded = false) {
      return h.render(
        'group',
        () =>
          row.WorktreeGroupRow({
            t,
            kind: 'worktree',
            record,
            expanded,
            drag,
            groupActivityStatus: status,
          }),
        true,
      );
    },
    workspace(status, expanded = false) {
      return h.render(
        'workspace',
        () =>
          row.WorktreeWorkspaceRow({
            t,
            workspace: { workspaceId: 'ws', title: 'ws' },
            expanded,
            drag,
            groupActivityStatus: status,
          }),
        true,
      );
    },
    dashboard(source) {
      return h.render(
        'dashboard',
        () =>
          dashboard.WorktreeDashboard({
            t,
            record,
            workspaceTitle: 'ws',
            sessions: source.sessions,
            sessionPresentations: source.sessionPresentations,
            sessionIds: ['s'],
            onOpenSession() {},
          }),
        true,
      );
    },
  };
}

export function findNodes(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...[node.props?.children, node.props?.anchor]
      .flat(Infinity)
      .flatMap((child) => findNodes(child, predicate)),
  ];
}
