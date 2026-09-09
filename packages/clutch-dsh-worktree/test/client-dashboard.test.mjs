import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  createMainWorktreeRecord,
  isMainWorktreeId,
  resolveDashboardRecord,
} from '../lib/client/dashboard/dashboard-selection.js';
import {
  concealDashboardBackground,
  mountDashboardOverlay,
} from '../lib/client/dashboard/dashboard-overlay.js';
import { en, zh } from '../lib/client/locales.js';
import { dashboardSessionIds } from '../lib/client/dashboard/dashboard-sessions.js';
import { vscodeFolderUrl } from '../lib/client/dashboard/vscode-url.js';
import { sessionDisplayLabel } from '../lib/client/session/session-view.js';

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
        './dashboard-selection.js': { isMainWorktreeId, createMainWorktreeRecord, resolveDashboardRecord },
        './vscode-url.js': { vscodeFolderUrl },
        './OpenInAppButton.js': {
          OpenInAppButton: ({ path, t }) => jsx('a', {
            className: 'dashboardButton',
            href: vscodeFolderUrl(path),
            children: t('dashboard.openEditor'),
          }),
        },
        '../session/session-view.js': { sessionDisplayLabel },
        './dashboard.css': { default: {} },
      })[name] ?? {},
    exports,
  );
  let props = {
    record,
    workspaceTitle: 'Payments',
    t: (key) => en[key],
    onClose() {},
    sessions: { ids: [], byId: {} },
    sessionIds: [],
    actionPending: false,
    onOpenSession() {},
  };
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

test('dashboard membership follows live bindings, archive/blank visibility, and retained order', () => {
  const sessions = {
    ids: ['one', 'two', 'archived', 'blank', 'current', 'other'],
    current: 'current',
    byId: { blank: { blank: true }, current: { blank: true } },
  };
  const binding = (sessionId, extra = {}) => ({
    workspaceId: 'repo',
    worktreeId: 'wt',
    sessionId,
    status: 'active',
    ...extra,
  });
  const bindings = [
    ...['one', 'two', 'archived', 'blank', 'current', 'missing'].map((id) => binding(id)),
    binding('other', { workspaceId: 'different' }),
  ];
  assert.deepEqual(
    dashboardSessionIds(record, sessions, bindings, ['archived'], ['two', 'one', 'missing']),
    ['two', 'one', 'current'],
  );
  assert.deepEqual(
    dashboardSessionIds(
      record,
      sessions,
      bindings.filter((b) => b.sessionId !== 'one'),
      ['archived'],
    ),
    ['two', 'current'],
  );
  assert.deepEqual(dashboardSessionIds(record, sessions, [], []), []);
  assert.deepEqual(
    dashboardSessionIds(record, sessions, [binding('two', { status: 'detached' })], []),
    ['two'],
  );
});

test('VS Code folder URLs preserve paths and escape URL delimiters', () => {
  for (const path of ['/tmp/repo with spaces/支付', '/tmp/a#b?c%20', '/tmp/back\\slash']) {
    const url = new URL(vscodeFolderUrl(path));
    assert.equal(url.protocol, 'vscode:');
    assert.equal(url.hostname, 'file');
    assert.equal(decodeURIComponent(url.pathname), path);
    assert.equal(url.search, '');
    assert.equal(url.hash, '');
  }
  assert.equal(vscodeFolderUrl('C:\\Projects\\a b'), 'vscode://file/C:/Projects/a%20b');
});

