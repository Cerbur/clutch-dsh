import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { en } from '../lib/client/locales.js';
import * as facts from '../lib/client/dashboard/git/git-facts.js';
import { toWorktreeViewError } from '../lib/client/view/worktree-view.js';
import { formatWorktreeViewError } from '../lib/client/view/worktree-error-copy.js';
import { failureToastKey } from '../lib/client/surface/notification-queue.js';

const t = (key, values = {}) => en[key].replace(/\{(\w+)\}/gu, (_, name) => String(values[name]));
const jsx = (type, props) => ({ type, props });

async function loadComponent(name, modules = {}) {
  const source = await readFile(new URL('../src/client/dashboard/git/' + name + '.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', output)((id) => ({
    react: { useRef: (value) => ({ current: value }), useMemo: (read) => read() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './git-facts.js': facts,
    '../../view/worktree-view.js': { toWorktreeViewError },
    '../../view/worktree-error-copy.js': { formatWorktreeViewError },
    '../../surface/notification-queue.js': { failureToastKey },
    './useGitPaneSplit.js': { useGitPaneSplit: () => ({}) },
    './worktree-git.css': { default: {} },
    ...modules,
  })[id] ?? {}, exports);
  return exports[name];
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

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
