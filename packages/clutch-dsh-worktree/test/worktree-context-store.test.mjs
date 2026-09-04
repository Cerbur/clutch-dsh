import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorktreeContextProjection } from '../lib/client/worktree-context-store.js';
import { createWorktreeViewReader } from '../lib/client/worktree-view-read.js';

function snapshot(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

function createSnapshotStore(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(mutator) {
      const next = globalThis.structuredClone(value);
      mutator(next);
      value = next;
      for (const listener of listeners) listener();
    },
    set(next) {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

function createProjection(input) {
  const reader = input.viewReader ?? createWorktreeViewReader(input.manager);
  const projectionInput = { ...input };
  delete projectionInput.manager;
  const projection = createWorktreeContextProjection({
    ...projectionInput,
    viewReader: reader,
    storeFactory: createSnapshotStore,
  });
  const dispose = projection.dispose;
  projection.dispose = () => {
    dispose();
    reader.dispose();
  };
  projection.viewReader = reader;
  return projection;
}

function activeWorktree(branch, workspaceId = 'ws1', worktreeId = 'wt1') {
  return {
    worktreeId,
    workspaceId,
    absolutePath: `/tmp/${worktreeId}`,
    branch,
    status: 'active',
  };
}

function currentBranch(name) {
  return { name, isCurrent: true, checkedOut: true };
}

function activeBinding(sessionId, worktreeId = 'wt1', workspaceId = 'ws1') {
  return { workspaceId, worktreeId, sessionId, status: 'active' };
}

function dataFor(sessionId, branchName) {
  return {
    worktrees: [activeWorktree(branchName)],
    branches: [currentBranch('main')],
    bindings: [activeBinding(sessionId)],
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function managerWith({ worktrees, branches, bindings }) {
  const calls = { listWorktrees: 0, listBranches: 0, listBindings: 0 };
  return {
    calls,
    async listWorktrees() {
      calls.listWorktrees += 1;
      return worktrees;
    },
    async listBranches() {
      calls.listBranches += 1;
      return branches;
    },
    async listBindings() {
      calls.listBindings += 1;
      return bindings;
    },
  };
}

function managerWithViewReads(reads) {
  const calls = { listWorktrees: 0, listBranches: 0, listBindings: 0 };
  let readIndex = 0;
  let currentRead;
  return {
    calls,
    listWorktrees() {
      calls.listWorktrees += 1;
      currentRead = reads[readIndex];
      readIndex += 1;
      return currentRead.promise.then((data) => data.worktrees);
    },
    listBranches() {
      calls.listBranches += 1;
      return currentRead.promise.then((data) => data.branches);
    },
    listBindings() {
      calls.listBindings += 1;
      return currentRead.promise.then((data) => data.bindings);
    },
  };
}

function projectionWithSequencedReads({ sessions, reads, workspaces }) {
  return createProjection({
    sessions,
    workspaces: workspaces ?? snapshot({
      items: [{ workspaceId: 'ws1', sessionIds: ['s1', 's2'] }],
    }),
    manager: managerWithViewReads(reads),
  });
}

function projectionWithPendingRead({ sessions, pending }) {
  return projectionWithSequencedReads({ sessions, reads: [pending] });
}

test('refreshes the current Session context from one Workspace read', async () => {
  const manager = managerWith({
    worktrees: [activeWorktree('feature/context')],
    branches: [currentBranch('main')],
    bindings: [activeBinding('s1')],
  });
  const projection = createProjection({
    sessions: snapshot({ current: 's1', byId: { s1: {} } }),
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager,
  });

  await projection.refresh();

  assert.deepEqual(projection.store.getSnapshot().value, {
    kind: 'worktree', workspaceId: 'ws1', worktreeId: 'wt1',
    label: 'feature/context', source: 'active-binding',
  });
  assert.equal(manager.calls.listWorktrees, 1);
  assert.equal(manager.calls.listBranches, 1);
  assert.equal(manager.calls.listBindings, 1);
  projection.dispose();
});

test('projects the recent Workspace local branch for a Hero without a Session', async () => {
  const projection = createProjection({
    sessions: snapshot({ current: undefined, byId: {} }),
    workspaces: snapshot({
      items: [{
        workspaceId: 'ws1',
        title: 'CTool',
        sessionIds: [],
        createdAt: '2026-01-02T00:00:00.000Z',
      }],
    }),
    manager: managerWith({
      worktrees: [],
      branches: [currentBranch('main')],
      bindings: [],
    }),
  });

  await projection.refresh();

  assert.deepEqual(projection.store.getSnapshot(), {
    status: 'ready',
    workspaceId: 'ws1',
    workspaceTitle: 'CTool',
    value: {
      kind: 'main',
      workspaceId: 'ws1',
      label: 'main',
      source: 'current-branch',
    },
  });
  projection.dispose();
});

test('uses the provided DSH-compatible SnapshotStore factory', () => {
  let calls = 0;
  let providedStore;
  const manager = managerWith({ worktrees: [], branches: [], bindings: [] });
  const viewReader = createWorktreeViewReader(manager);
  const projection = createWorktreeContextProjection({
    sessions: snapshot({ current: undefined, byId: {} }),
    workspaces: snapshot({ items: [] }),
    viewReader,
    storeFactory(initial) {
      calls += 1;
      providedStore = createSnapshotStore(initial);
      return providedStore;
    },
  });

  assert.equal(calls, 1);
  assert.equal(projection.store, providedStore);
  projection.dispose();
  viewReader.dispose();
});

test('late data for the previous Session cannot overwrite the current Session', async () => {
  const first = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {}, s2: {} } });
  const projection = projectionWithSequencedReads({ sessions, reads: [first] });

  const firstRefresh = projection.refresh();
  sessions.set({ current: 's2', byId: { s1: {}, s2: {} } });
  assert.deepEqual(projection.store.getSnapshot().value, { kind: 'none', reason: 'not-ready' });
  const secondRefresh = projection.refresh();
  first.resolve(dataFor('s2', 'feature/two'));
  await secondRefresh;
  await firstRefresh;

  assert.equal(projection.store.getSnapshot().sessionId, 's2');
  assert.equal(projection.store.getSnapshot().value.label, 'feature/two');
  projection.dispose();
});

test('late data for the previous Workspace cannot overwrite the current Workspace', async () => {
  const first = deferred();
  const second = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const workspaces = snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] });
  const projection = projectionWithSequencedReads({
    sessions,
    workspaces,
    reads: [first, second],
  });

  const firstRefresh = projection.refresh();
  workspaces.set({ items: [{ workspaceId: 'ws2', sessionIds: ['s1'] }] });
  const secondRefresh = projection.refresh();
  second.resolve({
    worktrees: [activeWorktree('feature/two', 'ws2')],
    branches: [currentBranch('main')],
    bindings: [activeBinding('s1', 'wt1', 'ws2')],
  });
  await secondRefresh;
  first.resolve(dataFor('s1', 'feature/one'));
  await firstRefresh;

  assert.deepEqual(projection.store.getSnapshot().value, {
    kind: 'worktree', workspaceId: 'ws2', worktreeId: 'wt1',
    label: 'feature/two', source: 'active-binding',
  });
  projection.dispose();
});