test('dashboard actions delegate, pending disables mutations, and Sessions displays all live rows', () => {
  const harness = renderHarness(async () => true);
  const calls = [];
  const ids = Array.from({ length: 7 }, (_, i) => 'session-' + i);
  const sessions = {
    ids,
    current: ids[0],
    byId: Object.fromEntries(ids.map((id) => [id, { displayTitle: id + ' title' }])),
  };
  let node = harness.render({
    sessions,
    sessionIds: ids,
    onCreateSession: () => calls.push('session'),
    onCreateWorktree: () => calls.push('worktree'),
    onArchiveWorktree: () => calls.push('archive'),
    onOpenSession: (id) => calls.push(id),
  });
  const rows = (node) => findAll(node, (item) => item.props?.['data-dashboard-session']);
  assert.equal(rows(node).length, 5);
  assert.equal(rows(node)[0].props['aria-current'], 'page');
  rows(node)[0].props.onClick();
  for (const action of ['create-session', 'create-worktree', 'archive-worktree']) {
    const button = findAll(node, (item) => item.props?.['data-dashboard-action'] === action)[0];
    assert.equal(button.props.disabled, false);
    button.props.onClick();
  }
  assert.deepEqual(calls, [ids[0], 'session', 'worktree', 'archive']);
  assert.equal(
    findAll(node, (item) => item.type === 'a')[0].props.href,
    vscodeFolderUrl(record.absolutePath),
  );
  node = harness.render({ actionPending: true });
  assert.ok(
    findAll(node, (item) => item.props?.['data-dashboard-action']).every(
      (item) => item.props.disabled,
    ),
  );
  byRole(node, 'tab')[2].props.onClick();
  assert.equal(rows(harness.render()).length, 7);
  node = harness.render({
    sessionIds: [ids[6]],
    sessions: { ...sessions, byId: { [ids[6]]: { displayTitle: 'Updated' } } },
  });
  assert.equal(rows(node).length, 1);
  assert.ok(
    findAll(node, (item) => item.type === 'span' && item.props.children === 'Updated').length,
  );
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

test('Surface connects dashboard actions to existing Session and dialog domains with eligibility gates', async () => {
  const surfaceSource = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(surfaceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const { createNumberedWorktreeName } = await import('../lib/client/view/worktree-view.js');
  const calls = [];
  let selected = selection;
  let target = record;
  const workspace = { workspaceId: 'repo', title: 'Repo' };
  const sourceState = {
    mode: 'worktree',
    currentSessionId: 'current',
    workspaceIds: ['repo'],
    workspaces: { items: [workspace] },
    sessions: { ids: ['current'], current: 'current', byId: {} },
    archivedSessionIds: [],
    bounds: { ready: false },
  };
  const mutation = {
    actionPending: false,
    setActionError: (value) => calls.push(['error', value]),
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    if (name === 'react')
      return {
        useState: () => [
          selected,
          (next) => {
            selected = next;
          },
        ],
        useCallback: (fn) => fn,
        useEffect() {},
      };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('dashboard-selection.js')) return { resolveDashboardRecord, createMainWorktreeRecord, isMainWorktreeId };
    if (name.endsWith('dashboard-sessions.js')) return { dashboardSessionIds };
    if (name.endsWith('worktree-view.js')) return { createNumberedWorktreeName };
    if (name.endsWith('view-mode.js')) return { workspaceSessionIds: (workspaces, workspaceId, ids) => ids ?? [] };
    if (name.endsWith('WorktreeDashboard.js')) return { WorktreeDashboard: 'Dashboard' };
    if (name.endsWith('.css')) return { default: {} };
    const hook = name.match(/\/(use\w+)\.js$/)?.[1];
    if (hook)
      return {
        [hook]: (input) => {
          if (hook === 'useSurfaceSources') return sourceState;
          if (hook === 'useSurfaceRefresh')
            return {
              viewByWorkspace: new Map([
                [
                  'repo',
                  {
                    worktrees: [target],
                    branches: [{ name: record.branch }],
                    bindings: [{ workspaceId: 'repo', worktreeId: 'wt', sessionId: 'current' }],
                  },
                ],
              ]),
            };
          if (hook === 'useSurfaceMutation') return mutation;
          if (hook === 'useLifecycleState')
            return { setWorktreeRemoval: (value) => calls.push(['archive', value]) };
          if (hook === 'useSessionOrdering') return { orderedSessionIdsByAccount: new Map() };
          if (hook === 'useSessionActions')
            return {
              createSession: (value) => calls.push(['createSession', value]),
              openWorkspaceSession: (workspaceId, sessionId) => {
                calls.push(['open', workspaceId, sessionId]);
                input.props.openSession(sessionId);
              },
            };
          if (hook === 'useWorktreeRegistration')
            return { openWorktreeCreator: (...args) => calls.push(['creator', ...args]) };
          return {};
        },
      };
    return {};
  }, exports);
  const render = () => {
    selected = selection;
    return findAll(
      exports.WorktreeSurface({
        t: (key) => en[key],
        createSessionForWorktree() {},
        openSession: (id) => calls.push(['nativeOpen', id]),
      }),
      (item) => item.type === 'Dashboard',
    )[0].props;
  };
  let props = render();
  assert.deepEqual(props.sessionIds, ['current']);
  props.onCreateWorktree();
  assert.deepEqual(calls.shift(), [
    'creator',
    workspace,
    { baseBranch: record.branch, newBranch: record.branch + '-2' },
  ]);
  assert.equal(selected, selection);
  props.onArchiveWorktree();
  assert.deepEqual(calls.shift(), ['archive', record]);
  assert.deepEqual(calls.shift(), ['error', undefined]);
  props.onCreateSession();
  assert.equal(selected, undefined);
  assert.deepEqual(calls.shift(), [
    'createSession',
    { workspaceId: 'repo', worktreeId: 'wt', cwd: record.absolutePath },
  ]);
  render().onOpenSession('current');
  assert.equal(selected, undefined);
  assert.deepEqual(calls.splice(0), [
    ['open', 'repo', 'current'],
    ['nativeOpen', 'current'],
  ]);
  for (const changes of [
    { status: 'removed' },
    { health: 'repair' },
    { health: 'recovery-needed' },
  ]) {
    target = { ...record, ...changes };
    props = render();
    assert.equal(props.onCreateSession, undefined);
    assert.equal(props.onCreateWorktree, undefined);
  }
  assert.equal(props.onArchiveWorktree, undefined);
  target = { ...record, currentBranch: null, health: 'branch-drift' };
  assert.equal(render().onCreateWorktree, undefined);
  assert.equal(typeof render().onCreateSession, 'function');
  target = record;
  mutation.actionPending = true;
  props = render();
  props.onCreateSession();
  props.onCreateWorktree();
  props.onArchiveWorktree();
  assert.deepEqual(calls, []);
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

test('Main (Local) dashboard record resolution, session membership, and Surface integration', () => {
  const ws = { workspaceId: 'ws-main', path: '/workspaces/main-app' };
  const mainRec = createMainWorktreeRecord(ws, 'master');
  assert.equal(isMainWorktreeId(mainRec.worktreeId), true);
  assert.equal(mainRec.workspaceId, 'ws-main');
  assert.equal(mainRec.branch, 'master');
  assert.equal(mainRec.absolutePath, '/workspaces/main-app');

  // resolveDashboardRecord supports mainRecord
  const selMain = { workspaceId: 'ws-main', worktreeId: 'main', sessionId: 's1' };
  const resolved = resolveDashboardRecord(selMain, 'worktree', 's1', ['ws-main'], [], mainRec);
  assert.equal(resolved?.worktreeId, mainRec.worktreeId);
  assert.equal(resolved?.branch, 'master');

  // dashboardSessionIds handles main worktree sessions (unbound sessions)
  const sessions = {
    ids: ['s1', 's2', 's3', 's4'],
    byId: {
      s1: { sessionId: 's1' },
      s2: { sessionId: 's2' },
      s3: { sessionId: 's3' },
      s4: { sessionId: 's4' },
    },
  };
  const bindings = [
    { workspaceId: 'ws-main', worktreeId: 'wt-1', sessionId: 's2' },
  ];
  const mainSessions = dashboardSessionIds(
    mainRec,
    sessions,
    bindings,
    ['s4'], // s4 archived
    ['s3', 's1'],
    ['s1', 's2', 's3', 's4'], // all workspace sessions
  );
  // s2 is bound to wt-1, s4 is archived -> only s1 and s3 belong to main
  assert.deepEqual(mainSessions, ['s3', 's1']);
});

test('OpenInAppController reads apps, remembers choice, and launches via host routes', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/open-in-app/apps')) {
      return {
        ok: true,
        json: async () => ({ apps: ['cursor', 'vscode', 'webstorm'] }),
      };
    }
    if (String(url).endsWith('/open-in-app/open')) {
      return { ok: true };
    }
    return { ok: false, status: 404 };
  };

  const { OpenInAppController } = await import('../lib/client/dashboard/open-in-app-controller.js');
  const controller = new OpenInAppController(fetcher);
  assert.equal(controller.apps, null);

  await controller.load();
  assert.deepEqual(controller.apps, ['cursor', 'vscode', 'webstorm']);
  assert.ok(controller.iconUrl('cursor').includes('/open-in-app/icon/cursor'));

  controller.choose('cursor');
  assert.equal(controller.choice, 'cursor');

  await controller.launch('cursor', '/path/to/worktree');
  assert.equal(requests.length, 2);
  assert.ok(requests[1].url.endsWith('/open-in-app/open'));
  assert.equal(requests[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].init.body), { app: 'cursor', path: '/path/to/worktree' });
});


