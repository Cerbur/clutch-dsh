import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { resolveDashboardRecord } from '../lib/client/dashboard/dashboard-selection.js';
import {
  concealDashboardBackground,
  mountDashboardOverlay,
} from '../lib/client/dashboard/dashboard-overlay.js';
import { en, zh } from '../lib/client/locales.js';

const record = {
  workspaceId: 'repo',
  worktreeId: 'wt',
  branch: 'feat/payment-refactor',
  currentBranch: 'feat/payment-refactor',
  absolutePath: '/tmp/repo with spaces/支付',
  status: 'active',
  source: 'plugin',
  health: 'ready',
};
const selection = { workspaceId: 'repo', worktreeId: 'wt', sessionId: 'current' };

test('dashboard follows the selected Worktree, ready refreshes, and native navigation', () => {
  const resolve = (
    target = selection,
    mode = 'worktree',
    session = 'current',
    ids = ['repo'],
    rows = [record],
  ) => resolveDashboardRecord(target, mode, session, ids, rows);
  assert.equal(resolve(), record);
  const refreshed = { ...record, branch: 'renamed', absolutePath: '/updated', status: 'removed' };
  assert.equal(resolve(selection, 'worktree', 'current', ['repo'], [refreshed]), refreshed);
  assert.equal(resolve(selection, 'workspace-session'), undefined);
  assert.equal(resolve(selection, 'worktree', 'other'), undefined);
  assert.equal(resolve(selection, 'worktree', 'current', []), undefined);
  assert.equal(resolve(selection, 'worktree', 'current', ['repo'], []), undefined);
  assert.equal(resolve({ ...selection, workspaceId: 'other' }), undefined);
  assert.equal(
    resolveDashboardRecord(
      { ...selection, sessionId: undefined },
      'worktree',
      undefined,
      ['repo'],
      [record],
    ),
    record,
  );
});

