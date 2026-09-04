import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorktreeViewReader,
  mergeWorktreeViews,
} from '../lib/client/worktree-view-read.js';

function activeWorktree(branch, workspaceId, worktreeId) {
  return {
    workspaceId,
    worktreeId,
    absolutePath: `/tmp/${worktreeId}`,
    branch,
    status: 'active',
  };
}

function currentBranch(name) {
  return { name, isCurrent: true, checkedOut: true };
}

function activeBinding(sessionId, worktreeId, workspaceId) {
  return { workspaceId, worktreeId, sessionId, status: 'active' };
}

function createManager(calls, version = () => 1) {
  return {
    async listWorktrees({ workspaceId }) {
      calls.listWorktrees.push(workspaceId);
      return [activeWorktree(`feature/${version()}`, workspaceId, `wt-${workspaceId}`)];
    },
    async listBranches({ workspaceId }) {
      calls.listBranches.push(workspaceId);
      return [currentBranch(`branch-${workspaceId}-${version()}`)];
    },
    async listBindings({ workspaceId }) {
      calls.listBindings.push(workspaceId);
      return [activeBinding(`session-${workspaceId}`, `wt-${workspaceId}`, workspaceId)];
    },
  };
}

function view(workspaceId, branches = []) {
  return {
    workspaceId,
    worktrees: [],
    branches,
    bindings: [],
    readiness: { status: 'ready' },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('shares one complete read for concurrent consumers of one Workspace', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const reader = createWorktreeViewReader(createManager(calls));

  const [first, second] = await Promise.all([reader.read('ws1'), reader.read('ws1')]);

  assert.equal(first.workspaceId, 'ws1');
  assert.equal(second, first);
  assert.deepEqual(calls, {
    listWorktrees: ['ws1'],
    listBranches: ['ws1'],
    listBindings: ['ws1'],
  });
  reader.dispose();
});

test('readMany de-duplicates Workspace IDs and preserves first-seen order', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const reader = createWorktreeViewReader(createManager(calls));

  const views = await reader.readMany(['ws2', 'ws1', 'ws2']);

  assert.deepEqual(views.map((item) => item.workspaceId), ['ws2', 'ws1']);
  assert.deepEqual(calls.listBindings, ['ws2', 'ws1']);
  reader.dispose();
});

test('invalidate creates one fresh generation and repeated invalidation still shares one fresh read', async () => {
  let currentVersion = 1;
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const reader = createWorktreeViewReader(createManager(calls, () => currentVersion));

  const first = await reader.read('ws1');
  currentVersion = 2;
  reader.invalidate('ws1');
  reader.invalidate('ws1');
  const second = await reader.read('ws1');
  const cached = await reader.read('ws1');

  assert.notEqual(second, first);
  assert.equal(cached, second);
  assert.deepEqual(calls.listBindings, ['ws1', 'ws1']);
  assert.equal(second.branches[0].name, 'branch-ws1-2');
  reader.dispose();
});

test('a second invalidation retires an in-flight stale-generation result', async () => {
  const firstRead = deferred();
  const staleRead = deferred();
  const freshRead = deferred();
  const reads = [firstRead, staleRead, freshRead];
  const calls = { listWorktrees: 0, listBranches: 0, listBindings: 0 };
  let activeRead;
  const manager = {
    listWorktrees() {
      calls.listWorktrees += 1;
      activeRead = reads.shift();
      return activeRead.promise.then((data) => data.worktrees);
    },
    listBranches() {
      calls.listBranches += 1;
      return activeRead.promise.then((data) => data.branches);
    },
    listBindings() {
      calls.listBindings += 1;
      return activeRead.promise.then((data) => data.bindings);
    },
  };
  const reader = createWorktreeViewReader(manager);
  const dataFor = (branch) => ({
    worktrees: [],
    branches: [currentBranch(branch)],
    bindings: [],
  });

  const initial = reader.read('ws1');
  firstRead.resolve(dataFor('one'));
  await initial;

  reader.invalidate('ws1');
  const stale = reader.read('ws1');
  reader.invalidate('ws1');
  staleRead.resolve(dataFor('two'));
  const staleView = await stale;

  const fresh = reader.read('ws1');
  assert.deepEqual(calls, { listWorktrees: 3, listBranches: 3, listBindings: 3 });
  freshRead.resolve(dataFor('three'));
  const freshView = await fresh;

  assert.notEqual(freshView, staleView);
  assert.equal(freshView.branches[0].name, 'three');
  reader.dispose();
});

test('a stale previous-generation result cannot overwrite the current cache', async () => {
  const firstRead = deferred();
  const secondRead = deferred();
  const reads = [firstRead, secondRead];
  const calls = { listWorktrees: 0, listBranches: 0, listBindings: 0 };
  let activeRead;
  const manager = {
    listWorktrees() {
      calls.listWorktrees += 1;
      activeRead = reads.shift();
      return activeRead.promise.then((data) => data.worktrees);
    },
    listBranches() {
      calls.listBranches += 1;
      return activeRead.promise.then((data) => data.branches);
    },
    listBindings() {
      calls.listBindings += 1;
      return activeRead.promise.then((data) => data.bindings);
    },
  };
  const reader = createWorktreeViewReader(manager);

  const first = reader.read('ws1');
  reader.invalidate('ws1');
  const second = reader.read('ws1');
  secondRead.resolve({
    worktrees: [activeWorktree('feature/two', 'ws1', 'wt1')],
    branches: [currentBranch('two')],
    bindings: [],
  });
  const secondView = await second;
  firstRead.resolve({
    worktrees: [activeWorktree('feature/one', 'ws1', 'wt1')],
    branches: [currentBranch('one')],
    bindings: [],
  });
  await first;

  const cached = await reader.read('ws1');
  assert.equal(cached, secondView);
  assert.equal(cached.branches[0].name, 'two');
  assert.deepEqual(calls, { listWorktrees: 2, listBranches: 2, listBindings: 2 });
  reader.dispose();
});

test('dispose prevents late reads from repopulating the reader cache', async () => {
  const pending = deferred();
  const calls = { listWorktrees: 0, listBranches: 0, listBindings: 0 };
  const manager = {
    listWorktrees() {
      calls.listWorktrees += 1;
      return pending.promise.then((data) => data.worktrees);
    },
    listBranches() {
      calls.listBranches += 1;
      return pending.promise.then((data) => data.branches);
    },
    listBindings() {
      calls.listBindings += 1;
      return pending.promise.then((data) => data.bindings);
    },
  };
  const reader = createWorktreeViewReader(manager);
  const read = reader.read('ws1');
  reader.dispose();
  pending.resolve({
    worktrees: [],
    branches: [],
    bindings: [],
  });
  await read;

  await assert.rejects(() => reader.read('ws1'), /reader disposed/);
  assert.deepEqual(calls, { listWorktrees: 1, listBranches: 1, listBindings: 1 });
});

test('mergeWorktreeViews updates, reorders, and removes only the requested collection', () => {
  const oldWs1 = view('ws1');
  const oldWs2 = view('ws2');
  const newWs2 = view('ws2', [currentBranch('feature/two')]);

  const preserved = mergeWorktreeViews([oldWs1, oldWs2], ['ws1', 'ws2'], [newWs2]);
  assert.equal(preserved[0], oldWs1);
  assert.equal(preserved[1], newWs2);

  assert.deepEqual(
    mergeWorktreeViews([oldWs1, oldWs2], ['ws2', 'ws1', 'ws3'], [oldWs1, newWs2]),
    [newWs2, oldWs1],
  );
});
