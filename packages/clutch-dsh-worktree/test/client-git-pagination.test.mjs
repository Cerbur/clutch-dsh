import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { en } from '../lib/client/locales.js';
import * as facts from '../lib/client/dashboard/git/git-facts.js';
import { toWorktreeViewError } from '../lib/client/view/worktree-view.js';
import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';
import * as queue from '../lib/client/surface/notification-queue.js';
import * as center from '../lib/client/surface/notification-center.js';
import * as diagnostics from '../lib/client/settings/diagnostics.js';
import { createWorktreeGitStateController } from '../lib/client/dashboard/git/useWorktreeGitState.js';
import { createWorktreeViewReader } from '../lib/client/view/worktree-view-read.js';
import { readWorkspaceNavigation } from '../lib/manage/manager-navigation.js';
import { listWorktreeCommits, listWorktreeCommitFiles } from '../lib/manage/manager-git-history.js';
import { LocalGitAdapter } from '../lib/provider/git/adapter.js';

const t = (key, values = {}) => en[key].replace(/\{(\w+)\}/gu, (_, name) => String(values[name]));
const jsx = (type, props) => ({ type, props });

async function loadComponent(name, modules = {}) {
  const source = await readFile(new URL('../src/client/dashboard/git/' + name + '.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((id) => ({
    react: { useRef: (value) => ({ current: value }), useMemo: (read) => read(),
      useState: (value) => [value, () => {}], useLayoutEffect: (effect) => effect() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './git-facts.js': facts,
    '../../view/worktree-view.js': { toWorktreeViewError },
    '../../view/worktree-error-copy.js': { formatWorktreeViewError },
    '../../surface/notification-queue.js': queue,
    './useGitPaneSplit.js': { useGitPaneSplit: () => ({}) },
    './worktree-git.css': { default: {} },
    ...modules,
  })[id] ?? {}, exports);
  return modules.exportAll ? exports : exports[path.basename(name)];
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test('opening and refreshing distinguish a missing Workspace root from a missing Worktree checkout', async (testContext) => {
  const temp = await mkdtemp(path.join(tmpdir(), 'worktree-read-notices-'));
  const rootPath = path.join(temp, 'workspace');
  const workspaceId = 'ws';
  const worktreeId = 'wt';
  const record = { workspaceId, worktreeId, absolutePath: path.join(temp, 'checkout'),
    branch: 'feature', source: 'external', status: 'active' };
  const context = {
    dsh: { getWorkspace: async () => ({ workspaceId, rootPath }) },
    sidecar: { read: async () => ({ schemaVersion: 1, workspaceId, revision: '1', worktrees: [record], bindings: [] }) },
    git: new LocalGitAdapter(),
  };
  const manager = { readWorkspaceNavigation: (input) => readWorkspaceNavigation(context, input),
    listWorktreeCommits: (input) => listWorktreeCommits(context, input),
    listWorktreeCommitFiles: (input) => listWorktreeCommitFiles(context, input) };
  const reader = createWorktreeViewReader(manager);
  const controller = createWorktreeGitStateController({ manager, workspaceId, worktreeId, defaultBaselineBranch: 'main' });
  const { NotificationRecovery: Toasts, NotificationPresenter } = await loadComponent('../../surface/components/NotificationRecovery', {
    exportAll: true,
    react: React, 'react/jsx-runtime': jsxRuntime, '../notification-queue.js': queue,
    '../notification-center.js': center,
    '@deepseek-ai/dsh-client-ui-primitives': { Toast: ({ text }) => React.createElement('output', null, text) },
  });
  const Panel = await loadComponent('WorktreeGitPanel', {
    './useWorktreeGitState.js': { useWorktreeGitState: controller.getSnapshot },
    '../../surface/components/NotificationRecovery.js': { NotificationRecovery: Toasts },
  });
  const Surface = await loadComponent('../../surface/components/SurfaceContent', {
    '../../worktree.css': { default: {} }, './NotificationRecovery.js': { NotificationRecovery: Toasts },
  });
  const dom = new JSDOM('<div id="root"></div>');
  const before = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  testContext.after(async () => {
    await React.act(async () => root.unmount());
    reader.dispose(); controller.dispose(); center.worktreeNotifications.dispose();
    dom.window.close(); globalThis.window = before.window; globalThis.document = before.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = before.act;
    await rm(temp, { recursive: true, force: true });
  });
  const renderNotices = async (refresh, origin) => {
    if (refresh) reader.invalidate(workspaceId);
    const [view] = await Promise.all([reader.read(workspaceId), refresh ? controller.refresh(origin) : controller.loadHistory()]);
    const surface = Surface({ source: { workspaces: { items: [{ workspaceId, path: rootPath, title: 'Workspace' }] },
      forkRecoverySnapshot: { pending: [] } }, props: { t }, lifecycle: {}, mutation: {}, session: {},
      read: { readState: { status: 'ready', views: [view] } }, expansion: { contentRef: { current: null } } });
    const panel = Panel({ workspaceId, worktreeId, t });
    await React.act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(NotificationPresenter, { t }),
      ...[surface, panel].map((tree, key) => React.createElement(Toasts, {
        ...nodes(tree).find((node) => node.type === Toasts).props, key,
      })))));
    return view;
  };
  for (const refresh of [false, true]) {
    const view = await renderNotices(refresh);
    assert.equal(view.readiness.status, 'workspaceMissing');
    assert.deepEqual(view.worktrees.map((item) => item.worktreeId), [worktreeId]);
    assert.equal(dom.window.document.querySelector('output')?.textContent, undefined, 'missing Workspace must stay silent');
    const entries = diagnostics.worktreeDiagnostics.getSnapshot().filter((entry) => entry.status === 'active');
    assert.ok(entries.some((entry) => entry.error?.code === 'WORKSPACE_ROOT_MISSING' &&
      entry.error.details.rootPath === rootPath && entry.context.includes(rootPath)));
  }
  await mkdir(rootPath);
  const git = (args) => execFileSync('git', args, { cwd: rootPath, timeout: 10_000, maxBuffer: 1024 * 1024 });
  git(['init', '-b', 'main']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial']);
  git(['worktree', 'add', '-b', record.branch, record.absolutePath]);
  await renderNotices(true);
  if (controller.getSnapshot().files.status === 'loading') {
    await new Promise((resolve) => {
      const unsubscribe = controller.subscribe(() => {
        if (controller.getSnapshot().files.status === 'loading') return;
        unsubscribe(); resolve();
      });
    });
  }
  assert.equal(controller.getSnapshot().files.status, 'ready');
  const previous = controller.getSnapshot().history.value;
  assert.ok(previous);
  await rm(record.absolutePath, { recursive: true });
  await renderNotices(true, 'background');
  assert.equal(controller.getSnapshot().history.value, previous);
  assert.equal(controller.getSnapshot().history.showingCachedView, true);
  assert.equal(dom.window.document.querySelector('output')?.textContent, undefined);
  assert.ok(diagnostics.worktreeDiagnostics.getSnapshot().some((entry) =>
    entry.status === 'active' && entry.error?.code === 'WORKTREE_NOT_FOUND'));
  const view = await renderNotices(true);
  assert.equal(view.readiness.status, 'ready');
  assert.equal(controller.getSnapshot().history.error.code, 'WORKTREE_NOT_FOUND');
  assert.equal(dom.window.document.querySelector('output')?.textContent, en['error.worktreeNotFound'] + ' ' + en['settings.toastHint']);
  assert.ok(!diagnostics.worktreeDiagnostics.getSnapshot().some((entry) =>
    entry.status === 'active' && entry.error?.code === 'WORKSPACE_ROOT_MISSING'));
});