// Match the existing source-handler regressions: execute production JSX handlers
// with a minimal hook scheduler; no DSH state or browser data is needed.
const source = await readFile(
  new URL('../src/client/dashboard/WorktreeDashboard.tsx', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function renderHarness(writeClipboard) {
  const state = [];
  const effects = [];
  let cursor = 0;
  let pending = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
        },
      ];
    },
    useRef(initial) {
      return react.useState({ current: initial })[0];
    },
    useId: () => 'dashboard',
    useLayoutEffect() {},
    useEffect(effect, deps) {
      const index = cursor++;
      if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
        pending.push(() => {
          effects[index]?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
  const exports = {};
  new Function('require', 'exports', output)(
    (name) =>
      ({
        react,
        'react/jsx-runtime': { jsx, jsxs: jsx },
        '@deepseek-ai/dsh-client-ui-primitives': { writeClipboard },
        './dashboard-overlay.js': {},
        './dashboard.css': { default: {} },
      })[name] ?? {},
    exports,
  );
  let props = { record, workspaceTitle: 'Payments', t: (key) => en[key], onClose() {} };
  return {
    render(next = {}) {
      props = { ...props, ...next };
      cursor = 0;
      pending = [];
      const node = exports.WorktreeDashboard(props);
      for (const effect of pending) effect();
      return node;
    },
    dispose() {
      for (const effect of effects) effect?.cleanup?.();
    },
  };
}

function findAll(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...[node.props?.children].flat(Infinity).flatMap((child) => findAll(child, predicate)),
  ];
}
const byRole = (node, role) => findAll(node, (item) => item.props?.role === role);
const copyButton = (node) =>
  findAll(node, (item) => item.props?.['aria-label'] === en['worktree.copyPath'])[0];
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('dashboard renders real identity and explicit placeholders in both languages', () => {
  const harness = renderHarness(async () => true);
  for (const locale of [en, zh]) {
    const node = harness.render({
      t: (key) => {
        assert.ok(locale[key], key);
        return locale[key];
      },
    });
    assert.equal(findAll(node, (item) => item.type === 'h1')[0].props.children, record.branch);
    assert.ok(
      findAll(node, (item) => item.type === 'code').some(
        (item) => item.props.children === record.absolutePath,
      ),
    );
    assert.equal(byRole(node, 'tab').length, 5);
    assert.ok(findAll(node, (item) => item.type === 'button' && item.props.disabled).length >= 9);
  }
  harness.dispose();
});

test('copy uses the complete cwd, coalesces pending clicks, and reports boolean failure', async () => {
  const calls = [];
  let complete;
  const harness = renderHarness((value) => {
    calls.push(value);
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const button = copyButton(harness.render());
  button.props.onClick();
  button.props.onClick();
  assert.deepEqual(calls, [record.absolutePath]);
  assert.equal(copyButton(harness.render()).props.disabled, true);
  complete(false);
  await tick();
  assert.equal(byRole(harness.render(), 'alert')[0].props.children, en['dashboard.copyFailed']);
  copyButton(harness.render()).props.onClick();
  complete(true);
  await tick();
  assert.equal(byRole(harness.render(), 'status')[0].props.children, en['dashboard.copied']);
  harness.dispose();
});

test('copy rejection is visible and results for a replaced cwd are ignored', async () => {
  let reject;
  const harness = renderHarness(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  copyButton(harness.render()).props.onClick();
  reject(new Error('denied'));
  await tick();
  assert.equal(byRole(harness.render(), 'alert').length, 1);
  copyButton(harness.render()).props.onClick();
  harness.render({ record: { ...record, absolutePath: '/another' } });
  reject(new Error('late failure'));
  await tick();
  assert.equal(byRole(harness.render(), 'alert').length, 0);
  assert.notEqual(byRole(harness.render(), 'status')[0].props.children, en['dashboard.copied']);
  harness.dispose();
});

test('tabs switch panels, keyboard selection wraps, and Escape closes the dashboard', () => {
  const harness = renderHarness(async () => true);
  let closed = 0;
  let focused;
  const oldDocument = globalThis.document;
  globalThis.document = {
    getElementById: (id) => ({
      focus: () => {
        focused = id;
      },
    }),
  };
  try {
    let node = harness.render({ onClose: () => closed++ });
    byRole(node, 'tab')[1].props.onClick();
    node = harness.render();
    assert.equal(byRole(node, 'tabpanel')[0].props['aria-labelledby'], 'dashboard-git');
    assert.equal(byRole(node, 'tab')[1].props.tabIndex, 0);
    byRole(node, 'tab')[1].props.onKeyDown({ key: 'End', preventDefault() {} });
    node = harness.render();
    assert.equal(focused, 'dashboard-settings');
    byRole(node, 'tab')[4].props.onKeyDown({ key: 'ArrowRight', preventDefault() {} });
    node = harness.render();
    assert.equal(byRole(node, 'tab')[0].props['aria-selected'], true);
    node.props.onKeyDown({ key: 'Escape', stopPropagation() {} });
    assert.equal(closed, 1);
  } finally {
    globalThis.document = oldDocument;
    harness.dispose();
  }
});

class FakeElement {
  constructor() {
    this.attributes = new Map();
    const styles = new Map();
    this.style = {
      getPropertyValue: (key) => styles.get(key)?.[0] ?? '',
      getPropertyPriority: (key) => styles.get(key)?.[1] ?? '',
      setProperty: (key, value, priority = '') => styles.set(key, [value, priority]),
      removeProperty: (key) => styles.delete(key),
    };
    this.rect = { left: 0, right: 1200, width: 1200, height: 800 };
    this.isConnected = true;
  }
  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  removeAttribute(key) {
    this.attributes.delete(key);
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

test('background restoration preserves existing visibility, inert, and aria attributes', () => {
  const element = new FakeElement();
  element.style.setProperty('visibility', 'collapse', 'important');
  element.setAttribute('aria-hidden', 'false');
  const restore = concealDashboardBackground(element);
  assert.equal(element.style.getPropertyValue('visibility'), 'hidden');
  assert.equal(element.getAttribute('inert'), '');
  restore();
  assert.equal(element.style.getPropertyValue('visibility'), 'collapse');
  assert.equal(element.style.getPropertyPriority('visibility'), 'important');
  assert.equal(element.getAttribute('aria-hidden'), 'false');
  assert.equal(element.getAttribute('inert'), null);
});

test('overlay tracks Sidebar width, restores on anchor loss, and cleans observers on disposal', () => {
  const globals = [
    'HTMLElement',
    'ResizeObserver',
    'MutationObserver',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];
  const saved = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));
  const observers = [];
  let pending;
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
  }
  Object.assign(globalThis, {
    HTMLElement: FakeElement,
    ResizeObserver: Observer,
    MutationObserver: Observer,
    requestAnimationFrame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      pending = undefined;
    },
  });
  try {
    const [frame, sidebar, center, right, overlay, surface] = Array.from(
      { length: 6 },
      () => new FakeElement(),
    );
    frame.firstElementChild = sidebar;
    sidebar.nextElementSibling = center;
    center.nextElementSibling = right;
    right.nextElementSibling = overlay;
    overlay.parentElement = frame;
    surface.closest = () => overlay;
    sidebar.rect.right = 280;
    let placement;
    const dispose = mountDashboardOverlay(surface, (next) => {
      placement = next;
    });
    assert.equal(placement.left, 280);
    assert.equal(placement.width, 920);
    assert.equal(center.getAttribute('inert'), '');
    sidebar.rect.right = 64;
    observers[0].callback();
    pending();
    assert.equal(placement.width, 1136);
    right.nextElementSibling = undefined;
    observers[1].callback();
    pending();
    assert.equal(placement, undefined);
    assert.equal(center.getAttribute('inert'), null);
    assert.equal(right.style.getPropertyValue('visibility'), '');
    right.nextElementSibling = overlay;
    observers[1].callback();
    pending();
    assert.equal(center.getAttribute('inert'), '');
    dispose();
    assert.equal(center.getAttribute('inert'), null);
    assert.ok(observers.every((observer) => observer.disconnected));
  } finally {
    Object.assign(globalThis, saved);
  }
});

