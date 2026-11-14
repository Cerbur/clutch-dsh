import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

async function load(file, dependencies = {}) {
  const source = await readFile(new URL('../src/client/dashboard/' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } });
  const exports = {};
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, exports);
  return exports;
}
const selection = await load('popover-target.ts');
const placement = await load('popover-placement.ts');

for (const dismiss of ['close', 'dashboard']) {
  test(`real popover shares notification reads and stops history continuations on ${dismiss}`, async () => {
    const dom = new JSDOM('<header><div data-conversation-header-leading></div><div id="root"></div></header>', { url: 'https://dsh.test' });
    dom.window.ResizeObserver = class { observe() {} disconnect() {} };
    const { document } = dom.window;
    const originals = new Map();
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    const facts = await import('../lib/client/dashboard/git/git-facts.js');
    const { createWorktreeViewReader } = await import('../lib/client/view/worktree-view-read.js');
    const hook = await load('git/WorktreeGitOverview.tsx', {
      react: React, 'react/jsx-runtime': jsx,
      '../../../contract/index.js': { WORKTREE_GIT_WORKING_TREE: 'working-tree' },
      './git-facts.js': facts, './GitLineStats.js': {}, './GitCommitStats.js': {},
      '../dashboard.css': { default: {} },
    });
    const { WorktreePopover } = await load('WorktreePopover.tsx', {
      react: React, 'react/jsx-runtime': jsx, 'react-dom': { createPortal },
      '@deepseek-ai/dsh-client-ui-primitives': { Tooltip: ({ children }) => children,
        MenuSurface: React.forwardRef((props, ref) => React.createElement('div', { ...props, ref })) },
      '../dsh-icons.js': { IconBranchOutline16: () => null, IconLoadingOutline16: () => null, IconRefreshOutline16: () => null },
      './popover-target.js': selection, './popover-placement.js': placement,
      './worktree-popover.css': { default: {} },
      './WorktreeDashboard.js': { WorktreeBaselineEditor: () => null,
        useWorktreeBaselineSync: () => ({ setSyncOpen() {}, syncPending: false, syncDialog: null }) },
      './git/WorktreeGitOverview.js': { ...hook, WorktreeGitOverviewValue: () => null },
    });
    const navigation = { worktrees: [record], bindings: view.bindings,
      checkout: { gitRootPath: '/repo', currentHead: { kind: 'branch', name: 'main', commit: 'a' } },
      gitState: { ok: true, value: { currentBranch: 'main' } } };
    let navigationReads = 0;
    let deferNavigation = false;
    const navigationResolvers = [];
    const histories = [];
    const files = [];
    const manager = {
      readWorkspaceNavigation: async () => {
        navigationReads++;
        return deferNavigation ? new Promise((resolve) => navigationResolvers.push(resolve)) : navigation;
      },
      listWorktreeCommits: () => new Promise((resolve) => histories.push(resolve)),
      listWorktreeCommitFiles: async (input) => { files.push(input); return { files: [] }; },
    };
    const reader = createWorktreeViewReader(manager);
    let notification;
    let dashboard;
    let dashboardChanged;
    const props = { sessionId: 's', t: (key) => key, manager, viewReader: reader,
      useWorktreeContext: (select) => select({ status: 'ready', workspaceId: 'w', sessionId: 's',
        value: { kind: 'worktree', worktreeId: 'tree' } }),
      dashboardStore: { getSnapshot: () => dashboard,
        subscribe: (fn) => { dashboardChanged = fn; return () => {}; } },
      subscribeChanges: (fn) => { notification = fn; return () => { notification = undefined; }; },
      refreshContext: async () => {}, createSession: async () => {}, openSession() {}, expand() {},
    };
    const history = { commits: [{ kind: 'working-tree', sha: 'working-tree' }], truncated: false };
    const root = createRoot(document.getElementById('root'));
    try {
      await React.act(async () => root.render(React.createElement(WorktreePopover, props)));
      // Central notification first invalidates and starts Context's shared read.
      // Exercise both queued (Git pending) and idle notification handling.
      for (const busy of [true, false]) {
        deferNavigation = true;
        const before = navigationReads;
        await React.act(async () => {
          reader.invalidate('w', { changeId: String(busy) });
          void reader.read('w');
          notification({ workspaceId: 'w', requestId: String(busy) });
        });
        assert.equal(navigationReads, before + 1, 'one event starts only one Workspace read');
        if (busy) await React.act(async () => histories.shift()(history));
        assert.equal(navigationReads, before + 1, 'queued notification reuses central invalidation');
        await React.act(async () => navigationResolvers.shift()(navigation));
        await React.act(async () => histories.shift()(history));
      }
      deferNavigation = false;
      await React.act(async () => document.querySelector('[data-popover-refresh]').click());
      assert.equal(histories.length, 1, 'history is pending before dismissal');
      const fileCount = files.length;
      await React.act(async () => {
        if (dismiss === 'close') document.querySelector('[aria-haspopup="dialog"]').click();
        else { dashboard = {}; dashboardChanged(); }
      });
      assert.equal(document.querySelector('[data-worktree-popover][data-state="open"]'), null);
      if (dismiss === 'close') {
        const exiting = document.querySelector('[data-state="closing"]');
        assert.ok(exiting, 'closing retains the visual panel for its exit animation');
        assert.equal(exiting.getAttribute('aria-hidden'), 'true');
        assert.ok(exiting.hasAttribute('inert'));
      } else assert.equal(document.querySelector('[data-worktree-popover]'), null);
      assert.equal(notification, undefined);
      await React.act(async () => histories.shift()(history));
      assert.equal(files.length, fileCount, 'late history must not start file reads');
      if (dismiss === 'close') {
        await React.act(async () => document.querySelector('[aria-haspopup="dialog"]').click());
        assert.equal(histories.length, 1, 'reopening during exit starts only one fresh Git read');
        assert.ok(document.querySelector('[data-state="open"]'));
      }
    } finally {
      await React.act(async () => root.unmount());
      reader.dispose();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
      dom.window.close();
    }
  });
}
test('popover follows Session edges below tabs, including sidebar resize and narrow windows', () => {
  const dom = new JSDOM('<header><div data-conversation-header-leading></div><button></button></header>');
  let resized;
  let disconnected = false;
  dom.window.ResizeObserver = class {
    constructor(callback) { resized = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const header = dom.window.document.querySelector('header');
  let box = { left: 240, right: 1000, bottom: 120, height: 80 };
  header.getBoundingClientRect = () => box;
  let style;
  const dispose = placement.observePopoverPlacement(header.querySelector('button'), (value) => { style = value; });
  assert.deepEqual(style, { left: 732, top: 132, width: 256, maxHeight: 624 });
  box = { ...box, right: 700 };
  resized();
  assert.equal(style.left, 432, 'right sidebar opening moves the panel with the Session edge');
  box = { ...box, left: 0, right: 240, bottom: 160 };
  resized();
  assert.deepEqual(style, { left: 12, top: 172, width: 216, maxHeight: 584 });
  box = { ...box, bottom: 100 };
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(style.top, 112, 'header height changes move the panel below all tabs');
  header.remove();
  resized();
  assert.equal(style, undefined, 'missing Session geometry must not fall back to the trigger');
  dispose();
  assert.equal(disconnected, true);
  dom.window.close();
});
const record = { workspaceId: 'w', worktreeId: 'tree', branch: 'topic', baseBranch: 'main', absolutePath: '/repo/tree', status: 'active' };
const view = { workspaceId: 'w', knownSessionIds: ['s'], readiness: { status: 'ready' }, worktrees: [record],
  bindings: [{ workspaceId: 'w', worktreeId: 'tree', sessionId: 's', status: 'active' }] };
test('popover target never borrows another Session or Workspace relationship', () => {
  const select = selection.selectPopoverTarget;
  assert.deepEqual(select(view, 's'), { kind: 'worktree', record });
  assert.equal(select(view, 'other').kind, 'unbound');
  assert.equal(select({ ...view, bindings: [] }, 's').kind, 'unbound');
  assert.equal(select({ ...view, bindings: [] }, 's', true).kind, 'main');
  assert.equal(select({ ...view, bindings: [{ ...view.bindings[0], status: 'detached' }] }, 's').kind, 'detached');
  assert.equal(select({ ...view, bindings: [{ ...view.bindings[0], workspaceId: 'other' }] }, 's').kind, 'failed');
  assert.equal(select({ ...view, readiness: { status: 'workspaceMissing' } }, 's').kind, 'missing');
  assert.equal(select({ ...view, worktrees: [{ ...record, health: 'repair' }] }, 's').kind, 'missing');
});

test('production popover toggles accessibly, stays open during conversation, and preserves reads', async () => {
  const dom = new JSDOM('<header><div data-conversation-header-leading></div><div id="root"></div></header><button id="outside">Outside</button>', { url: 'https://dsh.test' });
  dom.window.ResizeObserver = class { observe() {} disconnect() {} };
  dom.window.document.querySelector('header').getBoundingClientRect = () =>
    ({ left: 200, right: 1000, bottom: 100, height: 80 });
  const { document } = dom.window;
  dom.window.localStorage.setItem('clutch-dsh-worktree.popover-open', 'false');
  const timers = new Map();
  const exits = new Map();
  const nativeTimeout = dom.window.setTimeout.bind(dom.window);
  const nativeClearTimeout = dom.window.clearTimeout.bind(dom.window);
  let exitId = -1;
  dom.window.setTimeout = (callback, delay) => {
    if (delay !== 220) return nativeTimeout(callback, delay);
    exits.set(exitId, callback);
    return exitId--;
  };
  dom.window.clearTimeout = (id) => {
    if (exits.has(id)) exits.delete(id);
    else nativeClearTimeout(id);
  };
  let timerId = 0;
  dom.window.setInterval = (callback, delay) => {
    assert.equal(delay, 60_000);
    timers.set(++timerId, callback);
    return timerId;
  };
  dom.window.clearInterval = (id) => timers.delete(id);
  const tick = () => React.act(async () => { for (const callback of [...timers.values()]) callback(); });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    Node: dom.window.Node, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  let listener;
  let resolveRead;
  let slow = true;
  let gitState = { status: 'loading' };
  let expanded;
  let editor;
  let savedInput;
  let syncProps;
  let syncInput;
  let dashboard;
  let dashboardListener;
  const dashboardStore = {
    getSnapshot: () => dashboard,
    subscribe: (listener) => { dashboardListener = listener; return () => { dashboardListener = undefined; }; },
  };
  const invalidations = [];
  const watches = new Map();
  let nextWatch = 0;
  const { WorktreePopover } = await load('WorktreePopover.tsx', {
    react: React, 'react/jsx-runtime': jsx, 'react-dom': { createPortal },
    '@deepseek-ai/dsh-client-ui-primitives': {
      Tooltip: ({ children }) => children,
      MenuSurface: React.forwardRef((props, ref) => React.createElement('div', { ...props, ref })),
      Button: ({ children, onClick, disabled }) => React.createElement('button', { onClick, disabled }, children),
    },
    '../dsh-icons.js': {
      IconBranchOutline16: () => null,
      IconLoadingOutline16: () => React.createElement('span', { 'data-loading-icon': true }),
      IconRefreshOutline16: () => React.createElement('span', { 'data-reload-icon': true }),
    },
    './popover-target.js': selection,
    './popover-placement.js': placement,
    './worktree-popover.css': { default: {} },
    './WorktreeDashboard.js': { useWorktreeBaselineSync: (props) => {
      syncProps = props;
      const [syncOpen, setSyncOpen] = React.useState(false);
      return { setSyncOpen, syncPending: false, syncDialog: syncOpen
        ? React.createElement('div', { role: 'dialog', 'data-sync-dialog': true },
          React.createElement('button', { onClick: () => setSyncOpen(false) }, 'cancel')) : null };
    }, WorktreeBaselineEditor: (props) => {
      editor = props;
      return React.createElement('button', { 'data-baseline-pencil': true });
    } },
    './git/WorktreeGitOverview.js': {
      useWorktreeGitOverview: () => gitState,
      WorktreeGitOverviewValue: ({ metric }) => React.createElement('span', null, metric),
    },
  });
  let context = { status: 'ready', workspaceId: 'w', sessionId: 's', workspaceTitle: 'Repo',
    value: { kind: 'worktree', workspaceId: 'w', worktreeId: 'tree' } };
  const props = { sessionId: 's', useWorktreeContext: (select) => select(context), t: (key) => key,
    dashboardStore,
    manager: {
      updateWorktreeBaseBranch: async (input) => { savedInput = input; return input.baseBranch; },
      syncWorktreeBaseline: async (input) => { syncInput = input; return { status: 'dispatched', sessionId: 'sync-session' }; },
    },
    viewReader: { invalidate: (id) => invalidations.push(id), read: () => slow
      ? new Promise((resolve) => { resolveRead = resolve; }) : Promise.resolve(view) },
    subscribeChanges: (fn) => { listener = fn; return () => { listener = undefined; }; },
    refreshContext: async () => {}, openDashboard() {}, openSession() {},
    expand: (...args) => { expanded = args; dashboard = {}; dashboardListener(); },
  };
  const root = createRoot(document.getElementById('root'));
  const render = () => React.act(async () => root.render(React.createElement(WorktreePopover, props)));
  const button = () => document.querySelector('[aria-haspopup="dialog"]');
  const open = () => React.act(async () => button().click());
  try {
    await render();
    assert.ok(document.querySelector('[role="dialog"]'), 'default is open');
    assert.equal(timers.size, 1);
    await tick();
    assert.equal(invalidations.length, 1, 'initial pending read suppresses the polling tick');
    assert.notEqual(document.activeElement.getAttribute('role'), 'dialog', 'default opening does not steal focus');
    const rows = () => [...document.querySelectorAll('[data-popover-metric]')].map((row) => row.dataset.popoverMetric);
    assert.deepEqual(rows(), ['workingTree', 'aheadBehind', 'committed']);
    assert.ok(document.querySelector('[data-loading-icon]'));
    assert.equal(document.querySelectorAll('[data-popover-placeholder]').length, 5);
    assert.ok(!document.querySelector('[role="dialog"]').textContent.includes('popover.loading'));
    const rowElements = [...document.querySelectorAll('[data-popover-metric]')];
    await React.act(async () => resolveRead(view));
    assert.ok(document.querySelector('[data-loading-icon]'), 'spinner lasts through Git loading after Workspace read');
    gitState = { status: 'ready', history: {} };
    await render();
    slow = false;
    assert.ok(document.querySelector('[data-reload-icon]'));
    assert.equal(document.querySelectorAll('[data-popover-placeholder]').length, 0);
    const readyRows = [...document.querySelectorAll('[data-popover-metric]')];
    assert.deepEqual(rows(), ['workingTree', 'aheadBehind', 'committed'], 'sync action keeps the three-row layout');
    assert.equal(readyRows[0], rowElements[0]);
    assert.equal(readyRows[2], rowElements[2]);
    await React.act(async () => document.querySelector('[data-popover-metric="aheadBehind"]').click());
    assert.ok(document.querySelector('[data-sync-dialog]'));
    assert.equal(expanded, undefined, 'ahead/behind opens sync without navigating to Dashboard');
    assert.equal(syncInput, undefined, 'opening the dialog does not dispatch a task');
    await React.act(async () => syncProps.onSyncBaseline('merge', 'main', 'sync-request'));
    assert.deepEqual(syncInput, {
      workspaceId: 'w', worktreeId: 'tree', strategy: 'merge', baseBranch: 'main', requestId: 'sync-request',
    });
    await React.act(async () => document.querySelector('[data-sync-dialog] button').click());
    assert.ok(document.querySelector('[role="dialog"]').textContent.includes('topic→main'));
    assert.ok(document.querySelector('[data-worktree-summary="tree"]'));
    assert.equal(document.querySelector('[aria-label="dialog.close"]'), null);
    assert.ok(!document.querySelector('[role="dialog"]').textContent.includes('/repo/tree'));
    assert.equal(button().getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('[aria-label="dashboard.openSidebar"]'), null);
    assert.deepEqual(invalidations, ['w']);
    const contentBeforeTick = document.querySelector('[data-worktree-summary]');
    await tick();
    assert.equal(invalidations.length, 2, 'idle polling invalidates only the current Workspace');
    assert.strictEqual(document.querySelector('[data-worktree-summary]'), contentBeforeTick);
    assert.equal(document.querySelectorAll('[data-popover-placeholder]').length, 0);
    await tick();
    assert.equal(invalidations.length, 3, 'fast completed reads do not leave polling locked');
    assert.equal(editor.iconOnly, true);
    await React.act(async () => editor.onSave('release', 'main'));
    assert.deepEqual(savedInput, { workspaceId: 'w', worktreeId: 'tree', baseBranch: 'release', expectedBaseBranch: 'main' });
    assert.ok(document.querySelector('[role="dialog"]').textContent.includes('topic→release'));
    slow = true;
    await React.act(async () => document.querySelector('[data-popover-refresh]').click());
    assert.ok(document.querySelector('[data-loading-icon]'));
    assert.equal(document.querySelector('[data-popover-refresh]').disabled, true);
    const pendingInvalidations = invalidations.length;
    await tick();
    assert.equal(invalidations.length, pendingInvalidations, 'slow Workspace reads never overlap with polling');
    assert.equal(document.querySelector('[data-popover-metric="aheadBehind"]').disabled, true,
      'refreshing comparison cannot start synchronization');
    assert.ok(document.querySelector('[data-worktree-summary="tree"]'), 'ready content stays while reading');
    assert.equal(document.querySelectorAll('[data-popover-placeholder]').length, 0, 'refresh retains ready metrics');
    gitState = { status: 'ready', refreshing: true, history: {} };
    await React.act(async () => resolveRead(view));
    assert.ok(document.querySelector('[data-loading-icon]'), 'spinner includes pending Git file reads');
    await tick();
    assert.equal(invalidations.length, pendingInvalidations, 'pending Git reads also suppress polling');
    gitState = { status: 'ready', history: {} };
    await render();
    assert.ok(document.querySelector('[data-reload-icon]'));
    slow = false;
    await React.act(async () => listener({ workspaceId: 'w' }));
    props.manager = { ...props.manager,
      startGitWatch: async (input) => {
        const id = String(++nextWatch);
        watches.set(id, { input });
        return id;
      },
      watchGitChanges: (id, revision, signal) => new Promise((resolve, reject) => {
        watches.get(id).notify = () => resolve(revision + 1);
        watches.get(id).idle = () => resolve(revision);
        watches.get(id).signal = signal;
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
      stopGitWatch: async (id) => { watches.delete(id); return null; },
    };
    await render();
    assert.equal(watches.size, 1);
    assert.deepEqual([...watches.values()][0].input, { workspaceId: 'w', worktreeId: 'tree' });
    const beforeEvent = invalidations.length;
    const preserved = document.querySelector('[data-worktree-summary]');
    await React.act(async () => [...watches.values()][0].notify());
    assert.equal(invalidations.length, beforeEvent + 1, 'filesystem event refreshes the target');
    assert.strictEqual(document.querySelector('[data-worktree-summary]'), preserved);
    assert.equal(document.querySelectorAll('[data-popover-placeholder]').length, 0);
    await React.act(async () => [...watches.values()][0].idle());
    assert.equal(invalidations.length, beforeEvent + 1, 'empty notification wait does not read Git');
    slow = true;
    await React.act(async () => [...watches.values()][0].notify());
    await React.act(async () => [...watches.values()][0].notify());
    await React.act(async () => [...watches.values()][0].notify());
    assert.equal(invalidations.length, beforeEvent + 2, 'events never overlap an active read');
    slow = false;
    await React.act(async () => resolveRead(view));
    assert.equal(invalidations.length, beforeEvent + 3, 'events during reads queue one reconciliation');
    const watchSignal = [...watches.values()][0].signal;
    const modal = document.createElement('div'); modal.setAttribute('role', 'dialog'); document.body.append(modal);
    await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'nested modal owns Escape');
    modal.remove();
    await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(button().getAttribute('aria-expanded'), 'false');
    assert.equal(document.activeElement, button());
    assert.equal(watches.size, 0, 'Escape releases filesystem watches');
    assert.equal(watchSignal.aborted, true, 'Escape aborts notification wait');
    await open();
    await React.act(async () => document.getElementById('outside').dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true })));
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'conversation clicks keep the panel visible');
    await React.act(async () => document.getElementById('outside').focus());
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'conversation focus keeps the panel visible');
    await open();
    assert.equal(button().getAttribute('aria-expanded'), 'false', 'header button closes the panel');
    assert.equal(timers.size, 0, 'closing clears the interval');
    assert.equal(watches.size, 0, 'closing releases filesystem watches');
    assert.equal(exits.size, 1, 'only a bounded visual exit timer remains');
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('clutch-dsh-worktree.popover-closed-sessions')), ['s']);
    await React.act(async () => document.querySelector('[data-state="closing"]')
      .dispatchEvent(new dom.window.Event('animationend', { bubbles: true })));
    assert.equal(document.querySelector('[data-worktree-popover]'), null, 'exit animation releases the visual panel');
    assert.equal(exits.size, 0, 'animationend also cancels the fallback timer');
    await React.act(async () => root.render(null));
    await render();
    assert.equal(button().getAttribute('aria-expanded'), 'false', 'closed preference survives remount');
    await open();
    await React.act(async () => document.querySelector('[data-popover-metric]').click());
    assert.deepEqual(expanded, ['s', 'git', 'w', 'tree']);
    assert.equal(button().getAttribute('aria-expanded'), 'false');
    assert.equal(document.querySelector('[role="dialog"]'), null, 'Dashboard hides the portal');
    assert.equal(timers.size, 0, 'Dashboard clears the interval');
    assert.equal(watches.size, 0, 'Dashboard releases filesystem watches');
    assert.deepEqual(JSON.parse(dom.window.localStorage.getItem('clutch-dsh-worktree.popover-closed-sessions')), []);
    await React.act(async () => { dashboard = undefined; dashboardListener(); });
    assert.ok(document.querySelector('[role="dialog"]'), 'returning to Session restores the open preference');
    assert.equal(timers.size, 1, 'returning creates exactly one fresh interval');
    assert.equal(watches.size, 1, 'returning starts one filesystem watch');
    context = { ...context, sessionId: 'new' }; props.sessionId = 'new';
    await React.act(async () => document.getElementById('outside').focus());
    await render();
    assert.ok(document.querySelector('[role="dialog"]'), 'Session switch preserves open state');
    assert.equal(timers.size, 1, 'Session switch replaces rather than accumulates intervals');
    assert.equal(document.activeElement.id, 'outside', 'Session switch must not steal focus');
    props.sessionId = 's'; context = { ...context, sessionId: 's' };
    await render();
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'returning Session keeps open state');
    context = { ...context, value: { kind: 'main', workspaceId: 'w' } };
    props.viewReader.read = async () => ({ ...view, bindings: [] });
    await render();
    assert.deepEqual(rows(), ['workingTree'], 'Local only shows live changes');
    assert.equal(document.querySelector('[data-baseline-pencil]'), null);
    assert.equal(document.querySelector('[role="separator"]'), null);
    await open();
    props.sessionId = 'next'; context = { ...context, sessionId: 'next' };
    await render();
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'a different Session defaults to open');
    props.sessionId = 's'; context = { ...context, sessionId: 's' };
    await render();
    assert.equal(button().getAttribute('aria-expanded'), 'false', 'returning to a marked Session stays closed');
    // Close eleven distinct Sessions; the oldest marker must be evicted.
    for (let index = 0; index < 11; index++) {
      props.sessionId = 'session-' + index; context = { ...context, sessionId: props.sessionId };
      await render();
      assert.equal(button().getAttribute('aria-expanded'), 'true');
      await open();
    }
    const marks = () => JSON.parse(dom.window.localStorage.getItem('clutch-dsh-worktree.popover-closed-sessions'));
    assert.deepEqual(marks(), Array.from({ length: 10 }, (_, index) => 'session-' + (index + 1)));
    await open();
    assert.ok(!marks().includes('session-10'), 'manual opening removes its marker');
    props.sessionId = 'session-0'; context = { ...context, sessionId: props.sessionId };
    await render();
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'evicted Session is exposed again');
    await open();
    await React.act(async () => { for (const callback of [...exits.values()]) callback(); });
    assert.equal(document.querySelector('[data-worktree-popover]'), null, 'fallback removes the panel when animationend is absent');
    assert.equal(exits.size, 0);
    await open();
    dom.window.matchMedia = () => ({ matches: true });
    await open();
    assert.equal(document.querySelector('[data-worktree-popover]'), null, 'reduced motion skips exit retention');
    assert.equal(exits.size, 0);
    await React.act(async () => {
      dom.window.localStorage.setItem('clutch-dsh-worktree.popover-closed-sessions', '[]');
      dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'clutch-dsh-worktree.popover-closed-sessions' }));
    });
    assert.equal(button().getAttribute('aria-expanded'), 'true', 'cross-tab marker removal opens the Session');
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  }
});


