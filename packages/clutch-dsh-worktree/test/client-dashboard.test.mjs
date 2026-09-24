import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import { URL } from 'node:url';
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
        './dashboard-overlay.js': {},
        './dashboard-selection.js': { isMainWorktreeId, createMainWorktreeRecord, resolveDashboardRecord },
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
      })[name] ?? {},
    exports,
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
const historicalHints = (node, t) =>
  findAll(
    node,
    (item) => item.type === 'span' && item.props.children === t['dashboard.historicalUnavailable'],
  );

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
    assert.equal(findAll(node, (item) => item.type === 'h1')[0].props.children, record.branch);
    assert.ok(
      findAll(
        node,
        (item) =>
          item.type === 'span' &&
          Array.isArray(item.props.children) &&
          item.props.children.includes(locale['dashboard.preview']),
      ),
      'dashboard topline uses the preview label',
    );
    assert.ok(
      findAll(node, (item) => item.type === 'code').some(
        (item) => item.props.children === record.absolutePath,
      ),
    );
    assert.equal(byRole(node, 'tab').length, 5);
    assert.ok(findAll(node, (item) => item.type === 'button' && item.props.disabled).length >= 8);
  }
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
  const search = findAll(node, (item) => item.props?.['data-dashboard-baseline-search'])[0];
  assert.ok(search);
  assert.equal(search.props.autoFocus, undefined);
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
    (item) => item.props?.['data-dashboard-baseline-options'] !== undefined,
  )[0];
  assert.ok(optionsSurface);
  const listbox = byRole(optionsSurface, 'listbox')[0];
  assert.equal(byRole(listbox, 'option').length, 2);
  let options = findAll(node, (item) => item.props?.['data-dashboard-baseline-option'] !== undefined);
  assert.deepEqual(
    options.map((option) => option.props['data-dashboard-baseline-option']),
    ['main', 'develop'],
  );
  assert.equal(options[0].props['aria-selected'], true);
  assert.equal(options[1].props['aria-selected'], false);
  assert.equal(findAll(options[0], (item) => item.props?.['data-icon'] === 'check').length, 1);

  search.props.onKeyDown({ key: 'ArrowUp', preventDefault() {} });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-dashboard-baseline-option'] !== undefined);
  assert.equal(options[0].props['aria-selected'], false);
  assert.equal(options[1].props['aria-selected'], true);
  const wrappedSearch = findAll(node, (item) => item.props?.['data-dashboard-baseline-search'])[0];
  wrappedSearch.props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-dashboard-baseline-option'] !== undefined);
  assert.equal(options[0].props['aria-selected'], true);
  assert.equal(options[1].props['aria-selected'], false);

  search.props.onChange({ currentTarget: { value: 'dev' } });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-dashboard-baseline-option'] !== undefined);
  assert.deepEqual(
    options.map((option) => option.props['data-dashboard-baseline-option']),
    ['develop'],
  );
  search.props.onChange({ currentTarget: { value: 'missing' } });
  node = harness.render();
  assert.equal(
    findAll(node, (item) => item.props?.['data-dashboard-baseline-empty'])[0].props.children,
    en['dashboard.noMatchingBranches'],
  );
  assert.equal(
    findAll(node, (item) => item.props?.['data-dashboard-baseline-option'] !== undefined).length,
    0,
  );
  // An empty result swaps in the status message without removing the frame.
  assert.equal(
    findAll(node, (item) => item.props?.['data-dashboard-baseline-options']).length,
    1,
  );
  assert.equal(byRole(node, 'listbox').length, 0);
  search.props.onChange({ currentTarget: { value: 'dev' } });
  node = harness.render();
  options = findAll(node, (item) => item.props?.['data-dashboard-baseline-option'] !== undefined);
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

