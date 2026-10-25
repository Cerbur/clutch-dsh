import assert from 'node:assert/strict';
import { toWorktreeViewError } from '../lib/client/view/worktree-view.js';
import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
import ts from 'typescript';
import { FrameElement as FakeElement, appFrameFixture } from './app-frame-fixture.mjs';
import {
  createMainWorktreeRecord,
  isMainWorktreeId,
  resolveDashboardRecord,
  selectDerivedWorktrees,
  selectBaseWorktree,
} from '../lib/client/dashboard/dashboard-selection.js';
import {
  concealDashboardBackground,
  mountDashboardOverlay,
} from '../lib/client/dashboard/dashboard-overlay.js';
import { en, zh } from '../lib/client/locales.js';
import { dashboardSessionIds } from '../lib/client/dashboard/dashboard-sessions.js';
import {
  prepareDashboardNavigation,
  settlePendingDashboardNavigation,
} from '../lib/client/dashboard/dashboard-navigation.js';
import { vscodeFolderUrl } from '../lib/client/dashboard/vscode-url.js';
import { selectWorktreeAcquisitionFacts } from '../lib/client/dashboard/worktree-acquisition-facts.js';
import {
  isBlankSession,
  relativeTime,
  sessionDisplayLabel,
} from '../lib/client/session/session-view.js';
import { sessionStatusLabel, sessionTimeLabel } from '../lib/client/session/session-labels.js';
import { createWorktreeDiagnostics } from '../lib/client/settings/diagnostics.js';
import { reconcileNotifications, failureToastKey } from '../lib/client/surface/notification-queue.js';

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

test('derived Worktrees use direct saved local baselines within the same Workspace', () => {
  const child = { ...record, worktreeId: 'child', branch: 'child', baseBranch: record.branch };
  const archived = { ...child, worktreeId: 'archived', status: 'removed', health: 'cleaned',
    baseBranch: `refs/heads/${record.branch}` };
  const candidates = [
    { ...record, baseBranch: record.branch }, child, archived,
    { ...child, worktreeId: 'grandchild', baseBranch: 'child' },
    { ...child, worktreeId: 'other-workspace', workspaceId: 'other' },
    { ...child, worktreeId: 'remote', baseBranch: `refs/remotes/${record.branch}` },
    { ...child, worktreeId: 'unknown', baseBranch: undefined, baseCommit: 'abc123' },
  ];
  assert.deepEqual(selectDerivedWorktrees(record, candidates), [child, archived]);
  assert.deepEqual(selectDerivedWorktrees({ ...record, currentBranch: 'renamed' }, candidates), []);
  assert.deepEqual(selectDerivedWorktrees({ ...record, currentBranch: undefined }, candidates), [child, archived]);
  assert.deepEqual(selectDerivedWorktrees({ ...record, currentBranch: null }, candidates), []);
  assert.deepEqual(selectDerivedWorktrees({ ...record, currentHead: { kind: 'tag', name: record.branch } }, candidates), []);
  assert.deepEqual(selectDerivedWorktrees({ ...record, currentHead: { kind: 'branch', name: 'renamed' } }, candidates), []);
  assert.deepEqual(selectDerivedWorktrees(record, [{ ...child, baseBranch: 'updated' }]), []);
  assert.deepEqual(selectDerivedWorktrees(createMainWorktreeRecord({ workspaceId: 'repo', path: '/repo' }, record.branch), candidates), [candidates[0], child, archived]);
  assert.deepEqual(selectDerivedWorktrees(createMainWorktreeRecord({ workspaceId: 'repo', path: '/repo' }), candidates), []);
});

test('base navigation resolves one same-Workspace checkout or Main without guessing', () => {
  const child = { ...record, worktreeId: 'child', branch: 'child', baseBranch: record.branch };
  const main = createMainWorktreeRecord({ workspaceId: 'repo', path: '/repo' }, 'main');
  assert.equal(selectBaseWorktree(child, [child, record], main), record);
  assert.equal(selectBaseWorktree({ ...child, baseBranch: `refs/heads/${record.branch}` }, [record]), record);
  assert.equal(selectBaseWorktree({ ...child, baseBranch: 'refs/heads/main' }, [record], main), main);
  assert.equal(selectBaseWorktree(child, [record], main, 'main'), main);
  assert.equal(selectBaseWorktree({ ...child, baseBranch: undefined }, [record], main), undefined);
  assert.equal(selectBaseWorktree({ ...child, baseBranch: `refs/remotes/${record.branch}` }, [record], main), undefined);
  assert.equal(selectBaseWorktree(child, [child]), undefined);
  assert.equal(selectBaseWorktree(child, [{ ...record, workspaceId: 'other' }]), undefined);
  assert.equal(selectBaseWorktree(child, [{ ...record, currentBranch: 'moved' }]), undefined);
  assert.equal(selectBaseWorktree(child, [{ ...record, currentBranch: null }]), undefined);
  assert.equal(selectBaseWorktree(child, [{ ...record, currentBranch: undefined }]).worktreeId, record.worktreeId);
  assert.equal(selectBaseWorktree(child, [record, { ...record, worktreeId: 'duplicate', status: 'removed' }]), undefined);
  assert.equal(selectBaseWorktree({ ...child, baseBranch: 'main' }, [], { ...main, currentBranch: null }), undefined);
  assert.equal(selectBaseWorktree({ ...child, baseBranch: 'main' }, [{ ...record, currentBranch: 'main' }], main), undefined);
});

test('dashboard acquisition facts preserve management provenance and unknowns', () => {
  assert.deepEqual(
    selectWorktreeAcquisitionFacts({
      source: 'plugin',
      createdAt: '2026-09-13T01:02:03.000Z',
      baseBranch: 'main',
    }),
    {
      timestampKind: 'created',
      timestamp: '2026-09-13T01:02:03.000Z',
      baseBranch: 'main',
    },
  );
  assert.deepEqual(
    selectWorktreeAcquisitionFacts({
      source: 'external',
      importedAt: '2026-09-13T04:05:06.000Z',
    }),
    {
      timestampKind: 'imported',
      timestamp: '2026-09-13T04:05:06.000Z',
    },
  );
  assert.deepEqual(selectWorktreeAcquisitionFacts({ source: 'plugin' }), {
    timestampKind: 'created',
  });
});

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
  assert.equal(
    resolveDashboardRecord(
      { ...selection, sessionId: undefined },
      'worktree',
      'other-session',
      ['repo'],
      [record],
    ),
    record,
  );
});