test('deduplicates same-tick Session and Workspace refresh schedules', async () => {
  const pending = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {}, s2: {} } });
  const workspaces = snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] });
  const manager = managerWithViewReads([pending]);
  const projection = createProjection({ sessions, workspaces, manager });

  sessions.set({ current: 's2', byId: { s1: {}, s2: {} } });
  workspaces.set({ items: [{ workspaceId: 'ws1', sessionIds: ['s2'] }] });
  await new Promise(globalThis.queueMicrotask);

  assert.deepEqual(manager.calls, { listWorktrees: 1, listBranches: 1, listBindings: 1 });
  pending.resolve(dataFor('s2', 'feature/two'));
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.equal(projection.store.getSnapshot().value.label, 'feature/two');
  projection.dispose();
});

test('keeps the current context when a same-identity Session snapshot updates', async () => {
  const manager = managerWith({
    worktrees: [],
    branches: [currentBranch('main')],
    bindings: [],
  });
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const projection = createProjection({
    sessions,
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager,
  });

  await projection.refresh();
  sessions.set({ current: 's1', byId: { s1: { displayTitle: 'updated' } } });

  assert.equal(projection.store.getSnapshot().value.label, 'main');
  assert.equal(projection.store.getSnapshot().status, 'ready');
  assert.deepEqual(manager.calls, {
    listWorktrees: 1,
    listBranches: 1,
    listBindings: 1,
  });
  projection.dispose();
});