test('Git overview retains same-baseline metrics and rejects late results after baseline replacement', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const facts = await import('../lib/client/dashboard/git/git-facts.js');
  const { useWorktreeGitOverview } = await load('git/WorktreeGitOverview.tsx', {
    react: React, 'react/jsx-runtime': jsx,
    '../../../contract/index.js': { WORKTREE_GIT_WORKING_TREE: 'working-tree' },
    './git-facts.js': facts, './GitLineStats.js': {}, './GitCommitStats.js': {},
    '../dashboard.css': { default: {} },
  });
  const requests = [];
  const fileRequests = [];
  const manager = {
    listWorktreeCommits: (input) => new Promise((resolve) => requests.push({ input, resolve })),
    listWorktreeCommitFiles: async (input) => { fileRequests.push(input); return { files: [] }; },
  };
  let state;
  let baseline = 'main';
  let refreshKey = 0;
  let local = false;
  function Probe() {
    state = useWorktreeGitOverview({ manager, workspaceId: 'w', worktreeId: local ? 'main' : 'tree',
      defaultBaselineBranch: local ? undefined : baseline, refreshKey, workingTreeOnly: local });
    return null;
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  const render = () => React.act(async () => root.render(React.createElement(Probe)));
  try {
    await render();
    assert.equal(state.status, 'loading');
    await React.act(async () => requests[0].resolve({ commits: [], behind: 3, ahead: 1 }));
    assert.equal(state.history.behind, 3);
    refreshKey++;
    await render();
    assert.equal(state.status, 'ready');
    assert.equal(state.refreshing, true);
    assert.equal(state.history.behind, 3);
    baseline = 'release';
    await render();
    assert.equal(state.status, 'loading', 'old baseline evidence cannot enable sync');
    await React.act(async () => requests[2].resolve({ commits: [], behind: 0, ahead: 4 }));
    assert.equal(state.history.behind, 0);
    await React.act(async () => requests[1].resolve({ commits: [], behind: 99, ahead: 0 }));
    assert.equal(state.history.behind, 0, 'late old baseline response must be ignored');
    assert.equal(state.refreshing, undefined);
    const historyReads = requests.length;
    local = true;
    await render();
    assert.equal(state.status, 'ready');
    assert.deepEqual(state.workingTreeFiles, []);
    assert.equal(requests.length, historyReads, 'Local does not request comparison history');
    assert.deepEqual(fileRequests.at(-1), { workspaceId: 'w', worktreeId: 'main', commit: 'working-tree' });
  } finally {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
    dom.window.close();
  }
});
