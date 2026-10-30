import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as batch from '../lib/client/dashboard/batch-manage.js';
import * as selection from '../lib/client/dashboard/dashboard-selection.js';
import { runWorktreeCleanupFlow } from '../lib/client/surface/actions/worktree-cleanup-flow.js';
import { en, zh } from '../lib/client/locales.js';

const record = { workspaceId: 'repo', worktreeId: 'one', branch: 'feat/one', absolutePath: '/repo/one',
  status: 'active', health: 'ready', source: 'plugin', mutationToken: 'revision-1' };
const second = { ...record, worktreeId: 'two', branch: 'feat/two', absolutePath: '/repo/two' };
const archived = { ...record, status: 'removed' };
const archivedSecond = { ...second, status: 'removed' };

async function compile(path, modules) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)((name) => {
    assert.ok(name in modules, 'unmapped dependency: ' + name);
    return modules[name];
  }, exports);
  return exports;
}

test('batch eligibility preserves lifecycle guards and target identity across revision changes', () => {
  assert.equal(batch.canManageWorktree(record, 'archive'), true);
  for (const action of ['archive', 'clean', 'forget']) {
    assert.equal(batch.canManageWorktree({ ...record, health: 'recovery-needed' }, action), false);
    assert.equal(batch.canManageWorktree({ ...record, mutationToken: undefined }, action), false);
    assert.equal(batch.canManageWorktree({ ...record, worktreeId: selection.createMainWorktreeRecord({ workspaceId: 'repo', path: '/repo' }).worktreeId }, action), false);
  }
  assert.equal(batch.canManageWorktree({ ...record, status: 'removed' }, 'archive'), false);
  assert.equal(batch.canManageWorktree(record, 'clean'), false);
  assert.equal(batch.canManageWorktree(record, 'forget'), false);
  assert.equal(batch.canManageWorktree(archived, 'clean'), true);
  assert.equal(batch.canManageWorktree({ ...record, diskCleanup: 'completed' }, 'clean'), false);
  assert.equal(batch.canManageWorktree({ ...record, health: 'branch-drift' }, 'clean'), false);
  assert.equal(batch.canManageWorktree({ ...record, status: 'removed', diskCleanup: 'completed' }, 'forget'), true);
  assert.equal(batch.sameBatchTarget({ ...record, mutationToken: 'revision-2' }, record), true);
  for (const change of [{ absolutePath: '/other' }, { branch: 'changed' }, { status: 'removed' }, { gitRootPath: '/other' }]) {
    assert.equal(batch.sameBatchTarget({ ...record, ...change }, record), false);
  }
});

test('batch continues independent failures and stops scheduling after owner retirement', async () => {
  const calls = [], results = [];
  await batch.runWorktreeBatch('clean', [archived, archivedSecond], async (_action, target) => {
    calls.push(target.worktreeId);
    if (target.worktreeId === record.worktreeId) throw { code: 'WORKTREE_DIRTY', message: 'dirty' };
  }, () => true, (result) => results.push(result));
  assert.deepEqual(calls, ['one', 'two']);
  assert.equal(results[0].error.code, 'WORKTREE_DIRTY');
  assert.equal(results[1].error, undefined);
  let current = true;
  calls.length = 0;
  await batch.runWorktreeBatch('forget', [archived, archivedSecond], async (_action, target) => {
    calls.push(target.worktreeId); current = false;
  }, () => current, () => assert.fail('retired owner received a result'));
  assert.deepEqual(calls, ['one']);
});

async function operationsFixture() {
  const calls = [];
  const state = { current: { status: 'ready', views: [{ workspaceId: 'repo', worktrees: [record, second],
    bindings: [{ workspaceId: 'repo', worktreeId: 'one', sessionId: 'session', status: 'active' }] },
  { workspaceId: 'other', worktrees: [], bindings: [] }] } };
  let revision = 1;
  const mutate = async (action, target) => {
    assert.equal(target.mutationToken, 'revision-' + revision);
    calls.push([action, target.worktreeId]); revision++;
  };
  const input = {
    reader: { read: async (workspaceId) => state.current.views.find((view) => view.workspaceId === workspaceId) },
    props: { manager: { removeWorktree: (target) => mutate('archive', target),
      cleanWorktree: (target) => mutate('clean', target), forgetWorktree: (target) => mutate('forget', target) },
    permission: { normalizeDetachedWorktreePermissions: async () => { calls.push(['normalize']); return { status: 'normalized' }; } },
    onPermissionNotice: (...args) => calls.push(['notice', ...args]),
    onWorktreeForgotten: (target) => calls.push(['forgotten', target]) },
    read: { readStateRef: state, setReadState: (update) => { state.current = update(state.current); },
      refresh: async (options) => {
        calls.push(['refresh', options]);
        state.current = { ...state.current, views: state.current.views.map((view) => view.workspaceId !== 'repo' ? view : {
          ...view, worktrees: view.worktrees.map((item) => ({ ...item, mutationToken: 'revision-' + revision })),
        }) };
      } },
    mutation: { actionPending: false, setActionPending: (pending) => { calls.push(['pending', pending]); input.mutation.actionPending = pending; } },
    expansion: { suppressCurrentSessionReveal: (id) => calls.push(['suppress', id]), clearSessionGroups: (ids) => calls.push(['clear', ids]) },
    session: { pendingSessionBinding: { worktreeId: 'one' }, setPendingSessionBinding: (value) => calls.push(['binding', value]) },
    lifecycleState: { cleanupGuard: { current: { begin: () => 1, isCurrent: () => true, invalidate: () => calls.push(['invalidate']) } } },
  };
  const module = await compile('../src/client/surface/actions/useDashboardBatchManage.ts', {
    react: { useRef: (value) => ({ current: value }), useCallback: (callback) => callback },
    '../../dashboard/batch-manage.js': batch,
    '../selectors.js': { bindingIdsFor: (bindings, id) => bindings.filter((value) => value.worktreeId === id).map((value) => value.sessionId) },
    './worktree-cleanup-flow.js': { runWorktreeCleanupFlow },
  });
  return { execute: module.useDashboardBatchManage(input), input, calls, state };
}

