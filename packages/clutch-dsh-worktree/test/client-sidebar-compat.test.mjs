import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

async function loadSource(file, dependencies = {}) {
  const source = await readFile(new URL('../src/client/' + file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  new Function('require', 'exports', outputText)((name) => dependencies[name] ?? {}, exports);
  return exports;
}

// Commit effects separately from render, including updates scheduled by effects.
function hooks() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  let dirty = false;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[index],
        (value) => {
          const next = typeof value === 'function' ? value(slots[index]) : value;
          if (!Object.is(next, slots[index])) dirty = true;
          slots[index] = next;
        },
      ];
    },
    useRef(initial) {
      return react.useState({ current: initial })[0];
    },
    useMemo(calculate, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        slots[index] = { deps, value: calculate() };
      }
      return slots[index].value;
    },
    useCallback(fn, deps) {
      return react.useMemo(() => fn, deps);
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
        pending.push(() => {
          old?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
      }
    },
    useLayoutEffect(effect, deps) {
      react.useEffect(effect, deps);
    },
    useSyncExternalStore(_subscribe, snapshot) {
      return snapshot();
    },
  };
  return {
    react,
    render(fn) {
      let result;
      for (let pass = 0; pass < 20; pass++) {
        cursor = 0;
        pending = [];
        dirty = false;
        result = fn();
        for (const effect of pending) effect();
        if (!dirty) return result;
      }
      throw new Error('Render did not settle');
    },
    dispose() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}

