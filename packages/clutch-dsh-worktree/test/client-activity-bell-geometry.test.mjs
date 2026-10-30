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
import { useSidebarOverlayGeometry } from '../lib/client/overlay/sidebar-overlay-geometry.js';

async function loadSource(file, dependencies) {
  const source = await readFile(new URL('../src/client/' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const exports = {};
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(name in dependencies, name);
    return dependencies[name];
  }, exports);
  return exports;
}

for (const failure of ['missing anchor', 'invalid bounds']) {
  test(`production Sidebar header closes its bell on ${failure} without collapse or automatic reopen`, async () => {
    const dom = new JSDOM(`
      <div id="frame">
        <div id="sidebar" data-pane="sidebar">
          <button id="new">New Session</button>
          <div id="native" aria-hidden="false">Native ready content</div>
          <footer id="footer"><button data-worktree-mode-action>Worktree</button></footer>
        </div>
        <div id="overlay" data-shell-overlay><div id="root"></div></div>
      </div>`);
    const { document } = dom.window;
    const frames = new Map();
    const resizes = [];
    let nextFrame = 0;
    const originals = new Map();
    for (const [key, value] of Object.entries({
      window: dom.window,
      document,
      Node: dom.window.Node,
      HTMLElement: dom.window.HTMLElement,
      MutationObserver: dom.window.MutationObserver,
      ResizeObserver: class {
        constructor(callback) { resizes.push(callback); }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
      requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; },
      cancelAnimationFrame: (id) => frames.delete(id),
      IS_REACT_ACT_ENVIRONMENT: true,
    })) {
      originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    }
    const rect = (top, bottom) => ({ top, bottom, left: 0, right: 280, width: 280, height: bottom - top });
    const anchor = document.getElementById('new');
    const footer = document.getElementById('footer');
    const native = document.getElementById('native');
    let valid = true;
    for (const id of ['frame', 'sidebar', 'overlay']) {
      document.getElementById(id).getBoundingClientRect = () => rect(0, 800);
    }
    anchor.getBoundingClientRect = () => rect(80, 120);
    footer.getBoundingClientRect = () => rect(740, 800);
    document.getElementById('overlay').getBoundingClientRect = () => rect(0, valid ? 800 : 0);
    const timers = new Set();
    dom.window.setInterval = (callback) => { timers.add(callback); return callback; };
    dom.window.clearInterval = (callback) => timers.delete(callback);
    const keydowns = new Set();
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = (name, listener, ...args) => {
      if (name === 'keydown') keydowns.add(listener);
      add(name, listener, ...args);
    };
    document.removeEventListener = (name, listener, ...args) => {
      if (name === 'keydown') keydowns.delete(listener);
      remove(name, listener, ...args);
    };
    const icon = () => null;
    const dependencies = {
      react: React,
      'react/jsx-runtime': jsx,
      'react-dom': { createPortal },
      '@deepseek-ai/dsh-client-ui-primitives': {
        MenuSurface: React.forwardRef((props, ref) => React.createElement('div', { ...props, ref })),
        StateDot: icon,
        Tooltip: ({ children }) => children,
        useAnchoredPosition: () => ({ left: 12, top: 44 }),
        useDismissOnOutsidePointer() {},
      },
      '../../dsh-icons.js': {
        IconCloseFill14: icon, IconCloseOutline16: icon,
        IconProjectAddOutline16: icon, IconSearchOutline16: icon,
      },
      '../shared.js': { cx: () => '', IconCollapseAll16: icon },
      '../../session/active-sessions.js': activity,
      '../../session/session-view.js': sessionView,
      '../../session/session-labels.js': labels,
      '../../worktree.css': { default: {} },
    };
    dependencies['./SessionActivityBell.js'] = await loadSource('surface/components/SessionActivityBell.tsx', dependencies);
    const { SurfaceHeader } = await loadSource('surface/components/SurfaceHeader.tsx', dependencies);
    const sessions = { ids: ['run'], byId: { run: { displayTitle: 'Retained task', running: true } } };
    const workspaces = { items: [{ workspaceId: 'repo', title: 'Repository', sessionIds: ['run'] }] };
    const presentations = sessionView.deriveSessionPresentationIndex(sessions);
    const read = { readState: { status: 'ready', views: [{ workspaceId: 'repo', worktrees: [], bindings: [] }] } };
    const readyFacts = JSON.stringify({ sessions, workspaces, presentations, read });
    let geometry;
    function SidebarHeader() {
      geometry = useSidebarOverlayGeometry(true);
      return React.createElement('aside', { ref: geometry.ref },
        React.createElement(SurfaceHeader, {
          source: { ...geometry, workspaceIds: ['repo'], sessions, workspaces, sessionPresentations: presentations },
          expansion: { searchExpanded: false, searchRoot: { current: null }, searchInput: { current: null }, searchQuery: '' },
          props: { t: (key) => key },
          read,
          mutation: {},
        }));
    }
    const root = createRoot(document.getElementById('root'));
    const flushGeometry = async () => React.act(async () => {
      await Promise.resolve(); // Deliver real DOM mutation records before draining animation frames.
      for (const callback of resizes) callback();
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback();
    });
    const bell = () => document.querySelector('[data-session-activity]');
    const click = async () => React.act(() => bell().click());
    try {
      await React.act(() => root.render(React.createElement(SidebarHeader)));
      assert.equal(geometry.bounds.ready, true);
      assert.equal(geometry.collapsed, false);
      await click();
      assert.ok(document.querySelector('[role="dialog"]'));
      assert.equal(timers.size, 1);
      assert.equal(keydowns.size, 1);
      if (failure === 'missing anchor') anchor.remove();
      else valid = false;
      await flushGeometry();
      assert.equal(geometry.bounds.ready, false);
      assert.equal(geometry.collapsed, false, 'geometry degradation is independent of native collapse');
      assert.ok(document.querySelector('[role="dialog"]') === null, 'portaled bell must close with its Sidebar');
      assert.equal(timers.size, 0, 'closed bell releases its display timer');
      assert.equal(keydowns.size, 0, 'closed bell releases its Escape listener');
      assert.equal(native.style.visibility, '');
      assert.equal(native.style.opacity, '');
      assert.equal(native.getAttribute('aria-hidden'), 'false');
      assert.equal(native.textContent, 'Native ready content');
      if (failure === 'missing anchor') document.getElementById('sidebar').prepend(anchor);
      else valid = true;
      await flushGeometry();
      assert.equal(geometry.bounds.ready, true);
      assert.equal(bell().getAttribute('aria-expanded'), 'false');
      assert.ok(document.querySelector('[role="dialog"]') === null, 'geometry recovery waits for a new user click');
      assert.equal(timers.size, 0);
      assert.equal(keydowns.size, 0);
      assert.equal(JSON.stringify({ sessions, workspaces, presentations, read }), readyFacts);
      await click();
      assert.match(document.querySelector('[role="dialog"]').textContent, /Retained task/);
      assert.equal(timers.size, 1);
      assert.equal(keydowns.size, 1);
    } finally {
      await React.act(() => root.unmount());
      assert.equal(timers.size, 0);
      assert.equal(keydowns.size, 0);
      dom.window.close();
      for (const [key, descriptor] of originals) {
        if (descriptor === undefined) delete globalThis[key];
        else Object.defineProperty(globalThis, key, descriptor);
      }
    }
  });
}