test('production batch actions refresh tokens between items and preserve unrelated ready views', async () => {
  const { execute, calls, state } = await operationsFixture();
  const unrelated = state.current.views[1];
  const results = [];
  await batch.runWorktreeBatch('archive', [record, second], execute, () => true, (result) => results.push(result));
  assert.ok(results.every((result) => !result.error));
  assert.deepEqual(calls.filter(([action]) => action === 'archive'), [['archive', 'one'], ['archive', 'two']]);
  assert.ok(calls.filter(([action]) => action === 'refresh').every(([, options]) =>
    options.scope.kind === 'workspace' && options.scope.workspaceId === 'repo' && options.preserveCurrent));
  assert.equal(state.current.views[1], unrelated);
});

test('a failed Git cleanup refreshes rollback revisions before continuing the batch', async () => {
  const { execute, input, calls, state } = await operationsFixture();
  state.current.views[0].worktrees = [archived, archivedSecond];
  let revision = 1;
  input.props.manager.cleanWorktree = async (target) => {
    assert.equal(target.mutationToken, 'revision-' + revision);
    revision++;
    calls.push(['clean', target.worktreeId]);
    if (target.worktreeId === 'one') throw { code: 'GIT_COMMAND_FAILED', message: 'dirty worktree' };
  };
  input.read.refresh = async (options) => {
    calls.push(['refresh', options]);
    state.current = { ...state.current, views: state.current.views.map((view) => view.workspaceId !== 'repo' ? view : {
      ...view, worktrees: view.worktrees.map((item) => ({ ...item, mutationToken: 'revision-' + revision })),
    }) };
  };
  const results = [];
  await batch.runWorktreeBatch('clean', [archived, archivedSecond], execute, () => true, (result) => results.push(result));
  assert.equal(results[0].error.code, 'GIT_COMMAND_FAILED');
  assert.equal(results[1].error, undefined);
  assert.deepEqual(calls.filter(([action]) => action === 'clean'), [['clean', 'one'], ['clean', 'two']]);
  assert.equal(calls.filter(([action]) => action === 'refresh').length, 2);
  assert.ok(calls.filter(([action]) => action === 'refresh').every(([, options]) =>
    options.scope.workspaceId === 'repo' && options.preserveCurrent));
});

test('production cleanup detaches bindings and normalizes permissions; forget preserves native Sessions', async () => {
  const { execute, input, calls, state } = await operationsFixture();
  const unrelated = state.current.views[1];
  state.current.views[0].worktrees = [archived, archivedSecond];
  await execute('clean', archived);
  assert.equal(state.current.views[0].worktrees[0].health, 'cleaned');
  assert.equal(state.current.views[0].bindings[0].status, 'detached');
  assert.ok(calls.some(([action]) => action === 'normalize'));
  assert.ok(calls.some(([action]) => action === 'notice'));
  await execute('forget', state.current.views[0].worktrees[0]);
  assert.deepEqual(state.current.views[0].worktrees.map((item) => item.worktreeId), ['two']);
  assert.equal(state.current.views[0].bindings.length, 0);
  assert.deepEqual(calls.find(([action]) => action === 'forgotten')[1].sessionIds, ['session']);
  assert.equal(state.current.views[1], unrelated);
  assert.equal(input.mutation.actionPending, false);
});

test('production batch rejects changed targets and does not replay a committed mutation after read failure', async () => {
  const { execute, input, calls, state } = await operationsFixture();
  state.current.views[0].worktrees = [{ ...record, absolutePath: '/changed' }];
  await assert.rejects(execute('clean', record), { code: 'WORKTREE_STATE_CONFLICT' });
  assert.equal(calls.filter(([action]) => ['archive', 'clean', 'forget'].includes(action)).length, 0);
  state.current.views[0].worktrees = [record];
  input.read.refresh = async () => { throw new Error('read failed after commit'); };
  await execute('archive', record);
  assert.equal(calls.filter(([action]) => action === 'archive').length, 1);
});