test('dashboard navigation follows the Worktree head Session without creating an empty one', () => {
  assert.deepEqual(
    prepareDashboardNavigation(record, ['worktree-head', 'worktree-tail'], 'session-a'),
    {
      selection: { workspaceId: 'repo', worktreeId: 'wt', sessionId: 'worktree-head' },
      sessionIdToOpen: 'worktree-head',
    },
  );
  assert.deepEqual(
    prepareDashboardNavigation(record, ['worktree-head', 'session-a'], 'session-a'),
    {
      selection: { workspaceId: 'repo', worktreeId: 'wt', sessionId: 'session-a' },
      sessionIdToOpen: undefined,
    },
  );
  assert.deepEqual(prepareDashboardNavigation(record, ['worktree-head'], 'session-a', 'pending'), {
    selection: { workspaceId: 'repo', worktreeId: 'wt', sessionId: undefined },
    sessionIdToOpen: undefined,
    waitForSessionList: true,
  });
  const pending = {
    selection: { workspaceId: 'repo', worktreeId: 'wt', sessionId: 'worktree-head' },
    originSessionId: 'session-a',
  };
  assert.deepEqual(settlePendingDashboardNavigation(pending, 'session-a'), { kind: 'wait' });
  assert.deepEqual(settlePendingDashboardNavigation(pending, 'worktree-head'), {
    kind: 'open',
    selection: pending.selection,
  });
  assert.deepEqual(settlePendingDashboardNavigation(pending, 'unrelated-session'), {
    kind: 'clear',
  });
  const pendingWithoutOrigin = {
    selection: { workspaceId: 'repo', worktreeId: 'wt', sessionId: 'worktree-head' },
    originSessionId: undefined,
  };
  assert.deepEqual(settlePendingDashboardNavigation(pendingWithoutOrigin, undefined), {
    kind: 'wait',
  });
  assert.deepEqual(settlePendingDashboardNavigation(pendingWithoutOrigin, 'unrelated-session'), {
    kind: 'clear',
  });
  assert.deepEqual(prepareDashboardNavigation(record, [], 'session-a'), {
    selection: { workspaceId: 'repo', worktreeId: 'wt', sessionId: undefined },
    sessionIdToOpen: undefined,
  });
  assert.deepEqual(prepareDashboardNavigation(record, [], undefined), {
    selection: { workspaceId: 'repo', worktreeId: 'wt', sessionId: undefined },
    sessionIdToOpen: undefined,
  });
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
const dashboardCssSource = await readFile(
  new URL('../src/client/dashboard/dashboard.css', import.meta.url),
  'utf8',
);

const branchPickerSource = await readFile(
  new URL('../src/client/branch/GitBranchSelector.tsx', import.meta.url), 'utf8',
);

const singleSelectSource = await readFile(
  new URL('../src/client/select/SearchableSingleSelect.tsx', import.meta.url), 'utf8',
);
const notificationSource = await readFile(
  new URL('../src/client/surface/components/NotificationToasts.tsx', import.meta.url), 'utf8',
);

function renderHarness(writeClipboard, { stubBranchPicker = false, diagnostics, browserCrypto = globalThis.crypto } = {}) {
  const state = [];
  const effects = [];
  let cursor = 0;
  let pending = [];
  const publish = () => {};
  const react = {
    createContext: () => ({}),
    useContext: () => diagnostics === undefined ? undefined : publish,
    useCallback: (fn) => fn,
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
    useId: () => diagnostics === undefined ? 'dashboard' : react.useRef('notice-' + cursor).current,
    useMemo: (create) => create(),
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
  const notificationExports = {};
  if (diagnostics !== undefined) {
    const compiled = ts.transpileModule(notificationSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function('require', 'exports', compiled)((name) => ({
      react, 'react/jsx-runtime': { jsx, jsxs: jsx },
      '@deepseek-ai/dsh-client-ui-primitives': { Toast: 'toast' },
      '../notification-queue.js': { reconcileNotifications, failureToastKey },
      '../../view/worktree-error-copy.js': { formatWorktreeViewError },
      '../../settings/diagnostics.js': { worktreeDiagnostics: diagnostics },
    })[name] ?? {}, notificationExports);
  }
  const selectOutput = ts.transpileModule(singleSelectSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const selectExports = {};
  new Function('require', 'exports', selectOutput)((name) => ({
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@deepseek-ai/dsh-client-ui-primitives': { Input: (props) => jsx('input', props) },
    '../dsh-icons.js': {
      IconCheckOutline16: () => jsx('svg', { 'data-icon': 'check' }),
      IconSearchOutline16: () => jsx('svg', { 'data-icon': 'search' }),
    }, './single-select.css': { default: {} },
  })[name] ?? {}, selectExports);
  const branchSource = branchPickerSource;
  const branchOutput = ts.transpileModule(branchSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const branchExports = {};
  new Function('require', 'exports', branchOutput)((name) => ({
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@deepseek-ai/dsh-client-ui-primitives': { Input: (props) => jsx('input', props) },
    '../dsh-icons.js': {
      IconBranchOutline16: () => jsx('svg', { 'data-icon': 'branch' }),
      IconCheckOutline16: () => jsx('svg', { 'data-icon': 'check' }),
      IconSearchOutline16: () => jsx('svg', { 'data-icon': 'search' }),
    }, './git-branch.css': { default: {} }, '../select/SearchableSingleSelect.js': selectExports,
    '../surface/components/NotificationToasts.js': { ErrorToast: (props) => jsx('branch-error-toast', props) },
    '../view/worktree-view.js': { toWorktreeViewError: (error) => ({ message: error.message, retryable: true }) },
  })[name] ?? {}, branchExports);
  const exports = {};
  new Function('require', 'exports', 'globalThis', output)(
    (name) =>
      ({
        react,
        'react/jsx-runtime': { jsx, jsxs: jsx },
        '@deepseek-ai/dsh-client-ui-primitives': {
          Button: ({ children, ...props }) => jsx('button', { ...props, children }),
          IconBranchOutline16: () => jsx('svg', { 'data-icon': 'branch' }),
          IconCheckOutline16: () => jsx('svg', { 'data-icon': 'check' }),
          IconCopyOutline16: () => jsx('svg', { 'data-icon': 'copy' }),
          IconEditOutline16: () => jsx('svg', { 'data-icon': 'edit' }),
          IconSearchOutline16: () => jsx('svg', { 'data-icon': 'search' }),
          IconPanelLeftOutline16: () => jsx('svg', { 'data-icon': 'sidebar' }),
          Input: ({ children, ...props }) => jsx('input', { ...props, children }),
          Modal: ({ open, children, footer, ...props }) =>
            open
              ? jsx('div', {
                  ...props,
                  role: 'dialog',
                  children: [children, footer],
                })
              : null,
          StateDot: ({ state }) => jsx('span', { 'data-state-dot': state }),
          Tooltip: ({ children }) => children,
          writeClipboard,
        },
        '../surface/components/NotificationToasts.js': {
          NotificationToasts: notificationExports.NotificationToasts ?? (({ notices }) => jsx('toasts', { notices })),
        },
        '../settings/diagnostics.js': { worktreeDiagnostics: diagnostics },
        '../view/worktree-view.js': { toWorktreeViewError },
        '../view/worktree-error-copy.js': { formatWorktreeViewError },
        './dashboard-overlay.js': {},
        './dashboard-selection.js': { isMainWorktreeId, createMainWorktreeRecord, resolveDashboardRecord, selectDerivedWorktrees, selectBaseWorktree },
        './worktree-acquisition-facts.js': { selectWorktreeAcquisitionFacts },
        './vscode-url.js': { vscodeFolderUrl },
        './OpenInAppButton.js': {
          OpenInAppButton: ({ path, t }) => jsx('a', {
            className: 'dashboardButton',
            href: vscodeFolderUrl(path),
            children: t('dashboard.openEditor'),
          }),
        },
        './WorktreeInstructions.js': { WorktreeInstructions: 'Instructions' },
        '../settings/ToolSettings.js': { ToolSettings: 'ToolSettings' },
        './git/WorktreeGitPanel.js': { WorktreeGitPanel: 'GitPanel' },
        './git/WorktreeGitOverview.js': {
          useWorktreeGitOverview: () => ({ status: 'unavailable' }),
          WorktreeGitOverviewValue: ({ metric }) => jsx('span', {
            'data-dashboard-overview-metric': metric,
            children: metric === 'aheadBehind' ? '+3 / -1' : metric === 'committed' ? '+20 / -6' : '+12 / -4',
          }),
        },
        '../dsh-icons.js': {
          IconBranchOutline16: () => jsx('svg', { 'data-icon': 'branch' }),
          IconChevronRightOutline14: () => jsx('svg', { 'data-icon': 'chevron-right' }),
          IconCheckOutline16: () => jsx('svg', { 'data-icon': 'check' }),
          IconCopyOutline16: () => jsx('svg', { 'data-icon': 'copy' }),
          IconEditOutline16: () => jsx('svg', { 'data-icon': 'edit' }),
          IconPanelLeftOutline16: () => jsx('svg', { 'data-icon': 'sidebar' }),
          IconSearchOutline16: () => jsx('svg', { 'data-icon': 'search' }),
        },
        '../session/session-selection.js': {
          currentSessionIdFromList: (sessions) => {
            if (typeof sessions.current === 'string') return sessions.current;
            return Object.entries(sessions.byId ?? {})
              .find(([, summary]) => (summary?.retainedBy?.mainView ?? 0) > 0)?.[0];
          },
        },
        '../session/session-view.js': { isBlankSession, relativeTime, sessionDisplayLabel },
        '../session/session-labels.js': { sessionStatusLabel, sessionTimeLabel },
        './dashboard.css': { default: {} },
        '../branch/GitBranchSelector.js': stubBranchPicker
          ? { GitBranchPicker: (props) => jsx('baseline-picker', props) } : branchExports,
      })[name] ?? {},
    exports,
    { crypto: browserCrypto },
  );
  let props = {
    record,
    workspaceTitle: 'Payments',
    t: (key) => en[key],
    onClose() {},
    sessions: { ids: [], byId: {} },
    sessionPresentations: {},
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
const copyBranchTitle = (node) =>
  findAll(node, (item) => item.props?.['data-dashboard-copy'] === 'branch')[0];
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('sync dialog selects a strategy, coalesces activation and opens the admitted native Session', async () => {
  for (const strategy of ['merge', 'rebase']) {
    const harness = renderHarness(async () => true);
    const calls = [];
    let resolve;
    const result = new Promise((done) => { resolve = done; });
    let node = harness.render({ record: { ...record, baseBranch: 'main' },
      onSyncBaseline: (...args) => { calls.push(args); return result; },
      onOpenSession: (id) => calls.push(['open', id]) });
    findAll(node, (item) => item.props?.['data-dashboard-action'] === 'sync-baseline')[0].props.onClick();
    node = harness.render();
    findAll(node, (item) => item.type === 'input' && item.props.value === strategy)[0].props.onChange();
    node = harness.render();
    const create = findAll(node, (item) => item.type === 'button' && item.props.children === en['dashboard.sync.create'])[0];
    create.props.onClick();
    create.props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], strategy);
    assert.equal(calls[0][1], 'main');
    assert.ok(calls[0][2]);
    resolve({ sessionId: 'sync-session', status: 'dispatched' });
    await tick();
    assert.deepEqual(calls.at(-1), ['open', 'sync-session']);
    harness.dispose();
  }
});

test('sync works without secure-context randomUUID and handles random-source failures without locking', async () => {
  let fail = false;
  const harness = renderHarness(async () => true, { browserCrypto: {
    getRandomValues(bytes) {
      if (fail) throw new Error('random source unavailable');
      return globalThis.crypto.getRandomValues(bytes);
    },
  } });
  const requests = [];
  let node = harness.render({ record: { ...record, baseBranch: 'main' },
    onSyncBaseline: async (...args) => {
      requests.push(args);
      throw new Error('transport failed');
    } });
  const create = () => findAll(node, (item) => item.props?.children === en['dashboard.sync.create'])[0];
  findAll(node, (item) => item.props?.['data-dashboard-action'] === 'sync-baseline')[0].props.onClick();
  node = harness.render();
  fail = true;
  create().props.onClick();
  await tick();
  node = harness.render();
  assert.equal(requests.length, 0);
  assert.equal(create().props.disabled, false);
  assert.ok(findAll(node, (item) => item.type === 'toasts').some((item) => item.props.notices.length > 0));
  fail = false;
  create().props.onClick();
  await tick();
  node = harness.render();
  create().props.onClick();
  await tick();
  assert.equal(requests.length, 2);
  assert.match(requests[0][2], /^[A-Za-z0-9:_-]{1,160}$/u);
  assert.equal(requests[0][2], requests[1][2], 'transport retries retain the admission identity');
  harness.dispose();
});

test('sync retry retains request identity and partial failures preserve the created Session', async () => {
  const harness = renderHarness(async () => true);
  const requests = [];
  let node = harness.render({ record: { ...record, baseBranch: 'main' },
    onSyncBaseline: async (...args) => {
      requests.push(args);
      if (requests.length === 1) throw new Error('connection lost');
      return { sessionId: 'partial', status: 'prompt-failed', error: 'unavailable' };
    } });
  findAll(node, (item) => item.props?.['data-dashboard-action'] === 'sync-baseline')[0].props.onClick();
  node = harness.render();
  findAll(node, (item) => item.type === 'button' && item.props.children === en['dashboard.sync.create'])[0].props.onClick();
  await tick();
  node = harness.render();
  findAll(node, (item) => item.type === 'button' && item.props.children === en['dashboard.sync.create'])[0].props.onClick();
  await tick();
  node = harness.render();
  assert.equal(requests[0][2], requests[1][2]);
  assert.ok(findAll(node, (item) => item.props?.children === en['dashboard.sync.openSession']).length);
  assert.equal(findAll(node, (item) => item.props?.children === en['dashboard.sync.create']).length, 0);
  const notice = findAll(node, (item) => item.type === 'toasts')
    .flatMap((item) => item.props.notices).find((item) => item.error?.details?.sessionId === 'partial');
  assert.ok(notice, 'partial dispatch must enter shared notifications and diagnostics');
  harness.dispose();
});

for (const status of ['binding-failed', 'model-failed', 'title-failed', 'reporting-failed', 'prompt-failed']) {
  test(`partial sync ${status} publishes localized recovery and retains diagnostics after Dashboard closes`, async () => {
    for (const locale of [en, zh]) {
      const diagnostics = createWorktreeDiagnostics();
      const harness = renderHarness(async () => true, { diagnostics });
      const opened = [];
      let dispatched = 0;
      const t = (key) => locale[key];
      let node = harness.render({ record: { ...record, baseBranch: 'main' }, t,
        onSyncBaseline: async () => {
          dispatched++;
          return { sessionId: 'retained-session', status, error: 'RAW_NATIVE_FAILURE' };
        },
        onOpenSession: (id) => opened.push(id),
      });
      findAll(node, (item) => item.props?.['data-dashboard-action'] === 'sync-baseline')[0].props.onClick();
      node = harness.render();
      findAll(node, (item) => item.props?.children === locale['dashboard.sync.create'])[0].props.onClick();
      await tick();
      node = harness.render();
      const entry = diagnostics.getSnapshot().find((item) => item.error?.details?.sessionId === 'retained-session');
      assert.ok(entry, 'the real NotificationToasts component must publish this result');
      assert.equal(entry.status, 'active');
      assert.equal(entry.error.details.status, status);
      assert.equal(entry.error.details.workspaceId, record.workspaceId);
      assert.equal(entry.error.message, 'RAW_NATIVE_FAILURE');
      assert.ok(entry.error.details.requestId);
      for (const language of [en, zh]) {
        assert.equal(entry.message((key) => language[key]),
          language['dashboard.sync.' + status] + ' ' + language['dashboard.sync.partial']);
        assert.ok(entry.describe((key) => language[key]).includes(record.absolutePath));
      }
      assert.ok(entry.text.includes(locale['dashboard.sync.' + status]));
      assert.ok(!entry.text.includes('RAW_NATIVE_FAILURE'));
      assert.equal(entry.actions.length, 1);
      assert.equal(entry.actions[0].label, locale['dashboard.sync.openSession']);
      assert.equal(entry.actions[0].leaveSettings, true);
      entry.actions[0].onClick();
      findAll(node, (item) => item.props?.children === locale['dashboard.sync.openSession'])[0].props.onClick();
      assert.deepEqual(opened, ['retained-session', 'retained-session']);
      assert.equal(dispatched, 1, 'recovery only opens the created Session');
      assert.equal(findAll(node, (item) => item.props?.children === locale['dashboard.sync.create']).length, 0);
      findAll(node, (item) => item.props?.role === 'dialog' && item.props.title === locale['dashboard.action.sync'])[0].props.onClose();
      harness.render();
      assert.equal(diagnostics.getSnapshot().find((item) => item.key === entry.key).status, 'active',
        'closing the sync dialog must retain its recovery');
      harness.dispose();
      const historical = diagnostics.getSnapshot().find((item) => item.key === entry.key);
      assert.equal(historical.status, 'inactive');
      assert.equal(historical.error.details.sessionId, 'retained-session');
      assert.deepEqual(historical.actions, []);
      entry.actions[0].onClick();
      assert.equal(opened.length, 2, 'unmount revokes stale recovery callbacks');
      assert.equal(dispatched, 1);
    }
  });
}

for (const change of ['baseline', 'worktree', 'manager', 'unmount']) {
  for (const status of ['binding-failed', 'model-failed', 'title-failed', 'reporting-failed', 'prompt-failed']) {
    test(`late ${status} after ${change} retains inactive diagnostics without stale navigation`, async () => {
      const diagnostics = createWorktreeDiagnostics();
      const harness = renderHarness(async () => true, { diagnostics });
      let resolve;
      const pending = new Promise((done) => { resolve = done; });
      const opened = [];
      const original = { ...record, baseBranch: 'main' };
      let node = harness.render({ record: original, onSyncBaseline: () => pending,
        onOpenSession: (id) => opened.push(id) });
      findAll(node, (item) => item.props?.['data-dashboard-action'] === 'sync-baseline')[0].props.onClick();
      node = harness.render();
      findAll(node, (item) => item.props?.children === en['dashboard.sync.create'])[0].props.onClick();
      if (change === 'baseline') harness.render({ record: { ...original, baseBranch: 'changed' } });
      else if (change === 'worktree') harness.render({ record: { ...original, worktreeId: 'another' } });
      else if (change === 'manager') harness.render({ manager: {} });
      else harness.dispose();
      resolve({ workspaceId: original.workspaceId, worktreeId: original.worktreeId,
        sessionId: 'late-partial', status, error: 'RAW_LATE_FAILURE' });
      await tick();
      if (change !== 'unmount') harness.render();
      const history = diagnostics.getSnapshot();
      assert.equal(history.length, 1);
      assert.equal(history[0].status, 'inactive');
      assert.equal(history[0].error.details.sessionId, 'late-partial');
      assert.equal(history[0].error.details.worktreeId, original.worktreeId);
      assert.ok(history[0].error.details.requestId);
      assert.equal(history[0].error.details.status, status);
      assert.equal(history[0].error.message, 'RAW_LATE_FAILURE');
      assert.deepEqual(history[0].actions, []);
      assert.deepEqual(opened, []);
      for (const locale of [en, zh]) assert.equal(history[0].message((key) => locale[key]),
        locale['dashboard.sync.' + status] + ' ' + locale['dashboard.sync.partial']);
      if (change !== 'unmount') harness.dispose();
      assert.equal(diagnostics.getSnapshot()[0].status, 'inactive');
    });
  }
}

test('late sync admission cannot open a Session after baseline replacement or unmount', async () => {
  for (const change of ['baseline', 'unmount']) {
    const harness = renderHarness(async () => true);
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const opened = [];
    let node = harness.render({ record: { ...record, baseBranch: 'main' },
      onSyncBaseline: () => pending, onOpenSession: (id) => opened.push(id) });
    findAll(node, (item) => item.props?.['data-dashboard-action'] === 'sync-baseline')[0].props.onClick();
    node = harness.render();
    findAll(node, (item) => item.type === 'button' && item.props.children === en['dashboard.sync.create'])[0].props.onClick();
    if (change === 'baseline') harness.render({ record: { ...record, baseBranch: 'changed' } });
    else harness.dispose();
    resolve({ sessionId: 'late', status: 'dispatched' });
    await tick();
    assert.deepEqual(opened, []);
    if (change !== 'unmount') harness.dispose();
  }
});

test('header baseline links reach the base Dashboard on every tab while preserving the editor', () => {
  for (const locale of [en, zh]) {
    const harness = renderHarness(async () => true);
    const child = { ...record, worktreeId: 'child', branch: 'child', currentBranch: 'child', baseBranch: record.branch };
    const main = createMainWorktreeRecord({ workspaceId: 'repo', path: '/repo' }, 'main');
    const opened = [];
    const baseLinks = (node) => findAll(node, (item) => item.props?.['data-dashboard-base-worktree']);
    let node = harness.render({ record: child, worktrees: [record, child], mainRecord: main,
      onOpenWorktree: (base) => opened.push(base), t: (key) => locale[key],
      onSaveBaseline: async (value) => value, branches: [{ name: 'main' }, { name: record.branch }] });
    for (let index = 0; index < 5; index++) {
      byRole(node, 'tab')[index].props.onClick();
      node = harness.render();
      assert.equal(baseLinks(node).length, 1);
      assert.equal(baseLinks(node)[0].props['aria-label'], locale['dashboard.openBaseWorktree']);
      baseLinks(node)[0].props.onClick();
      assert.equal(opened.at(-1), record);
      assert.equal(findAll(node, (item) => item.props?.['data-dashboard-baseline-edit']).length, 1);
    }
    harness.render({ record: { ...child, baseBranch: 'refs/heads/main' } });
    harness.render();
    node = harness.render();
    baseLinks(node)[0].props.onClick();
    assert.equal(opened.at(-1), main);
    harness.render({ record: { ...child, baseBranch: 'refs/remotes/origin/main' } });
    harness.render();
    node = harness.render();
    assert.equal(baseLinks(node).length, 0);
    node = harness.render({ record: { ...child, baseBranch: record.branch }, onSaveBaseline: undefined });
    assert.equal(baseLinks(node).length, 1);
    node = harness.render({ onOpenWorktree: undefined });
    assert.equal(baseLinks(node).length, 0);
    harness.dispose();
  }
});

test('saving a baseline updates its navigation before the Workspace projection refreshes', async () => {
  const harness = renderHarness(async () => true, { stubBranchPicker: true });
  const child = { ...record, worktreeId: 'child', branch: 'child', currentBranch: 'child', baseBranch: record.branch };
  const main = createMainWorktreeRecord({ workspaceId: 'repo', path: '/repo' }, 'main');
  const opened = [];
  let node = harness.render({ record: child, worktrees: [record, child], mainRecord: main,
    branches: [{ name: 'main' }, { name: record.branch }],
    onOpenWorktree: (base) => opened.push(base), onSaveBaseline: async (value) => value });
  findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0].props.onClick();
  node = harness.render();
  findAll(node, (item) => item.type === 'baseline-picker')[0].props.onChange('main');
  node = harness.render();
  findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0].props.onClick();
  await tick();
  node = harness.render();
  const link = findAll(node, (item) => item.props?.['data-dashboard-base-worktree'])[0];
  link.props.onClick();
  assert.equal(opened[0], main);
  assert.equal(child.baseBranch, record.branch);
  harness.dispose();
});

test('derived Worktree preview, full tab, navigation, and refreshed baselines share ready records', () => {
  for (const locale of [en, zh]) {
    const harness = renderHarness(async () => true);
    const children = Array.from({ length: 7 }, (_, index) => ({
      ...record, worktreeId: `child-${index}`, branch: `child-${index}`,
      absolutePath: `/repo/child-${index}`, baseBranch: record.branch,
      ...(index === 0 ? { status: 'removed', health: 'cleaned' } : {}),
    }));
    const opened = [];
    let node = harness.render({ worktrees: children, t: (key) => locale[key],
      onOpenWorktree: (child) => opened.push(child) });
    const rows = (tree) => findAll(tree, (item) => item.props?.['data-dashboard-worktree']);
    assert.equal(rows(node).length, 5);
    rows(node)[0].props.onClick();
    assert.equal(opened[0], children[0]);
    assert.ok(findAll(node, (item) => item.props?.children === locale['dashboard.archived']).length);
    byRole(node, 'tab')[3].props.onClick();
    node = harness.render();
    assert.equal(rows(node).length, 7);
    assert.equal(findAll(byRole(node, 'tabpanel')[0], (item) => item.props?.children === locale['dashboard.soon']).length, 0);
    node = harness.render({ worktrees: children.map((child) => ({ ...child, baseBranch: 'elsewhere' })) });
    assert.equal(rows(node).length, 0);
    assert.ok(findAll(node, (item) => item.props?.children === locale['dashboard.noChildren']).length);
    node = harness.render({ worktrees: children });
    assert.equal(rows(node).length, 7);
    harness.dispose();
  }
});
const historicalHints = (node, t) =>
  findAll(
    node,
    (item) => item.type === 'span' && item.props.children === t['dashboard.historicalUnavailable'],
  );

test('Local and managed Dashboard settings address independent automatic injection scopes', () => {
  for (const selected of [record, createMainWorktreeRecord({ workspaceId: 'ws-local', path: '/project' }, 'main')]) {
    const harness = renderHarness(async () => true);
    let node = harness.render({ record: selected });
    byRole(node, 'tab')[4].props.onClick();
    node = harness.render();
    const panel = findAll(node, (item) => item.type === 'ToolSettings')[0];
    assert.deepEqual(panel.props.scope, isMainWorktreeId(selected.worktreeId)
      ? { kind: 'local', workspaceId: selected.workspaceId }
      : { kind: 'worktree', workspaceId: selected.workspaceId, worktreeId: selected.worktreeId });
    harness.dispose();
  }
});

test('Dashboard renders separate ahead-behind, committed, and uncommitted metric rows', () => {
  const harness = renderHarness(async () => true);
  const node = harness.render({ record: { ...record, baseBranch: 'main' } });
  const metrics = findAll(node, (item) => item.props?.['data-dashboard-overview-metric']);
  assert.deepEqual(
    metrics.map((item) => [item.props['data-dashboard-overview-metric'], item.props.children]),
    [
      ['aheadBehind', '+3 / -1'],
      ['committed', '+20 / -6'],
      ['workingTree', '+12 / -4'],
    ],
  );
  harness.dispose();
});

test('dashboard renders real identity and explicit placeholders in both languages', () => {
  const harness = renderHarness(async () => true);
  for (const locale of [en, zh]) {
    const node = harness.render({
      t: (key) => {
        assert.ok(locale[key], key);
        return locale[key];
      },
    });
    assert.equal(copyBranchTitle(node).props.children, record.branch);
    const topbar = findAll(node, (item) => item.props?.['data-dashboard-topbar'])[0];
    assert.equal(topbar.type, 'header');
    assert.equal(topbar.props['data-window-drag'], true);
    const title = findAll(topbar, (item) => item.props?.title === `Payments/${record.branch}`)[0];
    assert.ok(title, 'the top bar identifies the Workspace and selected Worktree');
    assert.ok(title.props.children.includes(record.branch));
    assert.equal(title.props.children.includes(locale['dashboard.preview']), false);
    assert.match(title.props.style.marginInlineStart, /--dsh-frame-leading-clearance/);
    assert.ok(
      findAll(node, (item) => item.type === 'code').some(
        (item) => item.props.children === record.absolutePath,
      ),
    );
    assert.equal(byRole(node, 'tab').length, 5);
    for (const action of ['terminal', 'diff', 'pullRequest', 'tests']) {
      assert.equal(findAll(node, (item) => item.type === 'button' && item.props.children === locale[`dashboard.action.${action}`]).length, 0);
    }
    assert.equal(findAll(node, (item) => item.props?.['data-dashboard-action'] === 'sync-baseline')[0].props.disabled, true);
  }
  harness.dispose();
});

test('Dashboard top bar groups directory, return, and rightbar actions above the page body', () => {
  const harness = renderHarness(async () => true);
  let closed = 0;
  let opened = 0;
  const node = harness.render({
    sessionIds: ['session-1'],
    onClose: () => { closed++; },
    onOpenSidebar: () => { opened++; },
  });
  const topbar = findAll(node, (item) => item.props?.['data-dashboard-topbar'])[0];
  const openApp = findAll(topbar, (item) => item.type === 'a')[0];
  assert.equal(openApp.props.href, vscodeFolderUrl(record.absolutePath));
  assert.equal(findAll(node, (item) => item.type === 'a' && item.props.href === openApp.props.href).length, 1);
  findAll(topbar, (item) => item.props?.['aria-label'] === en['dashboard.back'])[0].props.onClick();
  findAll(topbar, (item) => item.props?.['data-sidebar-right-expand'])[0].props.onClick();
  assert.equal(closed, 1);
  assert.equal(opened, 1);
  assert.equal(node.props.children[0], topbar, 'the bar sits outside the width-constrained page');
  assert.match(dashboardCssSource, /\.dashboardTopline\s*\{[^}]*position: sticky;[^}]*top: 0;/);
  assert.match(dashboardCssSource, /\.dashboardToplineActions\s*\{[^}]*-webkit-app-region: no-drag;/);
  assert.match(
    dashboardCssSource,
    /html\[data-platform='darwin'\][\s\S]*?\[data-sidebar-collapsed\]:has\(\[data-worktree-dashboard\], \[data-worktree-dashboard-request\]\)[\s\S]*?> \[data-shell-leading\]\s*\{\s*z-index: 21;/,
  );
  harness.dispose();
});

test('dashboard renders source-aware acquisition facts and flags absent facts as historical', () => {
  const harness = renderHarness(async () => true);
  let node = harness.render({
    record: {
      ...record,
      createdAt: '2026-09-13T01:02:03.000Z',
      baseBranch: 'main',
    },
  });
  assert.equal(findAll(node, (item) => item.type === 'dt')[0].props.children, en['dashboard.created']);
  assert.equal(
    findAll(node, (item) => item.type === 'time')[0].props.dateTime,
    '2026-09-13T01:02:03.000Z',
  );
  assert.ok(findAll(node, (item) => item.type === 'dd' && item.props.children === 'main').length > 0);

  node = harness.render({
    record: {
      ...record,
      source: 'external',
      importedAt: '2026-09-13T04:05:06.000Z',
    },
  });
  assert.equal(findAll(node, (item) => item.type === 'dt')[0].props.children, en['dashboard.imported']);
  assert.equal(
    findAll(node, (item) => item.type === 'time')[0].props.dateTime,
    '2026-09-13T04:05:06.000Z',
  );
  // Imported records have no inferred base: both the header fact and the status
  // card base show the historical hint instead of the generic unknown label.
  assert.equal(historicalHints(node, en).length, 2);
  assert.equal(
    findAll(node, (item) => item.type === 'dd' && item.props.children === en['dashboard.unknown']).length,
    0,
  );

  node = harness.render({ record });
  assert.equal(findAll(node, (item) => item.type === 'dt')[0].props.children, en['dashboard.created']);
  assert.equal(findAll(node, (item) => item.type === 'time').length, 0);
  // Missing creation time, plus the header and status base facts.
  assert.equal(historicalHints(node, en).length, 3);
  harness.dispose();
});

test('Dashboard facts preserve words before emergency wrapping', () => {
  const factStyles = dashboardCssSource.slice(
    dashboardCssSource.indexOf('.dashboardFacts dt {'),
    dashboardCssSource.indexOf('.dashboardFactAction {'),
  );

  assert.match(factStyles, /\.dashboardFacts dt \{[\s\S]*?overflow-wrap: break-word;[\s\S]*?word-break: normal;/);
  assert.match(factStyles, /\.dashboardFacts dd \{[\s\S]*?overflow-wrap: break-word;[\s\S]*?word-break: normal;/);
  assert.doesNotMatch(factStyles, /overflow-wrap: anywhere;/);
});

test('dashboardFacts uses a fixed-frame searchable baseline modal and feeds it to Git tab defaults', async () => {
  const harness = renderHarness(async () => true);
  const calls = [];
  const branches = [
    { name: 'main', isCurrent: true, checkedOut: true },
    { name: 'develop', isCurrent: false, checkedOut: false },
    { name: record.branch, isCurrent: false, checkedOut: true },
  ];
  let node = harness.render({
    branches,
    onSaveBaseline: async (baseBranch, expectedBaseBranch) => {
      calls.push({ baseBranch, expectedBaseBranch });
      return baseBranch;
    },
    record: { ...record, baseBranch: 'main' },
  });
  const editButton = findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0];
  assert.equal(editButton.props.disabled, false);
  assert.equal(editButton.props['aria-label'], en['dashboard.editBase']);
  assert.equal(findAll(node, (item) => item.type === 'select').length, 0);
  editButton.props.onClick();
  node = harness.render();

  const dialog = byRole(node, 'dialog')[0];
  assert.equal(dialog.props.title, en['dashboard.editBase']);
  assert.equal(dialog.props.description, en['dashboard.editBaseDescription']);
  assert.equal(dialog.props.closeLabel, en['dialog.closeBaseline']);
  assert.equal(findAll(node, (item) => item.props?.['data-dashboard-baseline-modal']).length, 1);
  const search = findAll(node, (item) => item.props?.['data-single-select-search'])[0];
  assert.ok(search);
  assert.equal(search.props['data-modal-autofocus'], true);
  assert.equal(search.props.role, 'combobox');
  assert.equal(search.props['aria-expanded'], true);
  assert.equal(search.props['aria-controls'], 'dashboard-options');
  assert.equal(search.props['aria-activedescendant'], 'dashboard-option-0');
  const baselineRow = findAll(
    node,
    (item) =>
      item.type === 'div' &&
      Array.isArray(item.props?.children) &&
      item.props.children.some((child) => child?.props?.['data-dashboard-baseline'] !== undefined),
  )[0];
  assert.equal(baselineRow.props.children[0].type, 'dt');
  assert.equal(baselineRow.props.children[1].type, 'dd');
  assert.equal(baselineRow.props.children[2].type, 'span');
  // The branch list is part of the permanent frame: it exists without any
  // focus or click, and only its rows react to the query.
  const optionsSurface = findAll(
    node,
    (item) => item.props?.['data-single-select-options'] !== undefined,
  )[0];
  assert.ok(optionsSurface);
  const listbox = byRole(optionsSurface, 'listbox')[0];
  assert.equal(byRole(listbox, 'option').length, 2);
  let options = findAll(node, (item) => item.props?.['data-single-select-option'] !== undefined);
  assert.deepEqual(
    options.map((option) => option.props['data-single-select-option']),
    ['main', 'develop'],
  );
  assert.equal(options[0].props['aria-selected'], true);
  assert.equal(options[1].props['aria-selected'], false);
  assert.equal(findAll(options[0], (item) => item.props?.['data-icon'] === 'check').length, 1);

  search.props.onKeyDown({ key: 'ArrowUp', preventDefault() {} });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-single-select-option'] !== undefined);
  assert.equal(options[0].props['aria-selected'], true);
  assert.equal(options[1].props['data-highlighted'], true);
  const wrappedSearch = findAll(node, (item) => item.props?.['data-single-select-search'])[0];
  wrappedSearch.props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-single-select-option'] !== undefined);
  assert.equal(options[0].props['aria-selected'], true);
  assert.equal(options[1].props['aria-selected'], false);

  search.props.onChange({ currentTarget: { value: 'dev' } });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-single-select-option'] !== undefined);
  assert.deepEqual(
    options.map((option) => option.props['data-single-select-option']),
    ['develop'],
  );
  search.props.onChange({ currentTarget: { value: 'missing' } });
  node = harness.render();
  assert.equal(
    findAll(node, (item) => item.props?.['data-single-select-empty'])[0].props.children,
    en['dashboard.noMatchingBranches'],
  );
  assert.equal(
    findAll(node, (item) => item.props?.['data-single-select-option'] !== undefined).length,
    0,
  );
  // An empty result swaps in the status message without removing the frame.
  assert.equal(
    findAll(node, (item) => item.props?.['data-single-select-options']).length,
    1,
  );
  assert.equal(byRole(node, 'listbox').length, 0);
  search.props.onChange({ currentTarget: { value: 'dev' } });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-single-select-option'] !== undefined);
  options[0].props.onClick();
  node = harness.render();
  findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0].props.onClick();
  await tick();
  node = harness.render();
  assert.deepEqual(calls, [{ baseBranch: 'develop', expectedBaseBranch: 'main' }]);
  assert.equal(
    findAll(node, (item) => item.props?.['data-dashboard-baseline-value'])[0]?.props.children,
    'develop',
  );

  const gitTab = byRole(node, 'tab').find((item) => item.props.children.includes(en['dashboard.tab.git']));
  gitTab.props.onClick();
  node = harness.render();
  const gitPanel = findAll(node, (item) => item.props?.defaultBaselineBranch !== undefined)[0];
  assert.equal(gitPanel.props.defaultBaselineBranch, 'develop');
  assert.equal(gitPanel.props.currentBranch, record.currentBranch);
  harness.dispose();
});

test('shared baseline picker searches remote branches and saves only confirmed selections', async () => {
  const harness = renderHarness(async () => true);
  const calls = [];
  let node = harness.render({
    branches: [
      { name: 'main', isCurrent: true, checkedOut: true },
      { name: 'origin/main', kind: 'remote', remote: 'origin', isCurrent: false, checkedOut: false },
      { name: record.branch, isCurrent: false, checkedOut: true },
    ],
    record: { ...record, baseBranch: 'main' },
    onSaveBaseline: async (branch, expected) => { calls.push({ branch, expected }); return branch; },
  });
  findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0].props.onClick();
  node = harness.render();
  assert.deepEqual(byRole(node, 'group').filter((group) => group.props['aria-labelledby']).map((group) => group.props.children[0].props.children[0].props.children), [
    en['branch.local'], en['branch.remote'],
  ]);
  let search = findAll(node, (item) => item.props?.['data-single-select-search'])[0];
  search.props.onChange({ currentTarget: { value: 'ORIGIN' } });
  node = harness.render();
  const option = byRole(node, 'option')[0];
  assert.equal(option.props['data-single-select-option'], 'origin/main');
  assert.equal(option.props['aria-selected'], false);
  search = findAll(node, (item) => item.props?.['data-single-select-search'])[0];
  search.props.onKeyDown({ key: 'Enter', preventDefault() {} });
  node = harness.render();
  assert.equal(byRole(node, 'option')[0].props['aria-selected'], true);
  assert.deepEqual(calls, []);
  findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0].props.onClick();
  await tick();
  node = harness.render();
  assert.deepEqual(calls, [{ branch: 'origin/main', expected: 'main' }]);
  assert.equal(findAll(node, (item) => item.props?.['data-dashboard-baseline-value'])[0].props.children, 'origin/main');
  harness.dispose();
});

test('baseline editor saves an exact remote ref even when its display name matches the current local branch', async () => {
  const harness = renderHarness(async () => true);
  const calls = [];
  let node = harness.render({ record: { ...record, branch: 'origin/main', currentBranch: 'origin/main', baseBranch: 'main' },
    branches: [{ name: 'origin/main', ref: 'refs/heads/origin/main', kind: 'local' },
      { name: 'origin/main', ref: 'refs/remotes/origin/main', kind: 'remote', remote: 'origin' }],
    onSaveBaseline: async (branch, expected) => { calls.push({ branch, expected }); return branch; },
  });
  findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0].props.onClick();
  node = harness.render();
  const options = byRole(node, 'option');
  assert.equal(options.length, 1);
  assert.equal(options[0].props['data-single-select-option'], 'refs/remotes/origin/main');
  options[0].props.onClick();
  node = harness.render();
  const save = findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0];
  assert.equal(save.props.disabled, false);
  save.props.onClick();
  await tick();
  assert.deepEqual(calls, [{ branch: 'refs/remotes/origin/main', expected: 'main' }]);
  assert.equal(findAll(harness.render(), (item) => item.props?.['data-dashboard-baseline-value'])[0].props.children, 'origin/main');
  harness.dispose();
});