test('native Changes entry stays available without Git history and explains the independent baseline', async () => {
  let opens = 0;
  const Panel = await loadComponent('WorktreeGitPanel', {
    './useWorktreeGitState.js': { useWorktreeGitState: () => ({
      branches: { status: 'idle' }, view: 'commits', selectedCommits: [],
      files: { status: 'idle' }, diff: { status: 'idle' }, history: { status: 'loading' },
    }) },
  });
  const tree = nodes(Panel({ workspaceId: 'ws', worktreeId: 'wt', t,
    onOpenNativeChanges: async () => { opens++; } }));
  const button = tree.find((node) => node.props?.['data-dashboard-git-native-changes'] !== undefined);
  assert.equal(button.props['aria-label'], en['dashboard.git.native.open']);
  assert.equal(button.props.disabled, false);
  await button.props.onClick();
  assert.equal(opens, 1);
  assert.ok(button.props.title.includes(en['dashboard.git.native.baselineHint']));
});

test('native open forwards the selected Base even while old history remains visible', async () => {
  const state = { branches: { status: 'idle' }, view: 'commits', selectedCommits: [],
    files: { status: 'idle' }, diff: { status: 'idle' },
    history: { status: 'ready', value: { commits: [], baseline: { ref: 'refs/heads/old' } } } };
  const Panel = await loadComponent('WorktreeGitPanel', {
    './useWorktreeGitState.js': { useWorktreeGitState: () => state },
  });
  for (const worktreeId of ['wt', 'main:ws']) {
    for (const baseBranch of ['refs/heads/selected', undefined]) {
      state.baselineBranch = baseBranch;
      let received;
      const button = nodes(Panel({ workspaceId: 'ws', worktreeId, t,
        defaultBaselineBranch: 'refs/heads/saved',
        onOpenNativeChanges: async (base, current) => { received = [base, current()]; },
      })).find((node) => node.props?.['data-dashboard-git-native-changes'] !== undefined);
      await button.props.onClick();
      assert.deepEqual(received, [baseBranch, true]);
    }
  }
});