test('batch uses the shared reader before React publishes refreshed state and retires an awaiting owner', async () => {
  const { execute, input, calls, state } = await operationsFixture();
  let cached = state.current.views[0];
  input.reader.read = async () => cached;
  input.read.refresh = async () => {
    cached = { ...cached, worktrees: cached.worktrees.map((item) => ({ ...item, mutationToken: 'revision-2' })) };
  };
  await execute('archive', record);
  assert.equal(state.current.views[0].worktrees[1].mutationToken, 'revision-1', 'React has not committed');
  await execute('archive', second);
  assert.equal(calls.filter(([action]) => action === 'archive').length, 2);
  let current = true;
  input.reader.read = async () => { current = false; return cached; };
  await assert.rejects(execute('archive', record, () => current), { code: 'WORKTREE_STATE_CONFLICT' });
  assert.equal(calls.filter(([action]) => action === 'archive').length, 2);
});

test('batch UI selects only its Workspace, confirms disk deletion, prevents duplicate submission and retains failures', async () => {
  const module = await compile('../src/client/dashboard/BatchManageWorktrees.tsx', {
    react: React, 'react/jsx-runtime': jsx,
    '@deepseek-ai/dsh-client-ui-primitives': {
      Button: ({ variant, ...props }) => { void variant; return React.createElement('button', props); },
      Modal: ({ open, title, description, children, footer }) => open ? React.createElement('div', { role: 'dialog' }, title, description, children, footer) : null,
    },
    '../view/worktree-error-copy.js': { formatWorktreeViewError: (error) => error.code },
    '../surface/components/NotificationToasts.js': { NotificationToasts: () => null },
    './batch-manage.js': batch, './dashboard.css': { default: {} }, './dashboard-selection.js': selection,
  });
  const dom = new JSDOM('<div id="app"></div>');
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('app'));
  const calls = [];
  let finish;
  const deferred = new Promise((resolve) => { finish = resolve; });
  const t = (key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replace('{' + name + '}', value), zh[key]);
  try {
    await React.act(async () => root.render(React.createElement(module.BatchManageWorktrees, {
      workspaceId: 'repo', worktrees: [{ ...archived, gitRootPath: '/repo/whole-checkout' }, archivedSecond,
        { ...record, worktreeId: 'active', branch: 'active', absolutePath: '/repo/active' },
        { ...record, workspaceId: 'other', worktreeId: 'hidden' }],
      t, actionPending: false, onManage: async (action, target) => {
        calls.push([action, target.worktreeId]);
        if (target.worktreeId === 'one') await deferred;
        else throw { code: 'WORKTREE_DIRTY', message: 'dirty' };
      },
    })));
    const doc = dom.window.document;
    const click = async (selector) => React.act(async () => doc.querySelector(selector).click());
    assert.equal(doc.querySelectorAll('input[type="checkbox"]').length, 4);
    await click('input[aria-label="全选"]');
    assert.match(doc.querySelector('[data-batch-action="archive"]').textContent, /\(1\)/u);
    assert.match(doc.querySelector('[data-batch-action="clean"]').textContent, /\(2\)/u);
    assert.match(doc.querySelector('[data-batch-action="forget"]').textContent, /\(2\)/u);
    await click('[data-batch-action="clean"]');
    assert.equal(calls.length, 0);
    assert.match(doc.querySelector('[role="dialog"]').textContent, /不可逆.*不会检查 Session/u);
    assert.match(doc.querySelector('[role="dialog"]').textContent, /\/repo\/whole-checkout/u);
    assert.equal(doc.querySelector('[data-batch-confirm]').disabled, true);
    await click('[role="dialog"] input');
    await click('[data-batch-confirm]');
    await click('[data-batch-confirm]');
    assert.deepEqual(calls, [['clean', 'one']]);
    await React.act(async () => { finish(); await deferred; });
    assert.deepEqual(calls, [['clean', 'one'], ['clean', 'two']]);
    assert.equal(doc.querySelectorAll('[data-batch-result="success"]').length, 1);
    assert.equal(doc.querySelectorAll('[data-batch-result="failed"]').length, 1);
    assert.equal(doc.querySelector('input[aria-label="feat/one · /repo/one"]').checked, false);
    assert.equal(doc.querySelector('input[aria-label="feat/two · /repo/two"]').checked, true);
    assert.equal(doc.querySelector('input[aria-label="active · /repo/active"]').checked, true);
    assert.equal(doc.querySelector('[role="dialog"]'), null);
    for (const locale of [en, zh]) assert.ok(locale['dashboard.manage.stopped']);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