test('baseline picker keeps a long branch roster in one scrollable list', () => {
  const harness = renderHarness(async (branch) => branch);
  const branches = Array.from({ length: 240 }, (_, index) => ({
    name: 'branch-' + String(index).padStart(2, '0'),
    isCurrent: false,
    checkedOut: false,
  }));
  let node = harness.render({
    branches,
    record: { ...record, baseBranch: 'branch-00' },
    onSaveBaseline: async (branch) => branch,
  });
  findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0].props.onClick();
  node = harness.render();
  const listbox = byRole(node, 'listbox')[0];
  const options = byRole(listbox, 'option');
  assert.ok(options.length > 0 && options.length < 30);
  assert.equal(options[0].props['data-single-select-option'], 'branch-00');
  assert.equal(options[0].props['aria-selected'], true);
  assert.equal(options[0].props['aria-setsize'], 240);
  findAll(node, (item) => item.props?.['data-single-select-search'])[0].props.onChange({ currentTarget: { value: 'branch-239' } });
  node = harness.render();
  assert.deepEqual(byRole(node, 'option').map((option) => option.props['data-single-select-option']), ['branch-239']);
  harness.dispose();
});

test('saved baseline can immediately select a newly fetched branch while excluding its own branch', async () => {
  const harness = renderHarness(async () => true);
  const calls = [];
  let node = harness.render({ branches: [{ name: 'main' }], record: { ...record, baseBranch: 'main' },
    onFetchBranches: async () => [{ name: 'main' }, { name: record.branch }, { name: 'origin/new', kind: 'remote' }],
    onSaveBaseline: async (branch, expected) => { calls.push({ branch, expected }); return branch; },
  });
  findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0].props.onClick();
  node = harness.render();
  findAll(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0].props.onClick();
  await tick();
  node = harness.render();
  assert.deepEqual(byRole(node, 'option').map((item) => item.props['data-single-select-option']), ['main', 'origin/new']);
  byRole(node, 'option')[1].props.onClick();
  node = harness.render();
  const save = findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0];
  assert.equal(save.props.disabled, false);
  save.props.onClick();
  await tick();
  assert.deepEqual(calls, [{ branch: 'origin/new', expected: 'main' }]);
  harness.dispose();
});

