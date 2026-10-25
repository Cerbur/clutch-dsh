import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorktreeViewReader,
  createWorktreeModalViewLoader,
  mergeWorktreeViews,
} from '../lib/client/view/worktree-view-read.js';

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

test('Workspace reads inspect current HEAD without loading the branch catalog', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const manager = createManager(calls);
  manager.getWorkspaceGitState = async () => ({ currentBranch: 'terminal/checkout' });
  manager.getWorkspaceCheckout = async () => ({ currentHead: {
    kind: 'branch', name: 'terminal/checkout', commit: 'a'.repeat(40),
  } });
  const reader = createWorktreeViewReader(manager);
  const result = await reader.read('ws1');
  assert.equal(calls.listBranches.length, 0);
  assert.equal(result.currentBranch, 'terminal/checkout');
  assert.deepEqual(result.branches, []);
  assert.equal(result.readiness.status, 'ready');
  reader.dispose();
});

test('a notification and mutation completion share only the same change generation', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const reader = createWorktreeViewReader(createManager(calls));
  const before = reader.read('ws1');
  reader.invalidate('ws1', { changeId: 'sync-1' });
  const after = reader.read('ws1');
  assert.notEqual(after, before, 'retire reads started before the mutation');
  reader.invalidate('ws1', { changeId: 'sync-1' });
  assert.equal(reader.read('ws1'), after, 'share the post-change in-flight read');
  const view = await after;
  reader.invalidate('ws1', { changeId: 'sync-1' });
  assert.equal(await reader.read('ws1'), view, 'late completion reuses the fresh result');
  reader.invalidate('ws1', { changeId: 'sync-2' });
  assert.notEqual(await reader.read('ws1'), view, 'another mutation must read again');
  await before;
  reader.dispose();
});

test('recovery replay retires a pre-reset in-flight read without touching unrelated caches', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  let version = 1;
  const manager = createManager(calls, () => version);
  const reader = createWorktreeViewReader(manager);
  const unrelated = await reader.read('ws2');
  const oldRead = deferred();
  const listWorktrees = manager.listWorktrees;
  manager.listWorktrees = async (input) => {
    const records = await listWorktrees(input);
    if (records[0].branch === 'feature/1') await oldRead.promise;
    return records;
  };
  reader.invalidate('ws1', { changeId: 'sync-1' });
  const stale = reader.read('ws1');
  reader.resetChangeIds();
  assert.equal(await reader.read('ws2'), unrelated, 'reset preserves unaffected ready caches');
  version = 2;
  reader.invalidate('ws1', { changeId: 'sync-1' });
  const fresh = reader.read('ws1');
  assert.notEqual(fresh, stale);
  reader.invalidate('ws1', { changeId: 'sync-1' });
  assert.equal(reader.read('ws1'), fresh, 'completion shares the recovery generation');
  const recovered = await fresh;
  oldRead.resolve();
  await stale;
  assert.equal(recovered.worktrees[0].branch, 'feature/2');
  assert.equal(await reader.read('ws1'), recovered, 'late pre-reset results cannot repopulate the cache');
  assert.deepEqual(calls.listWorktrees, ['ws2', 'ws1', 'ws1']);
  reader.dispose();
});

test('interleaved change completions share the latest post-change read within one Workspace', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const reader = createWorktreeViewReader(createManager(calls));
  reader.invalidate('ws1', { changeId: 'sync-A' });
  const a = reader.read('ws1');
  reader.invalidate('ws1', { changeId: 'sync-B' });
  const b = reader.read('ws1');
  assert.notEqual(a, b, 'the new mutation must retire the previous read');
  reader.invalidate('ws1', { changeId: 'sync-A' });
  assert.equal(reader.read('ws1'), b, 'A completion shares the newer post-B in-flight read');
  const view = await b;
  reader.invalidate('ws1', { changeId: 'sync-B' });
  reader.invalidate('ws1', { changeId: 'sync-A' });
  assert.equal(await reader.read('ws1'), view, 'both late completions share the completed view');
  assert.equal(calls.listWorktrees.length, 2);
  await a;
  reader.dispose();
});

