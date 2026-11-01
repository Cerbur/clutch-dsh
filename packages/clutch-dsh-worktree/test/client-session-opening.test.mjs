import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import ts from 'typescript';
import { setImmediate as flush } from 'node:timers/promises';
import * as sessionHelpers from '../lib/client/session/worktree-session.js';
import * as viewHelpers from '../lib/client/view/worktree-view.js';
const { createWorktreeSessionConnector } = sessionHelpers;

test('native Worktree Session is never opened in Local while its binding projection is pending', async () => {
  const target = { workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo/wt', status: 'active' };
  let projected = false;
  let release;
  const projection = new Promise((resolve) => { release = resolve; });
  const visibleGroups = [];
  const connector = createWorktreeSessionConnector({
    manager: { listWorktrees: async () => [target], listBindings: async () => [] },
    sessions: { getSnapshot: () => ({ phase: 'ready', ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    createSession: () => assert.fail('Host owns creation'),
    createBoundSession: async () => ({ sessionId: 'new', bound: true }),
    ensureSessionWorkspace() {},
    openSession: () => visibleGroups.push(projected ? 'wt' : 'Local'),
  });
  const pending = connector.create({ workspaceId: 'ws', worktreeId: 'wt', cwd: '/repo/wt' }, async () => {
    await projection;
    projected = true;
  });
  await flush();
  assert.deepEqual(visibleGroups, []);
  release();
  await pending;
  assert.deepEqual(visibleGroups, ['wt']);
  connector.dispose();
});

async function loadHook(file, dependencies) {
  const source = await readFile(new URL(`../src/client/surface/${file}.tsx`, import.meta.url), 'utf8');
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)((name) => dependencies[name] ?? {}, exports);
  return exports;
}

for (const outcome of ['ready', 'slow-context', 'failed', 'missing-binding', 'superseded', 'overlap-ready',
  'overlap-old-failed', 'overlap-latest-failed', 'overlap-latest-missing']) {
  test(`Session action publishes the real scoped projection before opening: ${outcome}`, async () => {
    const target = { workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo/wt', status: 'active' };
    const other = { workspaceId: 'other', worktrees: [], bindings: [] };
    let state = { status: 'ready', views: [{ workspaceId: 'ws', worktrees: [target], bindings: [] }, other] };
    let release;
    const barrier = new Promise((resolve) => { release = resolve; });
    const calls = [];
    let reads = 0;
    const react = {
      useState: (initial) => initial?.views ? [state, (next) => { state = typeof next === 'function' ? next(state) : next; }]
        : [initial, () => {}],
      useRef: (current) => ({ current }), useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect() {},
    };
    const dependencies = {
      react, 'react-dom': { flushSync(fn) { calls.push('commit'); fn(); } },
      '../../view/worktree-view.js': viewHelpers,
      '../../session/worktree-session.js': sessionHelpers,
      '../shared.js': { EMPTY_READ_STATE: { status: 'idle', views: [] } },
    };
    const { useSurfaceRefresh } = await loadHook('state/useSurfaceRefresh', dependencies);
    const { useSessionActions } = await loadHook('actions/useSessionActions', dependencies);
    const read = useSurfaceRefresh({
      source: { forkRecoverySnapshot: { revision: 0 }, workspaceIdsRef: { current: ['ws', 'other'] },
        mode: 'worktree', workspaceIds: ['ws', 'other'], sessionPresentations: {} },
      props: { manager: {}, invalidateWorktreeContext: outcome === 'slow-context'
        ? () => new Promise(() => {}) : undefined, viewReader: {
        invalidate: (id) => calls.push(`invalidate:${id}`),
        read: async (id) => {
          const sequence = ++reads;
          calls.push(`read:${id}`);
          await barrier;
          if (outcome === 'failed' || (outcome === 'overlap-old-failed' && sequence === 1) ||
            (outcome === 'overlap-latest-failed' && sequence === 2)) throw new Error('read failed');
          const missing = outcome === 'missing-binding' || outcome === 'overlap-latest-missing' ||
            (outcome.startsWith('overlap-') && sequence === 1);
          return { workspaceId: 'ws', worktrees: [target], bindings: missing ? [] :
            [{ workspaceId: 'ws', worktreeId: 'wt', sessionId: 'new', status: 'active' }] };
        },
      } },
      registrationState: { modalReadViewRef: { current: undefined } },
    });
    const connector = createWorktreeSessionConnector({
      manager: { listWorktrees: async () => [target], listBindings: async () => [] },
      sessions: { getSnapshot: () => ({ phase: 'ready', ids: [], byId: {} }) }, archivedSessionIds: () => [],
      createSession: () => assert.fail('Host owns creation'),
      createBoundSession: async () => ({ sessionId: 'new', bound: true }), ensureSessionWorkspace() {},
      openSession: () => calls.push(state.views[0].bindings.some((binding) => binding.sessionId === 'new') ? 'open:wt' : 'open:Local'),
    });
    const errors = [];
    const actions = useSessionActions({ source: { archivedSessionIds: [] },
      props: { createSessionForWorktree: (input, beforeOpen) => connector.create(input, beforeOpen) },
      mutation: { setActionPending() {}, setActionError: (error) => { if (error) errors.push(error); } }, read });
    const pending = actions.createSession({ workspaceId: 'ws', worktreeId: 'wt', cwd: '/repo/wt' });
    await flush();
    assert.deepEqual(calls, ['invalidate:ws', 'read:ws']);
    assert.equal(state.views[1], other);
    if (outcome === 'superseded') read.guardFor('ws').invalidate();
    const notification = outcome.startsWith('overlap-') ? read.refresh({
      scope: { kind: 'workspace', workspaceId: 'ws' }, preserveCurrent: true,
      alreadyInvalidated: true, invalidateContext: false,
    }) : undefined;
    release();
    if (outcome === 'slow-context') {
      await flush();
      assert.ok(calls.includes('open:wt'), 'Ready destination must open without waiting for the previous Session context');
    }
    await pending;
    await notification;
    assert.equal(reads, notification ? 2 : 1, 'Opening follows the existing read without another RPC');
    assert.equal(state.views[1], other);
    assert.equal(calls.includes('open:Local'), false);
    if (outcome === 'ready' || outcome === 'slow-context' || outcome === 'overlap-ready' || outcome === 'overlap-old-failed') {
      assert.deepEqual(calls.slice(-2), ['commit', 'open:wt']);
      assert.deepEqual(errors, []);
    } else {
      assert.equal(calls.some((call) => call.startsWith('open:')), false);
      assert.equal(errors.length, 1);
      assert.equal(state.status, 'ready');
    }
    connector.dispose();
  });
}

test('disposing while the opening projection is pending suppresses native navigation', async () => {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const connector = createWorktreeSessionConnector({
    manager: { listWorktrees: async () => [{ workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/repo/wt', status: 'active' }],
      listBindings: async () => [] },
    sessions: { getSnapshot: () => ({ phase: 'ready', ids: [], byId: {} }) }, archivedSessionIds: () => [],
    createSession: () => assert.fail('Host owns creation'),
    createBoundSession: async () => ({ sessionId: 'new', bound: true }), ensureSessionWorkspace() {},
    openSession: () => assert.fail('Disposed Client must not navigate'),
  });
  const pending = connector.create({ workspaceId: 'ws', worktreeId: 'wt', cwd: '/repo/wt' }, () => barrier);
  await flush();
  connector.dispose();
  release();
  await assert.rejects(pending, { code: 'CLIENT_DISPOSED' });
});