test('resolves a changed Session immediately from cached Workspace facts', async () => {
  const first = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {}, s2: {} } });
  const workspaces = snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1', 's2'] }] });
  const manager = managerWithViewReads([first]);
  const projection = createProjection({ sessions, workspaces, manager });

  const initial = projection.refresh();
  first.resolve({
    worktrees: [
      activeWorktree('feature/one', 'ws1', 'wt1'),
      activeWorktree('feature/two', 'ws1', 'wt2'),
    ],
    branches: [currentBranch('main')],
    bindings: [activeBinding('s1', 'wt1'), activeBinding('s2', 'wt2', 'ws1')],
  });
  await initial;

  sessions.set({ current: 's2', byId: { s1: {}, s2: {} } });
  assert.equal(projection.store.getSnapshot().value.label, 'feature/one');
  assert.equal(projection.store.getSnapshot().sessionId, 's2');

  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.equal(projection.store.getSnapshot().value.label, 'feature/two');
  assert.deepEqual(manager.calls, {
    listWorktrees: 1,
    listBranches: 1,
    listBindings: 1,
  });
  projection.dispose();
});

test('coalesces repeated synchronous Workspace notifications without republishing pending state', async () => {
  const pending = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const workspaces = snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] });
  const projection = createProjection({
    sessions,
    workspaces,
    manager: managerWithViewReads([pending]),
  });
  const states = [];
  const unsubscribe = projection.store.subscribe(() => {
    states.push(projection.store.getSnapshot());
  });

  workspaces.set({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] });
  workspaces.set({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] });

  assert.equal(states.filter((state) => state.status === 'loading').length, 1);

  await new Promise(globalThis.queueMicrotask);
  pending.resolve(dataFor('s1', 'feature/one'));
  await new Promise(globalThis.queueMicrotask);
  await new Promise(globalThis.queueMicrotask);
  unsubscribe();
  projection.dispose();
});

test('dispose aborts/ignores in-flight reads and clears visible context', async () => {
  const pending = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const projection = projectionWithPendingRead({ sessions, pending });
  const refresh = projection.refresh();
  projection.dispose();
  pending.resolve(dataFor('s1', 'feature/one'));
  await refresh;

  assert.equal(projection.store.getSnapshot().value.kind, 'none');
  assert.equal(projection.store.getSnapshot().status, 'idle');
});

test('invalidates the matching Workspace and waits for the refreshed data', async () => {
  const first = deferred();
  const second = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const manager = managerWithViewReads([first, second]);
  const projection = createProjection({
    sessions,
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager,
  });

  const initial = projection.refresh();
  first.resolve(dataFor('s1', 'feature/one'));
  await initial;
  const invalidated = projection.invalidate('ws1');
  assert.deepEqual(projection.store.getSnapshot().value, {
    kind: 'worktree',
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    label: 'feature/one',
    source: 'active-binding',
  });
  second.resolve(dataFor('s1', 'feature/two'));
  await invalidated;

  assert.equal(projection.store.getSnapshot().value.label, 'feature/two');
  projection.dispose();
});

test('shares a targeted read between the surface and Context invalidation', async () => {
  const first = deferred();
  const second = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const manager = managerWithViewReads([first, second]);
  const projection = createProjection({
    sessions,
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager,
  });

  const initial = projection.refresh();
  first.resolve(dataFor('s1', 'feature/one'));
  await initial;

  const contextRefresh = projection.invalidate('ws1');
  const surfaceRead = projection.viewReader.read('ws1');

  assert.deepEqual(manager.calls, {
    listWorktrees: 2,
    listBranches: 2,
    listBindings: 2,
  });
  assert.equal(projection.store.getSnapshot().value.label, 'feature/one');
  second.resolve(dataFor('s1', 'feature/two'));
  const [view] = await Promise.all([surfaceRead, contextRefresh]);

  assert.equal(view.workspaceId, 'ws1');
  assert.equal(projection.store.getSnapshot().value.label, 'feature/two');
  projection.dispose();
});

test('invalidation waits for a newer matching Session refresh', async () => {
  const first = deferred();
  const invalidatedRead = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {}, s2: {} } });
  const projection = projectionWithSequencedReads({
    sessions,
    reads: [first, invalidatedRead],
  });

  const initial = projection.refresh();
  first.resolve(dataFor('s1', 'feature/one'));
  await initial;
  let settled = false;
  const invalidation = projection.invalidate('ws1').then(() => {
    settled = true;
  });
  sessions.set({ current: 's2', byId: { s1: {}, s2: {} } });
  await new Promise(globalThis.queueMicrotask);
  await new Promise(globalThis.queueMicrotask);
  await new Promise(globalThis.queueMicrotask);

  assert.equal(settled, false);
  invalidatedRead.resolve(dataFor('s2', 'feature/three'));
  await invalidation;
  assert.equal(projection.store.getSnapshot().value.label, 'feature/three');
  projection.dispose();
});