test('remembered change identities are bounded, Workspace-local and reset on unkeyed invalidation', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const reader = createWorktreeViewReader(createManager(calls));
  for (let index = 0; index <= 128; index++) reader.invalidate('ws1', { changeId: `sync-${index}` });
  const current = await reader.read('ws1');
  reader.invalidate('ws1', { changeId: 'sync-1' });
  assert.equal(await reader.read('ws1'), current, 'recent identities remain deduplicated');
  reader.invalidate('ws1', { changeId: 'sync-0' });
  const evicted = await reader.read('ws1');
  assert.notEqual(evicted, current, 'the oldest identity is evicted at the bound');
  reader.invalidate('ws2', { changeId: 'sync-0' });
  await reader.read('ws2');
  assert.ok(calls.listWorktrees.includes('ws2'));
  reader.invalidate('ws1');
  const recovery = reader.read('ws1');
  reader.invalidate('ws1', { changeId: 'sync-0' });
  const notification = reader.read('ws1');
  assert.notEqual(notification, recovery, 'a late notification must retire an unkeyed recovery read');
  await Promise.all([recovery, notification]);
  reader.dispose();
});

test('a failed change read can recover and an unkeyed mutation still retires its generation', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const manager = createManager(calls);
  let fail = true;
  manager.listWorktrees = async () => {
    if (fail) throw new Error('read unavailable');
    return [];
  };
  const reader = createWorktreeViewReader(manager);
  reader.invalidate('ws1', { changeId: 'sync-1' });
  await assert.rejects(reader.read('ws1'), /read unavailable/);
  fail = false;
  reader.invalidate('ws1', { changeId: 'sync-1' });
  const recovered = await reader.read('ws1');
  reader.invalidate('ws1');
  const otherMutation = await reader.read('ws1');
  assert.notEqual(otherMutation, recovered);
  reader.invalidate('ws1', { changeId: 'sync-1' });
  assert.notEqual(await reader.read('ws1'), otherMutation);
  reader.dispose();
});

test('opening creation reads lightweight Workspace state without preloading branch candidates', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const manager = createManager(calls);
  manager.getWorkspaceGitState = async () => ({ currentBranch: 'main' });
  const reader = createWorktreeViewReader(manager);
  await reader.read('ws1');
  const modal = createWorktreeModalViewLoader(reader);
  let result;
  await modal.load('ws1', (view) => { result = view; }, (error) => { throw error; });
  assert.deepEqual(calls.listBranches, []);
  assert.deepEqual(result.branches, []);
  assert.equal(result.currentBranch, 'main');
  assert.equal((await reader.read('ws1')).branches.length, 0);
  modal.invalidate(); reader.dispose();
});

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

test('read-only refreshes share in-flight reads while mutation invalidation starts fresh', async () => {
  const calls = { listWorktrees: [], listBranches: [], listBindings: [] };
  const gate = deferred();
  const manager = createManager(calls);
  const listWorktrees = manager.listWorktrees;
  manager.listWorktrees = async (input) => {
    const result = await listWorktrees(input);
    await gate.promise;
    return result;
  };
  const reader = createWorktreeViewReader(manager);
  reader.invalidate('ws1', { reuseInFlight: true });
  const first = reader.read('ws1');
  reader.invalidate('ws1', { reuseInFlight: true });
  const second = reader.read('ws1');
  assert.equal(first, second);
  assert.equal(calls.listWorktrees.length, 1);
  reader.invalidate('ws1');
  const afterMutation = reader.read('ws1');
  assert.notEqual(afterMutation, first);
  assert.equal(calls.listWorktrees.length, 2);
  gate.resolve();
  await Promise.all([first, second, afterMutation]);
  reader.invalidate('ws1', { reuseInFlight: true });
  await reader.read('ws1');
  assert.equal(calls.listWorktrees.length, 3, 'settled menu reads must be refreshed');
});

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