test('baseline Fetch retains its roster across lightweight Workspace refreshes without another branch read', async () => {
  const harness = renderHarness(async () => true);
  const before = [{ name: 'origin/main', kind: 'remote', remote: 'origin' }];
  const after = [...before, { name: 'origin/new', kind: 'remote', remote: 'origin' }];
  let finishFetch;
  let reads = 0;
  const props = { branches: [], record: { ...record, baseBranch: 'origin/main' },
    onLoadBranches: async () => { reads++; return before; },
    onFetchBranches: () => new Promise((resolve) => { finishFetch = resolve; }),
    onSaveBaseline: async (branch) => branch };
  let node = harness.render(props);
  findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0].props.onClick();
  harness.render();
  await tick();
  node = harness.render();
  findAll(node, (item) => item.type === 'button' && item.props.children === en['branch.remote'])[0].props.onClick();
  findAll(node, (item) => item.props?.['data-single-select-search'])[0].props.onChange({ currentTarget: { value: 'origin' } });
  node = harness.render();
  findAll(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0].props.onClick();
  node = harness.render({ branches: [] });
  assert.deepEqual(byRole(node, 'option').map((item) => item.props['data-single-select-option']), ['origin/main']);
  finishFetch(after);
  await tick();
  // Workspace reads contain no branch catalog and replace the empty array after Fetch.
  node = harness.render({ branches: [] });
  assert.deepEqual(byRole(node, 'option').map((item) => item.props['data-single-select-option']), ['origin/main', 'origin/new']);
  assert.equal(findAll(node, (item) => item.props?.['data-single-select-search'])[0].props.value, 'origin');
  assert.equal(findAll(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0].props['data-fetch-status'], 'success');
  assert.equal(byRole(node, 'option')[0].props['aria-selected'], true);
  assert.equal(reads, 1);
  byRole(node, 'option')[1].props.onClick();
  assert.equal(findAll(harness.render(), (item) => item.props?.['data-dashboard-baseline-save'])[0].props.disabled, false);
  harness.dispose();
});

