import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import * as view from '../lib/client/view/worktree-view.js';
import { WorktreeToolChanges } from '../lib/host/worktree-tool-changes.js';
import { createWorktreeToolChangeMonitor } from '../lib/client/worktree-tool-changes.js';
import { createWorktreeContextProjection } from '../lib/client/context/worktree-context-store.js';

const source = async (path) => readFile(new URL('../src/client/' + path, import.meta.url), 'utf8');
const compile = (code) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const surfaceAst = ts.createSourceFile('surface.tsx', await source('WorktreeSurface.tsx'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const entryAst = ts.createSourceFile('entry.ts', await source('entry.ts'), ts.ScriptTarget.Latest, true);
function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}
// Execute the production call sites, including their refresh options, rather
// than recreating notification/completion invalidation in the regression.
const syncAttribute = find(surfaceAst, (node) => ts.isJsxAttribute(node) && node.name.text === 'onSyncBaseline');
const syncCallback = syncAttribute.initializer.expression.whenTrue.getText(surfaceAst);
const monitorCall = find(entryAst, (node) => ts.isCallExpression(node) &&
  node.expression.getText(entryAst) === 'createWorktreeToolChangeMonitor');
const changedCallback = monitorCall.arguments[0].properties.find((node) => node.name?.text === 'changed')
  .initializer.getText(entryAst);
const invalidateCallback = find(entryAst, (node) => ts.isPropertyAssignment(node) &&
  node.name?.getText(entryAst) === 'invalidateWorktreeContext').initializer.getText(entryAst);
const makeSync = new Function('props', 'dashboardRecord', 'read', compile('return (' + syncCallback + ');'));
const makeChanged = new Function('viewReader', 'contextProjection', compile('return (' + changedCallback + ');'));
const makeInvalidate = new Function('contextProjection', compile('return (' + invalidateCallback + ');'));
const refreshCode = compile(await source('surface/state/useSurfaceRefresh.tsx'));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function snapshot(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(next) { value = next; listeners.forEach((listener) => listener()); },
  };
}

function refreshHarness(input) {
  const state = [], effects = [];
  let cursor = 0, pending = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], (next) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next;
      }];
    },
    useRef: (initial) => react.useState({ current: initial })[0],
    useMemo(create, deps) {
      const index = cursor++;
      if (!state[index] || deps.some((value, i) => value !== state[index].deps[i]))
        state[index] = { deps, value: create() };
      return state[index].value;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
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
  const exports = {};
  new Function('require', 'exports', refreshCode)((name) => ({
    react, '../../view/worktree-view.js': view,
    '../selectors.js': { worktreeActivityRefreshWorkspaceIds: () => [] },
    '../shared.js': { EMPTY_READ_STATE: { status: 'loading', views: [] } },
  })[name] ?? {}, exports);
  return {
    render() {
      cursor = 0; pending = [];
      const result = exports.useSurfaceRefresh(input);
      pending.forEach((effect) => effect());
      return result;
    },
    dispose() { effects.forEach((effect) => effect?.cleanup?.()); },
  };
}

for (const order of ['notification-first', 'completion-first', 'no-notification', 'call-failed', 'call-failed-late-notification']) {
  test(`baseline refresh ${order} shares post-change reads and preserves ready Workspaces`, async () => {
    const calls = [];
    let roster;
    const operation = deferred();
    const manager = {
      listWorktrees: async ({ workspaceId }) => {
        calls.push(['worktrees', workspaceId]);
        return workspaceId === 'target' && roster ? roster.promise : [];
      },
      listBindings: async ({ workspaceId }) => { calls.push(['bindings', workspaceId]); return []; },
      listBranches: async ({ workspaceId }) => {
        calls.push(['branches', workspaceId]); return [{ name: 'main', isCurrent: true }];
      },
      syncWorktreeBaseline: () => operation.promise,
    };
    const reader = view.createWorktreeViewReader(manager);
    const feed = new WorktreeToolChanges();
    const context = createWorktreeContextProjection({
      sessions: snapshot({ ids: ['current'], current: 'current', byId: {} }),
      workspaces: snapshot({ items: [
        { workspaceId: 'target', sessionIds: ['current'] },
        { workspaceId: 'unrelated', sessionIds: [] },
      ] }),
      viewReader: reader, storeFactory: snapshot,
    });
    const monitor = createWorktreeToolChangeMonitor({
      read: (revision, signal) => feed.watch(revision, signal),
      changed: makeChanged(reader, context),
    });
    const workspaceIds = ['target', 'unrelated'];
    const props = {
      manager, viewReader: reader, subscribeToolChanges: monitor.subscribe,
      invalidateWorktreeContext: makeInvalidate(context),
    };
    const h = refreshHarness({
      source: { mode: 'worktree', workspaceIds, workspaceIdsRef: { current: workspaceIds },
        sessionPresentations: {}, forkRecoverySnapshot: { revision: 0, affectedWorkspaceIds: [] } },
      props,
      registrationState: {
        modalReadViewRef: { current: undefined },
        setModalReadError() {}, setModalReadLoading() {}, setWorktreeModalWorkspaceId() {},
        modalReadLoader: { current: view.createWorktreeModalViewLoader(reader) },
      },
    });
    try {
      h.render();
      await setImmediate();
      const ready = h.render().readState;
      assert.equal(ready.status, 'ready');
      const readyContext = context.store.getSnapshot();
      assert.equal(readyContext.status, 'ready');
      calls.length = 0;
      roster = deferred();
      const read = h.render();
      const sync = makeSync(props, { workspaceId: 'target', worktreeId: 'wt' }, read);
      const result = sync('merge', 'main', 'sync-request');
      // Attach rejection handling before completing the failed call.
      const settled = result.catch((error) => error);
      monitor.start();
      const notify = () => feed.changed('target', 'wt', 'sync-request');
      if (order === 'notification-first') {
        notify();
        await setImmediate();
      }
      if (order.startsWith('call-failed')) operation.reject(new Error('transport lost'));
      else operation.resolve({ sessionId: 'created', status: 'dispatched' });
      await settled;
      if (order === 'completion-first') notify();
      await setImmediate();
      assert.deepEqual(calls, [
        ['worktrees', 'target'], ['branches', 'target'], ['bindings', 'target'],
      ], 'both paths share one complete target read; fallback still reads without a notification');
      const pendingState = h.render().readState;
      assert.equal(pendingState.status, 'ready');
      assert.equal(pendingState.views, ready.views, 'keep all ready content while the read is pending');
      assert.equal(context.store.getSnapshot().status, 'ready');
      assert.equal(context.store.getSnapshot().value, readyContext.value, 'keep ready Context visible too');
      roster.resolve([{ workspaceId: 'target', worktreeId: 'fresh' }]);
      await setImmediate();
      const refreshed = h.render().readState;
      assert.equal(refreshed.views[0].worktrees[0].worktreeId, 'fresh');
      assert.equal(refreshed.views[1], ready.views[1], 'unrelated Workspace retains its ready reference');
      if (order === 'notification-first') {
        // A new, uncorrelated mutation must still invalidate this Workspace.
        feed.changed('target', 'wt');
        await setImmediate();
        assert.equal(calls.filter(([kind]) => kind === 'bindings').length, 2);
      }
      if (order === 'call-failed-late-notification') {
        // The Host may finish admission after a lost response and a recovery
        // read. That notification still needs to reveal the created Session.
        notify();
        await setImmediate();
        assert.equal(calls.filter(([kind]) => kind === 'bindings').length, 2);
      }
    } finally {
      h.dispose(); monitor.dispose(); feed.dispose(); context.dispose(); reader.dispose();
    }
  });
}
