import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as React from 'react';
import * as JSX from 'react/jsx-runtime';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as slotModule from '@deepseek-ai/dsh-client-ui-slots';
import * as cordis from '@deepseek-ai/cordis';
import * as store from '@deepseek-ai/dsh-client-store';
import ts from 'typescript';

async function load(file, modules = {}) {
  const compiled = ts.transpileModule(await readFile(new URL(`../src/client/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  const dependencies = { react: React, 'react/jsx-runtime': JSX, ...modules };
  new Function('require', 'exports', compiled)((name) => {
    assert.ok(dependencies[name], name);
    return dependencies[name];
  }, exports);
  return exports;
}

for (const nativeScroller of [true, false]) test(`workspace slot preserves shell, state and lifecycle with section scroller ${nativeScroller}`, async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const { document } = dom.window;
  const previous = { window: globalThis.window, document: globalThis.document,
    act: globalThis.IS_REACT_ACT_ENVIRONMENT, resize: globalThis.ResizeObserver };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const observers = new Set();
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() {}
    disconnect() { observers.delete(this); }
  };
  const { workspaceSidebarMount } = await load('view/sidebar-workspace-slot.tsx', {
    '../worktree.css': { default: { workspaceSeat: 'seat' } },
  });
  const { useWorkspaceRegionGeometry } = await load('view/workspace-region-geometry.ts');
  const bound = [];
  const scroller = { bindScrollerRef: (element) => bound.push(element) };
  const useSectionScroller = () => scroller;
  const { SurfaceContent } = await load('surface/components/SurfaceContent.tsx', {
    '../../view/worktree-error-copy.js': {},
    '../../worktree.css': { default: {} },
    '../shared.js': {},
    './WorkspaceTree.js': { WorkspaceTree: () => React.createElement('div', { 'data-tree': true }, 'ready worktree content') },
    './OverlayScrollbar.js': { OverlayScrollbar: () => React.createElement('div', { 'data-legacy-scrollbar': true }) },
    './NotificationToasts.js': { NotificationToasts: () => null },
    '../notification-queue.js': {},
  });
  let mounts = 0;
  let geometry;
  function Surface({ sidebarSeat }) {
    React.useEffect(() => { mounts++; }, []);
    geometry = useWorkspaceRegionGeometry(sidebarSeat);
    const contentRef = React.useRef(null);
    return React.createElement(React.Fragment, null,
      React.createElement('div', { 'data-dashboard': true }, 'dashboard'),
      sidebarSeat && createPortal(React.createElement('div', { hidden: geometry.collapsed },
        React.createElement(SurfaceContent, {
          source: { forkRecoverySnapshot: { pending: [] }, workspaces: { items: [] }, sessions: { byId: {} } },
          props: { sidebarSeat, t: (key) => key },
          lifecycle: {}, mutation: {}, session: {},
          read: { readState: { status: 'ready' } },
          expansion: { contentRef },
        })), sidebarSeat.element));
  }
  const { WorktreeOverlay } = await load('overlay/WorktreeOverlay.tsx', {
    '../WorktreeSurface.js': { WorktreeSurface: Surface },
    '../context/WorktreeHeroContext.js': { WorktreeHeroContext: () => null },
  });
  const entries = [];
  const nativeRenderer = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-renderer/client')), 'utf8');
  new Function('window', nativeRenderer)({ __ModuleLoader__: { load: (entry) => entries.push(entry) } });
  const modules = { '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-client-ui-slots': slotModule, react: React, 'react/jsx-runtime': JSX,
    'react-dom': { createPortal }, 'react-dom/client': { createRoot } };
  const runtime = entries[0].factory((name) => { assert.ok(modules[name], name); return modules[name]; });
  const ctx = new cordis.Context();
  const registryFiber = ctx.plugin(runtime.SlotRegistry);
  await registryFiber.await();
  const slots = ctx.slots;
  const Native = () => React.createElement('div', { 'data-native': true }, 'native workspaces');
  const declare = () => slots.register({ name: 'root', children: {
    'sidebar.workspaces': { kind: 'single', scope: 'root' },
  } }, () => null);
  let disposeOwner = declare();
  const native = () => slots.register({ name: 'sidebar.workspaces', children: {
    'native.row.action': { kind: 'list', scope: 'root' },
  } }, Native);
  native();
  // Actual SlotRegistry owns election and declaration-aware injection. The small
  // renderer below supplies the same public owner props as SidebarRoot.
  const mountWorkspaceSidebar = workspaceSidebarMount(slots);
  let mode = 'workspace-session';
  let wide = true;
  let revision = 0;
  const subscribe = (notify) => slots.subscribe('sidebar.workspaces', () => { revision++; notify(); });
  function Browser() {
    React.useSyncExternalStore(subscribe, () => revision);
    const entry = slots.entriesOfSlot('sidebar.workspaces').at(0);
    return entry ? React.createElement(entry.component, {
      wide, expandSidebar() {}, useSectionScroller: nativeScroller ? useSectionScroller : undefined, ...entry.inject?.(),
    }) : null;
  }
  const manager = {};
  function App() {
    return React.createElement(React.Fragment, null,
      React.createElement('nav', { 'data-menu': true }, 'New Session / Office / More'),
      React.createElement('section', { 'data-region': true }, React.createElement(Browser)),
      React.createElement('footer', null, 'Worktree'),
      React.createElement('main', { 'data-conversation': true }, 'native conversation'),
      React.createElement('div', { 'data-shell-overlay': true }, React.createElement(WorktreeOverlay, {
        useStore: (select) => select({ viewMode: mode }), available: true, manager, mountWorkspaceSidebar,
        useWorkspaceDirectoryFlow: (select) => select({ available: false, owner: {} }),
        cancelDirectoryFlow() {}, renderSlot: () => null,
      })));
  }
  const root = createRoot(document.getElementById('root'));
  const render = () => React.act(async () => { root.render(React.createElement(App)); });
  try {
    await render();
    const menu = document.querySelector('[data-menu]');
    const conversation = document.querySelector('[data-conversation]');
    const dashboard = document.querySelector('[data-dashboard]');
    assert.ok(document.querySelector('[data-native]'));
    mode = 'worktree';
    await render();
    assert.ok(document.querySelector('[data-region] [data-tree]'));
    assert.equal(document.querySelector('[data-native]'), null);
    assert.equal(slots.entries('sidebar.workspaces').length, 2);
    assert.ok(slots.spec('native.row.action'));
    const seat = document.querySelector('[data-worktree-workspace-seat]');
    seat.getBoundingClientRect = () => ({ width: 280, height: 400 });
    await React.act(async () => { for (const observer of observers) observer.callback(); });
    assert.equal(geometry.bounds.ready, true);
    const readyTree = document.querySelector('[data-tree]');
    assert.strictEqual(bound.at(-1), nativeScroller ? document.querySelector('[data-worktree-scrollport]') : undefined, 'native handoff binds the content scroller, not the seat');
    assert.equal(seat.dataset.worktreeSectionScroller, nativeScroller ? 'true' : undefined);
    assert.equal(document.querySelector('[data-worktree-scrollport]').hasAttribute('data-worktree-native-scroll'), nativeScroller);
    assert.equal(document.querySelector('[data-legacy-scrollbar]') !== null, !nativeScroller, 'native contract must not mount a second scrollbar');
    seat.getBoundingClientRect = () => ({ width: 0, height: 0 });
    await React.act(async () => { for (const observer of observers) observer.callback(); });
    assert.equal(geometry.bounds.ready, false);
    assert.strictEqual(document.querySelector('[data-tree]'), readyTree);
    seat.getBoundingClientRect = () => ({ width: 280, height: 400 });
    await React.act(async () => { for (const observer of observers) observer.callback(); });
    assert.equal(geometry.bounds.ready, true);
    wide = false;
    await render();
    assert.equal(geometry.bounds.ready, false);
    assert.equal(document.querySelector('[data-tree]').closest('[hidden]')?.hidden, true);
    assert.equal(bound.at(-1), nativeScroller ? null : undefined, 'fold releases the native scroller');
    wide = true;
    await render();
    assert.equal(geometry.bounds.ready, true);
    assert.strictEqual(document.querySelector('[data-tree]'), readyTree);
    await React.act(async () => { disposeOwner(); });
    assert.equal(document.querySelector('[data-tree]'), null);
    assert.equal(observers.size, 0);
    assert.equal(bound.at(-1), nativeScroller ? null : undefined, 'slot withdrawal releases the native scroller');
    await React.act(async () => { disposeOwner = declare(); native(); });
    assert.ok(document.querySelector('[data-tree]'));
    mode = 'workspace-session';
    await render();
    assert.ok(document.querySelector('[data-native]'));
    assert.equal(slots.entries('sidebar.workspaces').length, 1);
    assert.ok(slots.spec('native.row.action'));
    assert.equal(observers.size, 0);
    mode = 'worktree';
    await render();
    assert.equal(mounts, 1, 'mode/fold changes do not remount the shared data and Dashboard owner');
    assert.strictEqual(document.querySelector('[data-menu]'), menu);
    assert.strictEqual(document.querySelector('[data-conversation]'), conversation);
    assert.strictEqual(document.querySelector('[data-dashboard]'), dashboard);
    assert.equal(menu.getAttribute('style'), null);
    assert.equal(conversation.getAttribute('inert'), null);
    await React.act(async () => root.unmount());
    assert.equal(slots.entriesOfSlot('sidebar.workspaces').at(0).component, Native);
    assert.equal(observers.size, 0);
  } finally {
    await React.act(async () => root.unmount());
    disposeOwner();
    await registryFiber.dispose();
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.act;
    globalThis.ResizeObserver = previous.resize;
  }
});