for (const operation of ['onLoad', 'onFetch']) {
  for (const settlement of ['resolve', 'reject']) {
    for (const batched of [false, true]) {
      test(`baseline ${operation} ignores ${settlement} from a closed modal after a newer request (batched: ${batched})`, async () => {
        const harness = renderHarness(async () => true, { stubBranchPicker: true });
        const requests = [];
        const read = () => new Promise((resolve, reject) => requests.push({ resolve, reject }));
        let node = harness.render({ branches: [{ name: 'main' }], record: { ...record, baseBranch: 'main' },
          onLoadBranches: read, onFetchBranches: read, onSaveBaseline: async (branch) => branch });
        const open = () => {
          findAll(node, (item) => item.props?.['data-dashboard-baseline-edit'])[0].props.onClick();
          node = harness.render();
          return findAll(node, (item) => item.type === 'baseline-picker')[0].props;
        };
        const oldPicker = open();
        const old = oldPicker[operation]().catch(() => {});
        node = harness.render();
        byRole(node, 'dialog')[0].props.onClose();
        if (!batched) node = harness.render();
        const picker = open();
        await oldPicker[operation]();
        assert.equal(requests.length, 1, 'callbacks from the closed modal cannot start reads');
        const latest = picker.onLoad();
        node = harness.render();
        // An obsolete completion must not release the new read's Save gate.
        if (settlement === 'reject') requests[0].reject(new Error('obsolete'));
        else requests[0].resolve([{ name: 'obsolete' }]);
        await old;
        node = harness.render();
        assert.deepEqual(findAll(node, (item) => item.type === 'baseline-picker')[0].props.branches.map((branch) => branch.name), ['main']);
        assert.equal(findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0].props.disabled, true);
        requests[1].resolve([{ name: 'main' }, { name: 'latest' }]);
        await latest;
        node = harness.render();
        assert.deepEqual(findAll(node, (item) => item.type === 'baseline-picker')[0].props.branches.map((branch) => branch.name), ['main', 'latest']);
        assert.equal(findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0].props.disabled, false);
        // Same modal, new request first; the previous callback settles last.
        const current = findAll(node, (item) => item.type === 'baseline-picker')[0].props;
        const earlier = current[operation]().catch(() => {});
        const newer = current.onLoad();
        requests[3].resolve([{ name: 'main' }, { name: 'newest' }]);
        await newer;
        if (settlement === 'reject') requests[2].reject(new Error('earlier'));
        else requests[2].resolve([{ name: 'obsolete' }]);
        await earlier;
        node = harness.render();
        assert.deepEqual(findAll(node, (item) => item.type === 'baseline-picker')[0].props.branches.map((branch) => branch.name), ['main', 'newest']);
        assert.equal(findAll(node, (item) => item.props?.['data-dashboard-baseline-save'])[0].props.disabled, false);
        harness.dispose();
      });
    }
  }
}

