import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import ts from 'typescript';
import * as readerModule from '../lib/client/view/worktree-view-read.js';
import * as errors from '../lib/client/view/worktree-view-errors.js';
import * as selectors from '../lib/client/surface/selectors.js';
import * as session from '../lib/client/session/worktree-session.js';
import { createVirtualWorkspaceMembership } from '../lib/client/session/virtual-workspace-membership.js';

const compiled = ts.transpileModule(await readFile(new URL(
  '../src/client/surface/state/useSurfaceRefresh.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modules = {
  react: React, 'react-dom': ReactDOM,
  '../../session/worktree-session.js': session,
  '../../view/worktree-view.js': { ...readerModule, ...errors },
  '../selectors.js': selectors,
  '../shared.js': { EMPTY_READ_STATE: { status: 'idle', views: [] } },
};
const exports = {};
new Function('require', 'exports', compiled)((name) => {
  assert.ok(modules[name], name);
  return modules[name];
}, exports);
const { useSurfaceRefresh } = exports;
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(branch = 'main') {
  return { worktrees: [], bindings: [], mainInstructions: '',
    gitState: { ok: true, value: { currentBranch: branch } },
    checkout: { currentHead: { kind: 'branch', name: branch, commit: 'a'.repeat(40) } } };
}
const tick = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

test('pending native list replay retains visible Workspace rows and scoped sync preserves other bindings', () => {
  const ready = { phase: 'ready', items: [
    { workspaceId: 'a', sessionIds: ['native-a'] }, { workspaceId: 'b', sessionIds: ['native-b'] },
  ] };
  const pending = selectors.retainPendingWorkspaces(ready, { phase: 'pending',
    items: [{ workspaceId: 'a', sessionIds: [] }] });
  assert.deepEqual(pending.items.map((item) => item.workspaceId), ['a', 'b']);
  assert.deepEqual(pending.items[0].sessionIds, ['native-a']);
  assert.equal(pending.phase, 'pending');
  const confirmed = { phase: 'ready', items: [ready.items[0]] };
  assert.equal(selectors.retainPendingWorkspaces(pending, confirmed), confirmed);
  const list = { getSnapshot: () => ready, subscribe: () => () => {} };
  const membership = createVirtualWorkspaceMembership(list);
  membership.ensure({ workspaceId: 'b', sessionId: 'newly-bound-b' });
  membership.syncWorkspace('a', [{ workspaceId: 'a', sessionId: 'bound-a' }]);
  assert.ok(list.getSnapshot().items[1].sessionIds.includes('newly-bound-b'));
  membership.syncWorkspace('a', []);
  assert.ok(list.getSnapshot().items[1].sessionIds.includes('newly-bound-b'));
  assert.ok(!list.getSnapshot().items[0].sessionIds.includes('bound-a'));
  membership.dispose();
});

test('Surface cannot expand the coverage of an older Context prefetch', async (t) => {
  const dom = new JSDOM('<div id="root"></div>');
  const before = { window: globalThis.window, document: globalThis.document, act: globalThis.IS_REACT_ACT_ENVIRONMENT };
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  let nativeIds = ['old'];
  const pending = [];
  const manager = { readWorkspaceNavigation: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) };
  const reader = readerModule.createWorktreeViewReader(manager, () => nativeIds);
  const prefetch = reader.read('ws');
  nativeIds = ['old', 'new'];
  const source = { mode: 'worktree', workspaceIds: ['ws'], workspaceIdsRef: { current: ['ws'] },
    workspaces: { phase: 'ready', items: [{ workspaceId: 'ws', sessionIds: nativeIds }] },
    expandSnapshot: { collapsedWorkspaceIds: {} }, forkRecoverySnapshot: { revision: 0 }, sessionPresentations: {} };
  const props = { manager, viewReader: reader };
  const registrationState = { modalReadViewRef: { current: undefined }, setModalReadError() {},
    setModalReadLoading() {}, setWorktreeModalWorkspaceId() {}, modalReadLoader: { current: { invalidate() {} } } };
  let state;
  function Surface() { state = useSurfaceRefresh({ source, props, registrationState }); return null; }
  t.after(async () => {
    await React.act(async () => root.unmount()); reader.dispose(); dom.window.close();
    globalThis.window = before.window; globalThis.document = before.document; globalThis.IS_REACT_ACT_ENVIRONMENT = before.act;
  });
  await React.act(async () => { root.render(React.createElement(Surface)); await tick(); });
  assert.equal(pending.length, 1, 'entry still shares Context prefetch');
  await React.act(async () => { pending[0].resolve(snapshot()); await prefetch; await tick(); });
  assert.equal(selectors.resolveCurrentSessionLocation('new', source.workspaces.items, state.readState.views), undefined);
  assert.equal(pending.length, 2, 'an uncovered member requires a post-arrival read');
  await React.act(async () => { pending[1].reject(new Error('offline')); await tick(); await tick(); });
  assert.equal(pending.length, 2, 'a failed corrective read must not start an automatic retry loop');
  assert.ok(state.readState.targetErrors.ws);
  let retry;
  await React.act(async () => { retry = state.refresh({ scope: { kind: 'workspace', workspaceId: 'ws' } }); await tick(); });
  assert.equal(pending.length, 3);
  await React.act(async () => {
    pending[2].resolve({ ...snapshot(), worktrees: [{ workspaceId: 'ws', worktreeId: 'wt', status: 'active' }],
      bindings: [{ workspaceId: 'ws', sessionId: 'new', worktreeId: 'wt', status: 'active' }] });
    await retry; await tick();
  });
  assert.equal(selectors.resolveCurrentSessionLocation('new', source.workspaces.items, state.readState.views).worktreeId, 'wt');
});

test('a new native Session is not classified as Main by retained bindings', () => {
  const view = { workspaceId: 'ws', ...snapshot(), bindings: [], worktrees: [], knownSessionIds: ['old'] };
  assert.equal(selectors.resolveCurrentSessionLocation('new',
    [{ workspaceId: 'ws', sessionIds: ['old', 'new'] }], [view]), undefined);
});

test('progressive surface, bounded reads, re-entry, additions and mutation race', async (t) => {
  const dom = new JSDOM('<div id="root"></div>');
  const oldWindow = globalThis.window;
  const oldDocument = globalThis.document;
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(dom.window.document.getElementById('root'));
  const gates = new Map();
  const calls = [];
  let active = 0;
  let maximum = 0;
  const manager = { readWorkspaceNavigation: async ({ workspaceId }) => {
    calls.push(workspaceId);
    active += 1;
    maximum = Math.max(maximum, active);
    const gate = deferred();
    const list = gates.get(workspaceId) ?? [];
    list.push(gate);
    gates.set(workspaceId, list);
    try { return await gate.promise; } finally { active -= 1; }
  } };
  const reader = readerModule.createWorktreeViewReader(manager);
  let source = { mode: 'native', workspaceIds: ['slow', 'fast', 'failed', 'queued'],
    workspaceIdsRef: { current: [] },
    workspaces: { items: ['slow', 'fast', 'failed', 'queued'].map((workspaceId) =>
      ({ workspaceId, sessionIds: workspaceId === 'fast' ? ['current'] : [] })) },
    currentSessionId: 'current', expandSnapshot: { collapsedWorkspaceIds: { queued: true } },
    forkRecoverySnapshot: { revision: 0 }, sessionPresentations: new Map() };
  const syncs = [];
  const props = { manager, viewReader: reader,
    invalidateWorktreeContext: () => new Promise(() => {}),
    syncSessionWorkspaces: () => assert.fail('scoped synchronization must not use the full snapshot port'),
    syncWorkspaceSessions: (workspaceId, bindings) => syncs.push({ workspaceId, bindings }) };
  const registrationState = { modalReadViewRef: { current: undefined },
    setModalReadError() {}, setModalReadLoading() {}, setWorktreeModalWorkspaceId() {},
    modalReadLoader: { current: { invalidate() {} } } };
  let state;
  function Surface() {
    state = useSurfaceRefresh({ source, props, registrationState });
    return React.createElement('div', null, state.readState.views.map((view) =>
      React.createElement('span', { key: view.workspaceId }, view.workspaceId + ':' + view.currentBranch)));
  }
  async function render() {
    source.workspaceIdsRef.current = source.workspaceIds;
    await React.act(async () => { root.render(React.createElement(Surface)); await tick(); });
  }
  async function finish(id, value = snapshot()) {
    await React.act(async () => { gates.get(id).at(-1).resolve(value); await tick(); });
  }
  t.after(async () => {
    await React.act(async () => root.unmount());
    reader.dispose();
    dom.window.close();
    globalThis.window = oldWindow;
    globalThis.document = oldDocument;
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct;
  });
  // Context starts before entry; entry must share this same request.
  const prefetch = reader.read('fast');
  source = { ...source, mode: 'worktree' };
  await render();
  assert.deepEqual(calls, ['fast', 'slow', 'failed']);
  await finish('fast');
  await prefetch;
  assert.match(dom.window.document.body.textContent, /fast:main/);
  assert.equal(active, 3);
  assert.equal(maximum, 3);
  assert.deepEqual(syncs.map((item) => item.workspaceId), ['fast'],
    'publish only the completed Workspace while other memberships are pending');
  assert.equal(selectors.resolveCurrentSessionLocation('current',
    [{ workspaceId: 'slow', sessionIds: ['current'] }], state.readState.views), undefined);
  await React.act(async () => { gates.get('failed')[0].reject(new Error('offline')); await tick(); });
  assert.match(dom.window.document.body.textContent, /fast:main/);
  assert.deepEqual(Object.keys(state.readState.targetErrors), ['failed']);
  await finish('queued');
  await finish('slow');
  assert.deepEqual(state.readState.views.map((view) => view.workspaceId), ['slow', 'fast', 'queued']);
  assert.deepEqual(syncs.map((item) => item.workspaceId), ['fast', 'queued', 'slow']);
  source = { ...source, mode: 'native' };
  await render();
  assert.equal(state.readState.views.length, 3, 'exit preserves ready content');
  source = { ...source, mode: 'worktree', workspaceIds: [...source.workspaceIds, 'new'],
    workspaces: { items: [...source.workspaces.items, { workspaceId: 'new', sessionIds: [] }] } };
  await render();
  assert.match(dom.window.document.body.textContent, /fast:main/, 'ready content survives background validation');
  await finish('fast', snapshot('external'));
  assert.match(dom.window.document.body.textContent, /fast:external/);
  await finish('slow');
  await finish('failed');
  await tick();
  assert.equal(calls.filter((id) => id === 'new').length, 1, 'entry and addition share queued request');
  await finish('queued');
  await finish('new');
  assert.equal(maximum, 3);
  let background;
  await React.act(async () => {
    background = state.refresh({ scope: { kind: 'workspace', workspaceId: 'fast' }, reuseInFlight: true });
    await tick();
  });
  const obsolete = gates.get('fast').at(-1);
  let mutation;
  await React.act(async () => {
    mutation = state.refresh({ scope: { kind: 'workspace', workspaceId: 'fast' } });
    await tick();
  });
  await finish('fast', snapshot('post-mutation'));
  await mutation; // A never-finishing Context must not hold navigation refresh open.
  await React.act(async () => { obsolete.resolve(snapshot('stale')); await background; await tick(); });
  assert.match(dom.window.document.body.textContent, /fast:post-mutation/);
  assert.doesNotMatch(dom.window.document.body.textContent, /fast:stale/);

  source = { ...source, mode: 'native' };
  await render();
  source = { ...source, mode: 'worktree', workspaces: { phase: 'ready',
    items: source.workspaces.items.map((item) => item.workspaceId === 'fast'
      ? { ...item, sessionIds: ['current', 'new-bound'] } : item) } };
  await render();
  assert.equal(selectors.resolveCurrentSessionLocation('new-bound', source.workspaces.items,
    state.readState.views), undefined, 'new Session must not enter cached Main on re-entry');
  const boundSnapshot = { ...snapshot('bound'),
    worktrees: [{ workspaceId: 'fast', worktreeId: 'wt', status: 'active' }],
    bindings: [{ workspaceId: 'fast', worktreeId: 'wt', sessionId: 'new-bound', status: 'active' }] };
  await finish('fast', boundSnapshot);
  assert.equal(selectors.resolveCurrentSessionLocation('new-bound', source.workspaces.items,
    state.readState.views).worktreeId, 'wt');
  for (const id of ['slow', 'failed', 'queued', 'new']) await finish(id);
  source = { ...source, workspaces: { phase: 'ready',
    items: source.workspaces.items.map((item) => item.workspaceId === 'fast'
      ? { ...item, sessionIds: [...item.sessionIds, 'new-local'] } : item) } };
  await render();
  assert.equal(selectors.resolveCurrentSessionLocation('new-local', source.workspaces.items,
    state.readState.views), undefined, 'active-mode native addition needs a new binding read too');
  await finish('fast', boundSnapshot);
  assert.equal(selectors.resolveCurrentSessionLocation('new-local', source.workspaces.items,
    state.readState.views).kind, 'main');

  const beforePending = syncs.length;
  source = { ...source, workspaceIds: ['fast'], workspaces: { phase: 'pending',
    items: source.workspaces.items.filter((workspace) => workspace.workspaceId === 'fast') } };
  await render();
  assert.equal(syncs.length, beforePending, 'pending native subset must not clear unseen memberships');
  assert.equal(state.readState.views.length, 5, 'pending native subset must not discard ready Workspaces');

  source = { ...source, workspaceIds: ['slow', 'fast', 'failed', 'queued', 'new'],
    workspaces: { phase: 'ready', items: ['slow', 'fast', 'failed', 'queued', 'new'].map((workspaceId) =>
      ({ workspaceId, sessionIds: workspaceId === 'fast' ? ['current'] : [] })) } };
  await render();
  let failures;
  await React.act(async () => {
    failures = state.refresh({ scope: { kind: 'workspaces', workspaceIds: ['slow', 'failed'] } });
    await tick();
    gates.get('slow').at(-1).reject({ code: 'SIDECAR_CORRUPTED', message: 'A', details: { workspaceId: 'slow' } });
    gates.get('failed').at(-1).reject({ code: 'WORKTREE_RECOVERY_REQUIRED', message: 'B', details: { workspaceId: 'failed' } });
    await failures;
  });
  assert.equal(state.readState.targetErrors.slow.code, 'SIDECAR_CORRUPTED');
  assert.equal(state.readState.targetErrors.failed.code, 'WORKTREE_RECOVERY_REQUIRED');
  await React.act(async () => { void state.refresh({ scope: { kind: 'workspace', workspaceId: 'failed' } }); await tick(); });
  await finish('failed');
  assert.equal(state.readState.targetErrors.slow.code, 'SIDECAR_CORRUPTED');
  assert.equal(state.readState.targetErrors.failed, undefined);

  // An old owner must stay retired even after an identical Workspace ID returns.
  await React.act(async () => { void state.refresh({ scope: { kind: 'workspace', workspaceId: 'fast' } }); await tick(); });
  const removedRead = gates.get('fast').at(-1);
  const complete = source;
  source = { ...source, workspaceIds: source.workspaceIds.filter((id) => id !== 'fast'),
    workspaces: { phase: 'ready', items: source.workspaces.items.filter((item) => item.workspaceId !== 'fast') } };
  await render();
  source = complete;
  await render();
  assert.notEqual(gates.get('fast').at(-1), removedRead, 'returning ID needs a fresh reader generation');
  await finish('fast', snapshot('replacement'));
  await React.act(async () => { removedRead.resolve(snapshot('removed-owner')); await tick(); });
  assert.match(dom.window.document.body.textContent, /fast:replacement/);
  assert.doesNotMatch(dom.window.document.body.textContent, /fast:removed-owner/);
});