test('baseline picker keeps a long branch roster in one scrollable list', () => {
  const harness = renderHarness(async (branch) => branch);
  const branches = Array.from({ length: 24 }, (_, index) => ({
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
  assert.equal(options.length, 24);
  assert.equal(options[0].props['data-dashboard-baseline-option'], 'branch-00');
  assert.equal(options[0].props['aria-selected'], true);
  assert.equal(options.at(-1).props['data-dashboard-baseline-option'], 'branch-23');
  harness.dispose();
});

test('baseline picker renders one fixed, elevated, scrollable branch list', () => {
  const modalStyles = dashboardCssSource.slice(
    dashboardCssSource.indexOf('.dashboardBaselineModal {'),
    dashboardCssSource.indexOf('.dashboardBaselineSearch {'),
  );
  assert.match(modalStyles, /width: min\(440px, calc\(100vw - 48px\)\);/);
  assert.match(modalStyles, /max-height: calc\(100dvh - 48px\);/);
  assert.match(modalStyles, /min-height: 0;\n\s+overflow-y: auto;/);

  const pickerStyles = dashboardCssSource.slice(
    dashboardCssSource.indexOf('.dashboardBaselinePicker {'),
    dashboardCssSource.indexOf('.dashboardBaselineOption {'),
  );
  // A fixed (not max-) height viewport: filtering swaps rows and never resizes
  // the list, so the modal frame stays put.
  assert.match(
    pickerStyles,
    /\.dashboardBaselineOptions \{[\s\S]*?max-width: min\(420px, calc\(100vw - 32px\)\);[\s\S]*?height: clamp\(258px, 48dvh, 300px\);[\s\S]*?overflow-y: auto;/,
  );
  assert.doesNotMatch(pickerStyles, /max-height:/);
  assert.match(pickerStyles, /background: var\(--dsw-specific-menu/);
  assert.match(pickerStyles, /border-radius: 20px;/);
  // The Input primitive's wrapper is content-box, so the search field opts into
  // border-box to stay flush with the branch list below it.
  assert.match(
    pickerStyles,
    /\.dashboardBaselineSearch \{[\s\S]*?box-sizing: border-box;[\s\S]*?width: 100%;/,
  );
  assert.match(pickerStyles, /\.dashboardBaselineList \{[\s\S]*?flex-direction: column;/);
  // The error floats over the list instead of growing the frame.
  assert.match(
    dashboardCssSource,
    /\.dashboardBaselineError \{[\s\S]*?position: absolute;/,
  );
  assert.match(
    dashboardCssSource,
    /\.dashboardBaselineOption \{[\s\S]*?min-height: 40px;[\s\S]*?border-radius: 10px;/,
  );
  assert.match(source, /scrollIntoView\(\{ block: 'nearest' \}\)/);
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
  assert.equal(byRole(harness.render(), 'alert')[0].props.children, en['dashboard.copyFailed']);
  copyButton(harness.render()).props.onClick();
  complete(true);
  await tick();
  assert.equal(byRole(harness.render(), 'status')[0].props.children, en['dashboard.copied']);
  harness.dispose();
});

test('dashboard title copies the accepted branch and coalesces keyboard activation', async () => {
  const calls = [];
  let complete;
  const harness = renderHarness((value) => {
    calls.push(value);
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  let prevented = 0;
  const title = copyBranchTitle(harness.render());
  title.props.onClick();
  title.props.onClick();
  title.props.onKeyDown({ key: 'Enter', preventDefault: () => prevented++ });
  title.props.onKeyDown({ key: ' ', preventDefault: () => prevented++ });
  assert.deepEqual(calls, [record.branch]);
  assert.equal(prevented, 2);
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
    node.props.onKeyDown({
      key: 'Escape',
      currentTarget: { querySelector: () => ({ role: 'menu' }) },
      stopPropagation() { assert.fail('The native menu must receive Escape'); },
    });
    assert.equal(closed, 0);
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
  const { buildSessionFileAddress } = await import('../lib/client/dashboard/git/file-address.js');
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
    if (name.endsWith('file-address.js')) return { buildSessionFileAddress };
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
  ]);
  bindings.shift();
  sourceState.sessions.ids = ['current'];
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
  surfaceContentProps(renderTree(false)).openDashboard(switchingTarget);
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
  assert.deepEqual(calls, [['closeRightSidebar']]);
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
    right.rect.left = 960;
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
    observers[0].callback();
    pending();
    assert.equal(placement.left, 68);
    assert.equal(placement.width, 892);
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

test('page-level Dashboard mounts when the native rightbar is absent', () => {
  const globals = ['HTMLElement', 'ResizeObserver', 'MutationObserver'];
  const saved = Object.fromEntries(globals.map((key) => [key, globalThis[key]]));
  Object.assign(globalThis, {
    HTMLElement: FakeElement,
    ResizeObserver: undefined,
    MutationObserver: undefined,
  });
  try {
    const [frame, sidebar, center, overlay, surface] = Array.from(
      { length: 5 },
      () => new FakeElement(),
    );
    frame.firstElementChild = sidebar;
    sidebar.nextElementSibling = center;
    center.nextElementSibling = overlay;
    overlay.parentElement = frame;
    surface.closest = () => overlay;
    sidebar.rect.right = 280;
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