test('baseline editor delegates list behavior to the shared branch picker', () => {
  assert.match(source, /<GitBranchPicker/);
  assert.match(dashboardCssSource, /width: min\(440px, calc\(100vw - 48px\)\);/);
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
  assert.equal(vscodeFolderUrl(String.raw`\\?\C:\Projects\a b`), 'vscode://file/C:/Projects/a%20b');
  assert.equal(vscodeFolderUrl(String.raw`\\?\UNC\server\share\repo`), 'vscode://file//server/share/repo');
  assert.equal(vscodeFolderUrl('//?/C:/Projects/a b'), 'vscode://file/C:/Projects/a%20b');
  assert.equal(vscodeFolderUrl('//?/UNC/server/share/repo'), 'vscode://file//server/share/repo');
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

test('dashboard Sessions mirror Worktree status dots, idle relative time, and blank metadata rules', () => {
  const now = Date.now();
  const ids = ['running', 'waiting', 'completed', 'idle', 'blank', 'missing'];
  const sessions = {
    ids,
    current: 'running',
    byId: {
      running: { displayTitle: 'Running session' },
      waiting: { displayTitle: 'Waiting session' },
      completed: { displayTitle: 'Completed session' },
      idle: { displayTitle: 'Idle session' },
      blank: { blank: true },
      missing: { displayTitle: 'Missing presentation' },
    },
  };
  const presentation = (status, extra = {}) => ({
    status,
    running: status.labelKey === 'running',
    ongoing: status.state === 'ongoing',
    runningSubagentCount: status.runningSubagentCount,
    completed: status.labelKey === 'completed',
    ...extra,
  });
  const presentations = {
    running: presentation({ state: 'ongoing', labelKey: 'running', runningSubagentCount: 0 }),
    waiting: presentation({ state: 'warning', labelKey: 'waitingApproval', runningSubagentCount: 0 }),
    completed: presentation({ state: 'done', labelKey: 'completed', runningSubagentCount: 0 }),
    idle: presentation(
      { state: 'done', labelKey: 'idle', runningSubagentCount: 0 },
      { updatedAt: now - 3 * 60_000 },
    ),
    blank: presentation(
      { state: 'done', labelKey: 'idle', runningSubagentCount: 0 },
      { updatedAt: now - 5 * 60_000 },
    ),
  };
  const translate = (key, params = {}) =>
    en[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? '{' + name + '}'));
  const harness = renderHarness(async () => true);
  let node = harness.render({
    t: translate,
    sessions,
    sessionPresentations: presentations,
    sessionIds: ids,
  });
  const rows = (value) => findAll(value, (item) => item.props?.['data-dashboard-session']);
  const statusRows = (value) =>
    findAll(value, (item) => item.props?.['data-dashboard-session-status'] !== undefined);
  const timeRows = (value) => findAll(value, (item) => item.props?.['data-dashboard-session-time']);
  assert.equal(rows(node).length, 5);
  assert.equal(statusRows(node).length, 3);
  assert.deepEqual(
    statusRows(node).map((item) => item.props['aria-label']),
    [en['session.status.running'], en['session.status.waitingApproval'], en['session.status.completed']],
  );
  assert.equal(timeRows(node).length, 1);
  assert.match(timeRows(node)[0].props.children, /^3min$/);
  const blankRow = findAll(node, (item) => item.props?.['data-dashboard-session'] === 'blank')[0];
  assert.equal(findAll(blankRow, (item) => item.props?.['data-dashboard-session-status'] !== undefined).length, 0);

  byRole(node, 'tab')[2].props.onClick();
  node = harness.render();
  assert.equal(rows(node).length, ids.length);
  assert.equal(statusRows(node).length, 3);
  assert.equal(timeRows(node).length, 1);
  assert.equal(
    findAll(node, (item) => item.props?.['data-dashboard-session'] === 'missing').length,
    1,
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
  assert.ok(findAll(harness.render(), (item) => item.type === 'toasts').some((item) => item.props.notices.some((notice) => notice.text === en['dashboard.copyFailed'])));
  copyButton(harness.render()).props.onClick();
  complete(true);
  await tick();
  assert.equal(byRole(harness.render(), 'status')[0].props.children, en['dashboard.copied']);
  harness.dispose();
});

test('dashboard ref button copies the reference and coalesces activation without including the health badge', async () => {
  const calls = [];
  let complete;
  const harness = renderHarness((value) => {
    calls.push(value);
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const title = copyBranchTitle(harness.render());
  title.props.onClick();
  title.props.onClick();
  assert.equal(title.type, 'button');
  assert.equal(title.props.children, record.branch);
  assert.deepEqual(calls, [record.branch]);
  assert.equal(copyBranchTitle(harness.render()).props['aria-busy'], true);
  complete(true);
  await tick();
  assert.equal(
    byRole(harness.render(), 'status')[0].props.children,
    en['dashboard.branchCopied'],
  );
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
  assert.ok(findAll(harness.render(), (item) => item.type === 'toasts').some((item) => item.props.notices.length > 0));
  assert.equal(byRole(harness.render(), 'alert').length, 0);
  copyButton(harness.render()).props.onClick();
  harness.render({ record: { ...record, absolutePath: '/another' } });
  reject(new Error('late failure'));
  await tick();
  assert.ok(findAll(harness.render(), (item) => item.type === 'toasts').every((item) => item.props.notices.length === 0));
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
    node.props.onKeyDown({
      key: 'Escape',
      currentTarget: { querySelector: () => ({ role: 'menu' }) },
      stopPropagation() { assert.fail('The native menu must receive Escape'); },
    });
    assert.equal(closed, 0);
    node.props.onKeyDown({
      key: 'Escape',
      defaultPrevented: true,
      currentTarget: { querySelector: () => null },
      stopPropagation() { assert.fail('A native menu already consumed Escape during document capture'); },
    });
    assert.equal(closed, 0, 'a capture-dismissed menu does not also dismiss Dashboard');
    node.props.onKeyDown({ key: 'Escape', currentTarget: { querySelector: () => null }, stopPropagation() {} });
    assert.equal(closed, 1);
  } finally {
    globalThis.document = oldDocument;
    harness.dispose();
  }
});

test('empty Dashboard offers new Session and the native rightbar button', () => {
  const harness = renderHarness(async () => true);
  let created = 0;
  let opened = 0;
  const node = harness.render({
    sessionIds: [],
    onCreateSession: () => { created += 1; },
    onOpenSidebar: () => { opened += 1; },
  });
  const createButton = findAll(
    node,
    (item) => item.props?.['aria-label'] === en['dashboard.newSession'],
  )[0];
  assert.ok(createButton);
  assert.equal(createButton.props.children, en['dashboard.newSession']);
  createButton.props.onClick();
  assert.equal(created, 1);

  const sidebarButton = findAll(
    node,
    (item) => item.props?.['aria-label'] === en['dashboard.openSidebar'],
  )[0];
  assert.ok(sidebarButton);
  assert.equal(sidebarButton.props['data-sidebar-right-expand'], true);
  assert.equal(findAll(sidebarButton, (item) => item.props?.['data-icon'] === 'sidebar').length, 1);
  sidebarButton.props.onClick();
  assert.equal(opened, 1);

  // After clicking openSidebar, the button is hidden
  const nodeAfterOpen = harness.render({
    sessionIds: [],
    onCreateSession: () => { created += 1; },
    onOpenSidebar: () => { opened += 1; },
  });
  assert.equal(
    findAll(
      nodeAfterOpen,
      (item) => item.props?.['aria-label'] === en['dashboard.openSidebar'],
    ).length,
    0,
  );

  // When rendered with isRightSidebarExpanded returning true, the button is hidden initially
  const harnessAlreadyOpen = renderHarness(async () => true);
  const nodeAlreadyOpen = harnessAlreadyOpen.render({
    sessionIds: [],
    onOpenSidebar: () => {},
    isRightSidebarExpanded: () => true,
  });
  assert.equal(
    findAll(
      nodeAlreadyOpen,
      (item) => item.props?.['aria-label'] === en['dashboard.openSidebar'],
    ).length,
    0,
  );
  harnessAlreadyOpen.dispose();
  assert.match(dashboardCssSource, /\.dashboardSidebarButton[\s\S]*?width: 28px;[\s\S]*?height: 28px;/);
  assert.match(dashboardCssSource, /\.dashboardSidebarButton svg[\s\S]*?transform: scaleX\(-1\);/);

  const populated = harness.render({ sessionIds: ['session-1'], onClose: () => {} });
  const backButton = findAll(
    populated,
    (item) => item.props?.['aria-label'] === en['dashboard.back'],
  )[0];
  assert.ok(backButton);
  harness.dispose();
});

test('Surface connects dashboard actions and preserves external Dashboard navigation', async () => {
  const surfaceSource = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(surfaceSource, /if \(source\.mode !== 'worktree'\) closeDashboard\(\)/);
  assert.match(surfaceSource, /inputProps\.dashboardStore\?\.set\(undefined\)/);
  assert.doesNotMatch(surfaceSource, /worktreeSessions\[0\] \?\? source\.currentSessionId/);
  assert.match(surfaceSource, /source\.sessions\.phase \?\? 'ready'/);
  assert.match(surfaceSource, /pendingDashboardRecord\.current = record/);
  assert.match(
    surfaceSource,
    /if \(navigation\.waitForSessionList === true\) \{\s+pendingDashboard\.current = undefined;/,
  );
  assert.match(surfaceSource, /if \(source\.sessions\.phase === 'pending'\) return/);
  assert.match(surfaceSource, /originSessionId: source\.currentSessionId/);
  assert.match(surfaceSource, /settlePendingDashboardNavigation/);
  const compiled = ts.transpileModule(surfaceSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const { createNumberedWorktreeName } = await import('../lib/client/view/worktree-view.js');
  const { buildSessionFileAddress, GitFileAddressError } = await import('../lib/client/dashboard/git/file-address.js');
  const calls = [];
  const refs = [];
  let refCursor = 0;
  let selected = selection;
  let target = record;
  let additionalTargets = [];
  let bindings = [{ workspaceId: 'repo', worktreeId: 'wt', sessionId: 'current' }];
  const workspace = { workspaceId: 'repo', title: 'Repo' };
  const sourceState = {
    mode: 'worktree',
    currentSessionId: 'current',
    workspaceIds: ['repo'],
    workspaces: { items: [workspace] },
    sessions: { ids: ['current'], current: 'current', byId: {}, phase: 'ready' },
    sessionPresentations: { current: { status: { state: 'done', labelKey: 'idle', runningSubagentCount: 0 } } },
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
        useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
        useCallback: (fn) => fn,
        useEffect: (effect) => effect(),
        useRef: (initial) => {
          const index = refCursor++;
          refs[index] ??= { current: initial };
          return refs[index];
        },
      };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('dashboard-selection.js'))
      return {
        resolveDashboardRecord,
        createMainWorktreeRecord,
        isMainWorktreeId,
        isManagedDashboardRecord: (record) => !isMainWorktreeId(record.worktreeId),
      };
    if (name.endsWith('dashboard-sessions.js')) return { dashboardSessionIds };
    if (name.endsWith('file-address.js')) return { buildSessionFileAddress, GitFileAddressError };
    if (name.endsWith('dashboard-navigation.js'))
      return { prepareDashboardNavigation, settlePendingDashboardNavigation };
    if (name.endsWith('worktree-view.js')) return { createNumberedWorktreeName };
    if (name.endsWith('view-mode.js')) return { workspaceSessionIds: (workspaces, workspaceId, ids) => ids ?? [] };
    if (name.endsWith('WorktreeDashboard.js')) return { WorktreeDashboard: 'Dashboard' };
    if (name.endsWith('SurfaceContent.js')) return { SurfaceContent: 'SurfaceContent' };
    if (name.endsWith('.css')) return { default: {} };
    const hook = name.match(/\/(use\w+)\.js$/)?.[1];
    if (hook)
      return {
        [hook]: (input) => {
          if (hook === 'useSurfaceSources') return sourceState;
          if (hook === 'useSurfaceRefresh')
            return {
              refresh: async (options) => calls.push(['refresh', options]),
              viewByWorkspace: new Map([
                [
                  'repo',
                  {
                    worktrees: [target, ...additionalTargets],
                    branches: [{ name: record.branch }],
                    bindings,
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
  const dashboardStore = {
    snapshot: undefined,
    getSnapshot: () => dashboardStore.snapshot,
    subscribe: () => () => {},
    set: (next) => {
      dashboardStore.snapshot = next;
    },
  };
  const surfaceInput = {
    t: (key) => en[key],
    manager: { updateWorktreeInstructions: async (input) => { calls.push(['saveInstructions', input]); return input.instructions; } },
    createSessionForWorktree() {},
    openSession: (id) => calls.push(['nativeOpen', id]),
    closeRightSidebar: () => calls.push(['closeRightSidebar']),
    openResource: (...args) => calls.push(['resource', ...args]),
    openRightSidebar: () => calls.push(['openRightSidebar']),
    dashboardStore: undefined,
  };
  const renderTree = (resetSelected = true) => {
    if (resetSelected) selected = selection;
    refCursor = 0;
    return exports.WorktreeSurface(surfaceInput);
  };
  const render = () =>
    findAll(renderTree(), (item) => item.type === 'Dashboard')[0].props;
  let props = render();
  assert.deepEqual(props.worktrees, [record]);
  assert.equal(await props.onSaveInstructions('Use tests', ''), 'Use tests');
  assert.deepEqual(calls.splice(0), [
    ['saveInstructions', { workspaceId: 'repo', worktreeId: 'wt', instructions: 'Use tests', expectedInstructions: '' }],
    ['refresh', { preserveCurrent: true, scope: { kind: 'workspace', workspaceId: 'repo' } }],
  ]);
  assert.equal(selected, selection);
  assert.deepEqual(props.sessionIds, ['current']);
  assert.equal(props.sessionPresentations, sourceState.sessionPresentations);
  // A non-head current Session owns both the Dashboard and native file preview.
  bindings.unshift({ workspaceId: 'repo', worktreeId: 'wt', sessionId: 'head' });
  sourceState.sessions.ids = ['head', 'current'];
  render().onOpenFile('src/index.ts', { line: 7 });
  assert.deepEqual(calls.splice(0), [
    ['resource', 'dsh-resource://file/session/current/src/index.ts', { line: 7 }],
    ['openRightSidebar'],
  ]);
  bindings.shift();
  sourceState.sessions.ids = ['current'];
  target = { ...record, absolutePath: record.absolutePath + '/packages/app', gitRootPath: record.absolutePath };
  sourceState.sessions.byId.current = { cwd: target.absolutePath };
  render().onOpenFile('src/index.ts', { line: 8 });
  render().onOpenFile('../../README.md');
  assert.deepEqual(calls.splice(0), [
    ['resource', 'dsh-resource://file/session/current/src/index.ts', { line: 8 }],
    ['openRightSidebar'],
    ['error', { code: 'GIT_FILE_OUTSIDE_SESSION', message: en['dashboard.git.outsideSession'], retryable: false }],
  ]);
  // A legacy binding keeps the original native cwd, so its relative path includes the package prefix.
  sourceState.sessions.byId.current = { cwd: record.absolutePath };
  render().onOpenFile('src/index.ts');
  assert.deepEqual(calls.splice(0), [
    ['resource', 'dsh-resource://file/session/current/packages/app/src/index.ts', undefined],
    ['openRightSidebar'],
  ]);
  target = record;
  delete sourceState.sessions.byId.current;
  props = render();
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
  const surfaceContentProps = (tree) =>
    findAll(tree, (item) => item.type === 'SurfaceContent')[0].props.props;
  target = record;
  selected = selection;
  sourceState.currentSessionId = 'current';
  sourceState.sessions.current = 'current';
  sourceState.sessions.ids = ['current'];
  sourceState.sessions.phase = 'ready';
  renderTree(false);
  assert.deepEqual(selected, selection);

  const switchingTarget = { ...record, worktreeId: 'wt-switch', branch: 'feat/payment-refactor-switch' };
  additionalTargets = [record];
  target = switchingTarget;
  bindings = [{ workspaceId: 'repo', worktreeId: 'wt-switch', sessionId: 'head-switch' }];
  sourceState.sessions.ids = ['head-switch'];
  calls.splice(0);
  const currentDashboard = findAll(renderTree(false), (item) => item.type === 'Dashboard')[0].props;
  assert.deepEqual(currentDashboard.worktrees, [switchingTarget, record]);
  currentDashboard.onOpenWorktree(switchingTarget);
  assert.deepEqual(calls, [['nativeOpen', 'head-switch']]);
  sourceState.currentSessionId = 'head-switch';
  sourceState.sessions.current = 'head-switch';
  renderTree(false);
  assert.deepEqual(selected, {
    workspaceId: 'repo',
    worktreeId: 'wt-switch',
    sessionId: 'head-switch',
  });

  const targetB = { ...record, worktreeId: 'wt-b', branch: 'feat/payment-refactor-b' };
  target = targetB;
  bindings = [{ workspaceId: 'repo', worktreeId: 'wt-b', sessionId: 'head-b' }];
  selected = undefined;
  sourceState.currentSessionId = undefined;
  sourceState.sessions.current = undefined;
  sourceState.sessions.ids = [];
  sourceState.sessions.phase = 'pending';
  calls.splice(0);
  surfaceContentProps(renderTree(false)).openDashboard(targetB);
  assert.deepEqual(calls, []);

  sourceState.sessions.phase = 'ready';
  sourceState.sessions.ids = ['head-b'];
  renderTree(false);
  assert.deepEqual(calls.splice(0), [['nativeOpen', 'head-b']]);

  sourceState.currentSessionId = 'unrelated';
  sourceState.sessions.current = 'unrelated';
  sourceState.sessions.ids = ['head-b', 'unrelated'];
  renderTree(false);
  sourceState.currentSessionId = 'head-b';
  sourceState.sessions.current = 'head-b';
  renderTree(false);
  assert.equal(selected, undefined);

  sourceState.currentSessionId = 'unrelated';
  sourceState.sessions.current = 'unrelated';
  sourceState.sessions.ids = ['head-b'];
  calls.splice(0);
  surfaceContentProps(renderTree(false)).openDashboard(targetB);
  assert.deepEqual(calls, [['nativeOpen', 'head-b']]);
  sourceState.currentSessionId = 'head-b';
  sourceState.sessions.current = 'head-b';
  renderTree(false);
  assert.deepEqual(selected, {
    workspaceId: 'repo',
    worktreeId: 'wt-b',
    sessionId: 'head-b',
  });
  assert.equal(
    findAll(renderTree(false), (item) => item.type === 'Dashboard').length,
    1,
  );

  const targetC = { ...record, worktreeId: 'wt-c', branch: 'feat/payment-refactor-c' };
  target = targetC;
  bindings = [];
  sourceState.sessions.ids = [];
  calls.splice(0);
  surfaceContentProps(renderTree(false)).openDashboard(targetC);
  assert.deepEqual(calls, [['closeRightSidebar']]);
  assert.deepEqual(selected, {
    workspaceId: 'repo',
    worktreeId: 'wt-c',
    sessionId: undefined,
  });
  assert.equal(
    findAll(renderTree(false), (item) => item.type === 'Dashboard').length,
    1,
  );

  const targetD = { ...record, worktreeId: 'wt-d', branch: 'feat/payment-refactor-d' };
  target = targetD;
  sourceState.currentSessionId = 'unrelated';
  sourceState.sessions.current = 'unrelated';
  sourceState.sessions.ids = ['unrelated'];
  selected = undefined;
  calls.splice(0);
  renderTree(false);
  surfaceContentProps(renderTree(false)).openDashboard(targetD);
  assert.deepEqual(calls, [['closeRightSidebar']]);
  assert.deepEqual(selected, {
    workspaceId: 'repo',
    worktreeId: 'wt-d',
    sessionId: undefined,
  });
  findAll(renderTree(false), (item) => item.type === 'Dashboard')[0].props.onOpenFile('README.md');
  assert.deepEqual(calls, [['closeRightSidebar'], ['error', {
    code: 'GIT_FILE_SESSION_REQUIRED', message: en['dashboard.git.sessionRequired'], retryable: false,
  }]]);
  calls.splice(0);
  bindings = [{ workspaceId: 'repo', worktreeId: 'wt-d', sessionId: 'preferred', status: 'active' }];
  sourceState.sessions.ids.push('preferred');
  findAll(renderTree(false), (item) => item.type === 'Dashboard')[0].props.onOpenFile('README.md');
  assert.deepEqual(calls.splice(0), [
    ['resource', 'dsh-resource://file/session/preferred/README.md', undefined], ['openRightSidebar'],
  ]);
  assert.equal(
    findAll(renderTree(false), (item) => item.type === 'Dashboard').length,
    1,
  );

  // Repeat the cross-Worktree transition through the production external dashboard store.
  // The old stale-cleanup path must not write undefined over the pending target selection.
  surfaceInput.dashboardStore = dashboardStore;
  dashboardStore.snapshot = selection;
  target = record;
  additionalTargets = [record];
  selected = selection;
  sourceState.currentSessionId = 'current';
  sourceState.sessions.current = 'current';
  sourceState.sessions.ids = ['current'];
  sourceState.sessions.phase = 'ready';
  renderTree(false);
  assert.deepEqual(dashboardStore.snapshot, selection);

  const externalTarget = { ...record, worktreeId: 'wt-external', branch: 'feat/payment-refactor-external' };
  target = externalTarget;
  bindings = [{ workspaceId: 'repo', worktreeId: 'wt-external', sessionId: 'head-external' }];
  sourceState.sessions.ids = ['head-external'];
  calls.splice(0);
  surfaceContentProps(renderTree(false)).openDashboard(externalTarget);
  assert.deepEqual(calls, [['nativeOpen', 'head-external']]);
  sourceState.currentSessionId = 'head-external';
  sourceState.sessions.current = 'head-external';
  renderTree(false);
  assert.deepEqual(dashboardStore.snapshot, {
    workspaceId: 'repo',
    worktreeId: 'wt-external',
    sessionId: 'head-external',
  });
  surfaceInput.dashboardStore = undefined;

  calls.splice(0);
  target = record;
  bindings = [{ workspaceId: 'repo', worktreeId: 'wt', sessionId: 'current' }];
  selected = selection;
  sourceState.currentSessionId = 'current';
  sourceState.sessions.current = 'current';
  sourceState.sessions.ids = ['current'];
  mutation.actionPending = true;
  props = render();
  props.onCreateSession();
  props.onCreateWorktree();
  props.onArchiveWorktree();
  assert.deepEqual(calls, []);
});

test('Main Tag projection renders a local status and omits derived acquisition and baseline facts', () => {
  const harness = renderHarness(async () => true);
  const main = createMainWorktreeRecord({ workspaceId: 'ws', path: '/repo/packages/app' }, null, '', {
    gitRootPath: '/repo', currentHead: { kind: 'tag', name: 'v1.0.0', commit: 'a'.repeat(40) },
  });
  const node = harness.render({ record: main });
  assert.equal(copyBranchTitle(node).props.children, 'v1.0.0');
  assert.equal(historicalHints(node, en).length, 0);
  assert.equal(findAll(node, (item) => item.props?.['data-health'] === 'unknown').length, 0);
  assert.equal(findAll(node, (item) => item.props?.['data-health'] === 'local').length, 1);
  assert.equal(findAll(node, (item) => item.type === 'dt' && [en['dashboard.created'], en['dashboard.base']].includes(item.props.children)).length, 0);
  for (const locale of [en, zh]) {
    for (const kind of ['tag', 'commit']) {
      const localized = harness.render({ t: (key) => locale[key],
        record: { ...main, currentHead: { ...main.currentHead, kind } } });
      assert.ok(findAll(localized, (item) => item.type === 'span' &&
        item.props.children === locale['dashboard.refKind.' + kind]).length > 0);
    }
  }
  harness.dispose();
});

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
    const { sidebar, center, right, overlay, surface } = appFrameFixture();
    let placement;
    let rightSidebarOpen = false;
    const dispose = mountDashboardOverlay(
      surface,
      (next) => {
        placement = next;
      },
      {
        onRightSidebarChange: (open) => {
          rightSidebarOpen = open;
        },
      },
    );
    assert.equal(placement.left, 284);
    assert.equal(placement.width, 676);
    assert.equal(rightSidebarOpen, false);
    right.setAttribute('data-sidebar-right-open', '');
    observers[1].callback();
    pending();
    assert.equal(rightSidebarOpen, true);
    right.removeAttribute('data-sidebar-right-open');
    observers[1].callback();
    pending();
    assert.equal(rightSidebarOpen, false);
    assert.equal(center.getAttribute('inert'), '');
    assert.equal(right.getAttribute('inert'), null);
    assert.equal(right.style.getPropertyValue('visibility'), '');
    sidebar.rect.right = 64;
    center.rect.left = 64;
    center.rect.width = 896;
    observers[0].callback();
    pending();
    assert.equal(placement.left, 68);
    assert.equal(placement.width, 892);
    // macOS hides the column completely; the bar's title clears native chrome,
    // while the native leading seat remains outside the concealed center.
    sidebar.rect.right = 0;
    center.rect.left = 0;
    center.rect.width = 960;
    observers[0].callback();
    pending();
    assert.equal(placement.left, 4);
    assert.equal(placement.width, 956);
    // Windows keeps its caption row above the native center. Dashboard content
    // must neither cover that row nor exceed the remaining center height.
    center.rect.top = 32;
    center.rect.height = 768;
    overlay.rect.top = 0;
    observers[0].callback();
    pending();
    assert.equal(placement.top, 32);
    assert.equal(placement.height, 768);
    // Actual center loss must fail closed; sibling adjacency is not a contract.
    const centerParent = center.parentElement;
    center.remove();
    observers[1].callback();
    pending();
    assert.equal(placement, undefined);
    assert.equal(center.getAttribute('inert'), null);
    assert.equal(right.style.getPropertyValue('visibility'), '');
    centerParent.append(center);
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

test('page-level Dashboard mounts when the native rightbar is absent', () => {
  const globals = ['HTMLElement', 'ResizeObserver', 'MutationObserver'];
  const saved = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, {
    HTMLElement: FakeElement,
    ResizeObserver: undefined,
    MutationObserver: undefined,
  });
  try {
    const { center, surface } = appFrameFixture({ rightbar: false });
    let placement;
    const dispose = mountDashboardOverlay(surface, (next) => {
      placement = next;
    });
    assert.deepEqual(placement, { left: 284, top: 0, width: 916, height: 800 });
    assert.equal(center.getAttribute('inert'), '');
    dispose();
    assert.equal(center.getAttribute('inert'), null);
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
  assert.equal(mainRec.instructions, '');

  const unavailable = createMainWorktreeRecord(ws);
  assert.equal(unavailable.branch, '');
  assert.equal(unavailable.currentBranch, undefined);
  assert.equal(unavailable.health, undefined);
  assert.equal(unavailable.source, undefined);
  assert.equal(unavailable.instructions, '');

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

test('OpenInAppController uses official relative routes and launches with the recorded path', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init });
    if (url === '/open-in-app/apps') {
      return {
        ok: true,
        json: async () => ({ apps: ['cursor', 'vscode', 'webstorm'] }),
      };
    }
    if (url === '/open-in-app/open') {
      return { ok: true };
    }
    return { ok: false, status: 404 };
  };

  const { OpenInAppController } = await import('../lib/client/dashboard/open-in-app-controller.js');
  const controller = new OpenInAppController(fetcher);
  assert.equal(controller.apps, null);

  await controller.load();
  assert.deepEqual(controller.apps, ['cursor', 'vscode', 'webstorm']);
  assert.equal(controller.iconUrl('cursor'), '/open-in-app/icon/cursor');

  controller.choose('cursor');
  assert.equal(controller.choice, 'cursor');

  await controller.launch('cursor', '/path/to/worktree with spaces');
  assert.deepEqual(requests, [
    {
      url: '/open-in-app/apps',
      init: { headers: { accept: 'application/json' } },
    },
    {
      url: '/open-in-app/open',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ app: 'cursor', path: '/path/to/worktree with spaces' }),
      },
    },
  ]);
});

test('OpenInAppController keeps application selection in memory without localStorage', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let accesses = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      accesses += 1;
      throw new Error('Open In must not access localStorage');
    },
  });

  try {
    const fetcher = async () => ({
      ok: true,
      json: async () => ({ apps: ['vscode', 'cursor'] }),
    });
    const { OpenInAppController } = await import('../lib/client/dashboard/open-in-app-controller.js');
    const pageController = new OpenInAppController(fetcher);
    await pageController.load();
    pageController.choose('cursor');
    assert.equal(pageController.choice, 'cursor');

    const refreshedPageController = new OpenInAppController(fetcher);
    assert.equal(refreshedPageController.choice, '');
    assert.equal(accesses, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('OpenInAppController degrades to an empty app list when the apps endpoint fails', async () => {
  const { OpenInAppController } = await import('../lib/client/dashboard/open-in-app-controller.js');
  const controller = new OpenInAppController(async () => {
    throw new Error('host unavailable');
  });

  await assert.doesNotReject(controller.load());
  assert.deepEqual(controller.apps, []);
});