async function assertSidebarGeometry(t, platform) {
  const h = hooks();
  const mutations = [];
  const resizes = [];
  const frames = [];
  class Element {
    attributes = new Map();
    declarations = new Map();
    style = {
      getPropertyValue: (name) => this.declarations.get(name) ?? '',
      getPropertyPriority: () => '',
      setProperty: (name, value) => this.declarations.set(name, value),
      removeProperty: (name) => this.declarations.delete(name),
    };
    width = 280;
    top = 0;
    bottom = 800;
    getBoundingClientRect() {
      return {
        width: this.width,
        height: this.bottom - this.top,
        top: this.top,
        bottom: this.bottom,
      };
    }
    hasAttribute(name) {
      return (
        this.attributes.has(name) || (name === 'data-sidebar-collapsed' && this.collapsed === true)
      );
    }
    querySelectorAll() {
      return this.buttons ?? [];
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name, value) {
      this.attributes.set(name, value);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
  }
  const frame = new Element();
  const sidebar = new Element();
  const root = new Element();
  const overlay = new Element();
  const surface = new Element();
  const button = new Element();
  button.top = 100;
  const label = platform === 'Web English' ? 'New Session' : '新会话';
  const accessibleLabel = platform === 'Web English' ? 'New session' : '新建会话';
  // Native shortcut glyphs share textContent with the visible label.
  button.textContent = label + '⌘N';
  button.attributes.set('aria-label', accessibleLabel);
  const footer = new Element();
  footer.top = 740;
  const chrome = new Element();
  chrome.bottom = 80;
  chrome.attributes.set('data-window-drag', '');
  // Web's clickable brand is also a New Session shortcut. macOS has no
  // brand button; both platforms retain the dedicated action below chrome.
  const brand = new Element();
  brand.top = 10;
  brand.textContent = 'DSH 本地构建';
  brand.attributes.set('aria-label', accessibleLabel);
  brand.parentElement = chrome;
  const panel = new Element();
  const region = new Element();
  region.attributes.set('aria-hidden', 'false');
  root.children = [chrome, button, panel, region, footer];
  for (const child of root.children) child.parentElement = root;
  root.buttons = platform === 'desktop' ? [button] : [brand, button];
  root.lastElementChild = footer;
  sidebar.firstElementChild = root;
  frame.firstElementChild = sidebar;
  overlay.parentElement = frame;
  surface.closest = () => overlay;
  function stub(name, value) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  stub('HTMLElement', Element);
  stub(
    'ResizeObserver',
    class {
      constructor(fn) {
        resizes.push(fn);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  stub(
    'MutationObserver',
    class {
      constructor(fn) {
        mutations.push(fn);
      }
      observe() {}
      disconnect() {}
    },
  );
  stub('requestAnimationFrame', (fn) => {
    frames.push(fn);
    return frames.length;
  });
  stub('cancelAnimationFrame', () => {});
  const bounds = await loadSource('overlay/overlay-bounds.ts');
  const geometry = await loadSource('overlay/sidebar-overlay-geometry.ts', {
    react: h.react,
    './overlay-bounds.js': bounds,
    '../dashboard/dashboard-overlay.js': await loadSource('dashboard/dashboard-overlay.ts'),
  });
  const render = () =>
    h.render(() => {
      const result = geometry.useSidebarOverlayGeometry(true);
      result.ref.current = surface;
      return result;
    });
  const expanded = render();
  assert.equal(
    expanded.bounds.top,
    100,
    'overlay starts at the dedicated action below the native brand and toggle',
  );
  assert.equal(expanded.bounds.height, 640);
  assert.equal(expanded.width, 280);
  assert.equal(expanded.nativeCovered, true);
  for (const child of [button, panel, region]) {
    assert.equal(child.style.getPropertyValue('visibility'), 'hidden');
    assert.equal(
      child.style.getPropertyValue('opacity'),
      '0',
      'explicit visible descendants cannot ghost through glass',
    );
    assert.equal(child.getAttribute('inert'), '');
  }
  assert.equal(chrome.getAttribute('inert'), null);
  assert.equal(chrome.style.getPropertyValue('visibility'), '');
  assert.equal(chrome.style.getPropertyValue('opacity'), '');
  assert.equal(footer.getAttribute('inert'), null);
  frame.collapsed = true;
  sidebar.width = 0;
  for (const fn of resizes) fn();
  while (frames.length) frames.shift()();
  assert.equal(render().width, 0, 'must accept zero instead of retaining the expanded width');
  assert.equal(region.getAttribute('aria-hidden'), 'false');
  assert.equal(region.style.getPropertyValue('visibility'), '');
  assert.equal(region.style.getPropertyValue('opacity'), '');
  sidebar.width = 56;
  for (const fn of resizes) fn();
  while (frames.length) frames.shift()();
  assert.equal(render().width, 56, 'the web rail keeps its own width');
  assert.equal(render().collapsed, true);
  // The semantic collapse state must also win before the width transition ends.
  sidebar.width = 180;
  for (const fn of mutations) fn();
  while (frames.length) frames.shift()();
  assert.equal(render().collapsed, true);
  frame.collapsed = false;
  sidebar.width = 320;
  for (const fn of resizes) fn();
  while (frames.length) frames.shift()();
  const reopened = render();
  assert.equal(reopened.width, 320);
  assert.equal(reopened.collapsed, false);
  // A replacement native root must release the old rows, not conceal detached content forever.
  const replacement = new Element();
  const nextButton = new Element();
  nextButton.textContent = 'New Session';
  nextButton.top = 100;
  const nextFooter = new Element();
  nextFooter.top = 740;
  replacement.buttons = [nextButton];
  replacement.lastElementChild = nextFooter;
  replacement.children = [nextButton, nextFooter];
  for (const child of replacement.children) child.parentElement = replacement;
  sidebar.firstElementChild = replacement;
  for (const fn of mutations) fn();
  while (frames.length) frames.shift()();
  render();
  assert.equal(region.getAttribute('aria-hidden'), 'false');
  assert.equal(nextButton.getAttribute('inert'), '');
  h.dispose();
  assert.equal(nextButton.getAttribute('inert'), null);
  assert.equal(nextButton.style.getPropertyValue('visibility'), '');
  assert.equal(nextButton.style.getPropertyValue('opacity'), '');
}
for (const platform of ['desktop', 'Web Chinese', 'Web English']) {
  test(platform + ' keeps native brand/toggle above Worktree and restores collapse geometry', (t) =>
    assertSidebarGeometry(t, platform),
  );
}

function find(node, type) {
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === type) return node;
  for (const child of [node.props?.children].flat()) {
    const result = find(child, type);
    if (result) return result;
  }
}

for (const target of ['main', 'wt']) {
  test(
    'one header request opens ' +
      target +
      ' Dashboard while the sidebar is closed and the first read is pending',
    async () => {
      const h = hooks();
      const source = {
        mode: 'worktree',
        currentSessionId: 'current',
        workspaceIds: ['repo'],
        workspaces: {
          items: [{ workspaceId: 'repo', path: '/repo', title: 'Repo', sessionIds: ['current'] }],
        },
        sessions: { phase: 'ready', ids: ['current'], byId: {} },
        archivedSessionIds: [],
        ref: { current: null },
        width: 0,
        collapsed: true,
        bounds: { ready: false },
      };
      let selection = { workspaceId: 'repo', worktreeId: target, sessionId: 'current' };
      const store = {
        getSnapshot: () => selection,
        subscribe: () => () => {},
        set: (next) => {
          selection = next;
        },
      };
      const read = { readState: { status: 'loading', views: [] }, viewByWorkspace: new Map() };
      const jsx = (type, props) => ({ type, props });
      const deps = {
        react: h.react,
        'react/jsx-runtime': { jsx, jsxs: jsx },
        './worktree.css': { default: {} },
        './surface/state/useSurfaceSources.js': { useSurfaceSources: () => source },
        './surface/state/useSurfaceRefresh.js': { useSurfaceRefresh: () => read },
        './surface/state/useSessionOrdering.js': {
          useSessionOrdering: () => ({ orderedSessionIdsByAccount: new Map() }),
        },
        './dashboard/WorktreeDashboard.js': { WorktreeDashboard: 'Dashboard' },
        './dashboard/DashboardRequest.js': { DashboardRequest: 'PendingDashboard' },
        './dashboard/dashboard-selection.js': await loadSource('dashboard/dashboard-selection.ts'),
        './dashboard/dashboard-navigation.js': await loadSource(
          'dashboard/dashboard-navigation.ts',
        ),
        './dashboard/dashboard-sessions.js': { dashboardSessionIds: () => ['current'] },
        './view/view-mode.js': { workspaceSessionIds: () => ['current'] },
      };
      for (const name of [
        'useDragActions',
        'useLifecycleActions',
        'useNativeActions',
        'useSessionActions',
        'useSurfaceMutation',
        'useWorktreeRegistration',
      ]) {
        deps['./surface/actions/' + name + '.js'] = { [name]: () => ({}) };
      }
      for (const name of [
        'useLifecycleState',
        'useRegistrationState',
        'useSessionExpansion',
        'useSurfaceMenus',
      ]) {
        deps['./surface/state/' + name + '.js'] = { [name]: () => ({}) };
      }
      const { WorktreeSurface } = await loadSource('WorktreeSurface.tsx', deps);
      const render = () =>
        h.render(() =>
          WorktreeSurface({ dashboardStore: store, t: (key) => key, openSession() {} }),
        );
      const initial = render();
      assert.ok(selection, 'a pending target is not a removed target');
      if (target === 'wt') {
        assert.ok(
          find(initial, 'PendingDashboard'),
          'a request has visible loading UI even with a closed sidebar',
        );
        read.readState = {
          status: 'error',
          views: [],
          error: { code: 'WORKTREE_VIEW_UNAVAILABLE', retryable: true },
        };
        assert.ok(
          find(render(), 'PendingDashboard').props.error,
          'read failure exposes retry without another header click',
        );
      }
      read.readState = { status: 'ready', views: [] };
      read.viewByWorkspace = new Map([
        [
          'repo',
          {
            workspaceId: 'repo',
            branches: [],
            bindings: [],
            worktrees: [
              {
                workspaceId: 'repo',
                worktreeId: 'wt',
                branch: 'feature',
                absolutePath: '/wt',
                status: 'active',
              },
            ],
          },
        ],
      ]);
      const tree = render();
      assert.ok(find(tree, 'Dashboard'), 'the first click must open after the read settles');
      assert.equal(source.collapsed, true, 'opening the Dashboard must not expand navigation');
      store.set({ workspaceId: 'repo', worktreeId: 'missing', sessionId: 'current' });
      render();
      assert.equal(selection, undefined, 'confirmed missing targets still close');
      h.dispose();
    },
  );
}
