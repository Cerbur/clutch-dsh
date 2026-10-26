import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import { en } from '../lib/client/locales.js';
import * as selection from '../lib/client/dashboard/dashboard-selection.js';
import * as acquisition from '../lib/client/dashboard/worktree-acquisition-facts.js';

const source = await readFile(new URL('../src/client/dashboard/WorktreeDashboard.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Execute the installed native Modal and its real keyboard/focus helpers unchanged.
// CSS and unrelated primitive exports need no browser bundler for this regression.
const primitives = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-primitives')), 'utf8');
const parsed = ts.createSourceFile('primitives.js', primitives, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map();
for (const statement of parsed.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement.getText(parsed));
  if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
    if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, `const ${declaration.getText(parsed)};`);
  }
}
const { act } = React;
const names = ['releases', 'navigationKeys', 'layers', 'focusable', 'observeComposition', 'focusWithoutRing', 'useModalLayer', 'Modal'];
for (const name of names) assert.ok(declarations.has(name), 'native Modal declaration: ' + name);
const nativeModal = new Function('React', 'ReactDOM', 'jsxRuntime', `
  const { useRef, useLayoutEffect } = React;
  const { createPortal } = ReactDOM;
  const { jsx, jsxs, Fragment } = jsxRuntime;
  const css$17 = {};
  const clsx = (...values) => values.filter(Boolean).join(' ');
  const IconCloseOutlineRegular = () => null;
  ${names.map((name) => declarations.get(name)).join('\n')}
  return Modal;
`)(React, ReactDOM, jsx);

function dashboard() {
  const exports = {};
  const noop = () => null;
  const icons = new Proxy({}, { get: () => noop });
  const modules = {
    react: React, 'react/jsx-runtime': jsx,
    '@deepseek-ai/dsh-client-ui-primitives': {
      Modal: nativeModal,
      Button: ({ children, variant, ...props }) => { void variant; return React.createElement('button', props, children); },
      Tooltip: ({ children }) => children,
      StateDot: noop,
    },
    '../dsh-icons.js': icons,
    './dashboard-selection.js': selection,
    './worktree-acquisition-facts.js': acquisition,
    './dashboard-overlay.js': { mountDashboardOverlay: () => () => {} },
    './OpenInAppButton.js': { OpenInAppButton: noop },
    './WorktreeInstructions.js': { WorktreeInstructions: noop },
    './git/WorktreeGitPanel.js': { WorktreeGitPanel: noop },
    './git/WorktreeGitOverview.js': {
      useWorktreeGitOverview: () => ({ status: 'unavailable' }), WorktreeGitOverviewValue: noop,
    },
    '../settings/ToolSettings.js': { ToolSettings: noop },
    '../branch/GitBranchSelector.js': { GitBranchPicker: noop },
    '../surface/components/NotificationToasts.js': { NotificationToasts: noop },
    './dashboard.css': { default: {} },
  };
  new Function('require', 'exports', compiled)((name) => modules[name] ?? {}, exports);
  return exports.WorktreeDashboard;
}

async function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost' });
  const previous = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('app'));
  const Dashboard = dashboard();
  let closed = 0;
  let finish;
  const opened = [];
  const pending = new Promise((resolve) => { finish = resolve; });
  function Owner() {
    const [visible, setVisible] = React.useState(true);
    return visible && React.createElement(Dashboard, {
      record: { workspaceId: 'ws', worktreeId: 'wt', branch: 'feature', currentBranch: 'feature',
        baseBranch: 'main', absolutePath: '/test/worktree', source: 'plugin', status: 'active', health: 'ready' },
      workspaceTitle: 'Test', t: (key) => en[key],
      sessions: { ids: [], byId: {} }, sessionPresentations: {}, sessionIds: [], actionPending: false,
      onClose: () => { closed++; setVisible(false); },
      onSyncBaseline: () => pending, onOpenSession: (id) => opened.push(id),
    });
  }
  await act(async () => { root.render(React.createElement(Owner)); });
  const document = dom.window.document;
  const surface = () => document.querySelector('[data-worktree-dashboard]');
  const dialog = () => document.querySelector('[role="dialog"]');
  const click = async (element) => {
    assert.ok(element, 'click target exists');
    await act(async () => { element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  };
  const escape = async (element) => {
    assert.ok(element, 'keyboard target exists');
    const event = new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => { element.dispatchEvent(event); });
    return event;
  };
  return { document, surface, dialog, click, escape, opened, finish, get closed() { return closed; },
    async dispose() {
      await act(async () => { root.unmount(); });
      dom.window.close();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

test('native portal Escape closes only the sync modal and restores Dashboard Escape after reopening', async () => {
  const h = await fixture();
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      await h.click(h.document.querySelector('[data-dashboard-action="sync-baseline"]'));
      assert.ok(h.dialog());
      assert.equal(h.surface().contains(h.dialog()), false, 'Modal is a real portal outside the Dashboard DOM');
      const event = await h.escape(h.dialog().querySelector('input'));
      assert.equal(h.closed, 0, 'portal bubbling must not close Dashboard');
      assert.equal(event.defaultPrevented, true, 'native document modal listener owns Escape');
      assert.equal(h.dialog(), null);
    }
    await h.escape(h.surface());
    assert.equal(h.closed, 1);
    assert.equal(h.surface(), null);
  } finally { await h.dispose(); }
});

test('pending native portal Escape cannot dismiss either surface or retire Session navigation', async () => {
  const h = await fixture();
  try {
    await h.click(h.document.querySelector('[data-dashboard-action="sync-baseline"]'));
    await h.click([...h.dialog().querySelectorAll('button')].find((button) => button.textContent === en['dashboard.sync.create']));
    assert.ok([...h.dialog().querySelectorAll('button')].some((button) => button.disabled));
    const event = await h.escape(h.dialog());
    assert.equal(h.closed, 0, 'pending Escape must not close Dashboard');
    assert.equal(event.defaultPrevented, true);
    assert.ok(h.dialog(), 'busy closeSync retains the modal');
    await h.escape(h.surface());
    assert.equal(h.closed, 0, 'Dashboard also yields while the modal owns keyboard input');
    await act(async () => { h.finish({ sessionId: 'created', status: 'dispatched' }); });
    assert.deepEqual(h.opened, ['created']);
    assert.equal(h.dialog(), null);
    await h.escape(h.surface());
    assert.equal(h.closed, 1);
  } finally { await h.dispose(); }
});

test('a native capture-dismissed menu keeps priority over the sync portal and Dashboard', async () => {
  const h = await fixture();
  try {
    await h.click(h.document.querySelector('[data-dashboard-action="sync-baseline"]'));
    const menu = h.document.createElement('div');
    menu.setAttribute('role', 'menu');
    h.dialog().appendChild(menu);
    const dismiss = (event) => { event.preventDefault(); menu.remove(); };
    h.document.addEventListener('keydown', dismiss, { capture: true, once: true });
    await h.escape(menu);
    assert.equal(h.closed, 0);
    assert.ok(h.dialog(), 'one Escape closes only the menu');
    await h.escape(h.dialog());
    assert.equal(h.dialog(), null);
    assert.ok(h.surface());
  } finally { await h.dispose(); }
});