test('Base changes and Git panel unmount retire the captured native-open lifetime', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  const state = { baselineBranch: 'refs/heads/first', branches: { status: 'idle' },
    view: 'commits', selectedCommits: [], files: { status: 'idle' },
    diff: { status: 'idle' }, history: { status: 'loading' } };
  const Panel = await loadComponent('WorktreeGitPanel', {
    react: React, './useWorktreeGitState.js': { useWorktreeGitState: () => state },
  });
  let tree;
  let current;
  function Harness() {
    tree = Panel({ workspaceId: 'ws', worktreeId: 'wt', t,
      onOpenNativeChanges: async (_base, guard) => { current = guard; } });
    return null;
  }
  const render = () => React.act(async () => root.render(React.createElement(Harness)));
  const click = () => React.act(async () => {
    await nodes(tree).find((node) => node.props?.['data-dashboard-git-native-changes'] !== undefined).props.onClick();
  });
  try {
    await render(); await click();
    const first = current;
    assert.equal(first(), true);
    state.baselineBranch = 'refs/heads/second';
    await render();
    assert.equal(first(), false);
    // Even switching back cannot revive the retired click.
    state.baselineBranch = 'refs/heads/first';
    await render();
    assert.equal(first(), false);
    await click();
    assert.equal(current(), true);
    await React.act(async () => root.unmount());
    assert.equal(current(), false);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('pagination conflicts turn the load-more button into a refresh action', async () => {
  let refreshes = 0;
  let pages = 0;
  const List = await loadComponent('GitCommitList');
  const Panel = await loadComponent('WorktreeGitPanel', {
    './GitCommitList.js': { GitCommitList: List },
    './useWorktreeGitState.js': { useWorktreeGitState: () => ({
      branches: { status: 'idle' }, view: 'commits', selectedCommits: [],
      files: { status: 'idle' }, diff: { status: 'idle' },
      history: { status: 'ready', value: { commits: [{ sha: 'a'.repeat(40) }], nextOffset: 50 } },
      loadMoreError: Object.assign(new Error('HEAD moved'), { code: 'WORKTREE_STATE_CONFLICT' }),
      refresh: () => { refreshes++; }, loadMore: () => { pages++; },
    }) },
  });
  const listProps = nodes(Panel({ workspaceId: 'ws', worktreeId: 'main:ws', t }))
    .find((node) => node.type === List).props;
  const button = nodes(List(listProps)).find((node) => node.props?.['data-dashboard-git-load-more'] !== undefined);
  assert.equal(button.props.children, en['dashboard.git.refresh']);
  button.props.onClick();
  assert.equal(refreshes, 1);
  assert.equal(pages, 0);
});

test('Local hides totals with None and both comparison views display the complete diff count', async () => {
  let history = { headCommit: 'a'.repeat(40), commits: [{ sha: 'a'.repeat(40) }], truncated: false };
  const state = { branches: { status: 'idle' }, view: 'commits', selectedCommits: [],
    files: { status: 'idle' }, diff: { status: 'idle' } };
  const BranchSelector = () => {};
  const Panel = await loadComponent('WorktreeGitPanel', {
    './useWorktreeGitState.js': { useWorktreeGitState: () => ({
      ...state, history: { status: 'ready', value: history },
    }) },
    '../../branch/GitBranchSelector.js': { GitBranchSelector: BranchSelector },
  });
  const render = (worktreeId) => nodes(Panel({ workspaceId: 'ws', worktreeId, t }));
  const plain = render('main:ws');
  assert.equal(plain.find((node) => node.type === BranchSelector).props.emptyLabel, 'None');
  assert.equal(plain.some((node) => node.type === 'dt' && node.props.children === en['dashboard.git.commits']), false);
  history = { ...history, baseline: { commit: 'b'.repeat(40), ref: 'base' }, ahead: 298, behind: 2,
    commits: Array.from({ length: 50 }, (_, i) => ({ sha: i.toString(16).padStart(40, '0') })),
    nextOffset: 50, truncated: true };
  for (const id of ['main:ws', 'wt']) {
    const comparison = render(id);
    assert.ok(comparison.some((node) => node.type === 'dd' &&
      node.props.children === t('dashboard.git.commitCount', { n: 298 })));
    assert.ok(comparison.some((node) => node.props?.['data-dashboard-git-summary'] !== undefined));
  }
});

test('commit list loads another page only near the bottom and pauses while loading or after failure', async () => {
  let reads = 0;
  const List = await loadComponent('GitCommitList');
  const props = { commits: [], hasMore: true, t, onLoadMore: () => { reads++; } };
  const scroll = (extra, scrollTop) => List({ ...props, ...extra }).props.onScroll({
    currentTarget: { scrollHeight: 1000, clientHeight: 300, scrollTop },
  });
  scroll({}, 100);
  assert.equal(reads, 0);
  scroll({}, 700);
  assert.equal(reads, 1);
  scroll({ loadingMore: true }, 700);
  scroll({ loadMoreError: true }, 700);
  scroll({ hasMore: false }, 700);
  assert.equal(reads, 1);
  const button = nodes(List(props)).find((node) => node.props?.['data-dashboard-git-load-more'] !== undefined);
  button.props.onClick();
  assert.equal(reads, 2);
});