test('does not refresh when invalidating a different Workspace', async () => {
  const manager = managerWith({
    worktrees: [],
    branches: [currentBranch('main')],
    bindings: [],
  });
  const projection = createProjection({
    sessions: snapshot({ current: 's1', byId: { s1: {} } }),
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager,
  });

  await projection.refresh();
  await projection.invalidate('ws2');

  assert.equal(manager.calls.listWorktrees, 1);
  assert.equal(projection.store.getSnapshot().value.label, 'main');
  projection.dispose();
});

test('does not read the Manager when there is no current Session', async () => {
  const manager = managerWith({
    worktrees: [],
    branches: [currentBranch('main')],
    bindings: [],
  });
  const projection = createProjection({
    sessions: snapshot({ current: undefined, byId: {} }),
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: [] }] }),
    manager,
  });

  await projection.refresh();

  assert.deepEqual(projection.store.getSnapshot(), {
    status: 'ready',
    value: { kind: 'none', reason: 'no-session' },
  });
  assert.deepEqual(manager.calls, { listWorktrees: 0, listBranches: 0, listBindings: 0 });
  projection.dispose();
});

test('refreshes the current branch while retaining the previous label', async () => {
  const first = deferred();
  const second = deferred();
  const sessions = snapshot({ current: 's1', byId: { s1: {} } });
  const projection = projectionWithSequencedReads({ sessions, reads: [first, second] });

  const initial = projection.refresh();
  first.resolve({ worktrees: [], branches: [currentBranch('main')], bindings: [] });
  await initial;
  projection.viewReader.invalidate('ws1');
  const refreshed = projection.refresh();
  assert.deepEqual(projection.store.getSnapshot().value, {
    kind: 'main',
    workspaceId: 'ws1',
    label: 'main',
    source: 'current-branch',
  });
  assert.equal(projection.store.getSnapshot().status, 'ready');
  second.resolve({ worktrees: [], branches: [currentBranch('release')], bindings: [] });
  await refreshed;

  assert.deepEqual(projection.store.getSnapshot().value, {
    kind: 'main', workspaceId: 'ws1', label: 'release', source: 'current-branch',
  });
  projection.dispose();
});

test('turns binding and Manager failures into retryable context errors', async () => {
  const bindingFailure = new Error('bindings unavailable');
  const managerFailure = { code: 'CONNECTION_CALL_FAILED', message: 'connection lost', retryable: true };
  const failures = [bindingFailure, managerFailure];
  const manager = {
    async listWorktrees() {
      const failure = failures[0];
      if (failure === managerFailure) throw failure;
      return [];
    },
    async listBranches() {
      return [currentBranch('main')];
    },
    async listBindings() {
      const failure = failures.shift();
      throw failure;
    },
  };
  const projection = createProjection({
    sessions: snapshot({ current: 's1', byId: { s1: {} } }),
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager,
  });

  await projection.refresh();
  assert.equal(projection.store.getSnapshot().value.kind, 'none');
  assert.equal(projection.store.getSnapshot().error.retryable, true);
  await projection.refresh();
  assert.equal(projection.store.getSnapshot().value.kind, 'none');
  assert.equal(projection.store.getSnapshot().error.code, 'CONNECTION_CALL_FAILED');
  projection.dispose();
});

test('preserves a normalized readiness error as retryable context state', async () => {
  const projection = createProjection({
    sessions: snapshot({ current: 's1', byId: { s1: {} } }),
    workspaces: snapshot({ items: [{ workspaceId: 'ws1', sessionIds: ['s1'] }] }),
    manager: {
      async listWorktrees() {
        return [];
      },
      async listBranches() {
        throw {
          code: 'WORKSPACE_NOT_GIT_REPOSITORY',
          message: 'Workspace is not a Git repository.',
          retryable: true,
          details: {},
        };
      },
      async listBindings() {
        return [];
      },
    },
  });

  await projection.refresh();

  assert.equal(projection.store.getSnapshot().status, 'error');
  assert.equal(projection.store.getSnapshot().value.kind, 'none');
  assert.equal(projection.store.getSnapshot().error.retryable, true);
  assert.equal(projection.store.getSnapshot().error.code, 'WORKSPACE_NOT_GIT_REPOSITORY');
  projection.dispose();
});
