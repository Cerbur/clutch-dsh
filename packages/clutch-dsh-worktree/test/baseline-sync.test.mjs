import assert from 'node:assert/strict';
import test from 'node:test';
const { AbortController, AbortSignal } = globalThis;
import { createBaselineSync } from '../lib/host/baseline-sync.js';
import { createWorktreeManager } from '../lib/manage/index.js';

const record = { workspaceId: 'ws', worktreeId: 'wt', branch: 'feature', currentBranch: 'feature',
  baseBranch: 'main', absolutePath: '/test/worktree', source: 'plugin', status: 'active', health: 'ready' };
const input = { workspaceId: 'ws', worktreeId: 'wt', baseBranch: 'main', strategy: 'merge', requestId: 'request-1' };
function fixture(overrides = {}) {
  const calls = [];
  const coordinator = createWorktreeManager({ dshHome: '/test/dsh', dsh: {}, git: {}, sidecar: {} });
  const manager = {
    withWorktreeBaseline: coordinator.withWorktreeBaseline.bind(coordinator),
    listWorktrees: async () => [record],
    listBranches: async () => [{ name: 'main', ref: 'refs/heads/main' }],
    bindSession: async (value) => { calls.push(['bind', value]); return value; },
    ...overrides.manager,
  };
  const sessions = {
    modelCatalog: async () => ({ default: { provider: 'test', model: 'default' } }),
    validateModel: async (value) => value,
    create: async (value) => { calls.push(['create', value]); return { sessionId: 'created' }; },
    configureModel: async (...args) => { calls.push(['model', ...args]); },
    rename: async (value) => { calls.push(['rename', value]); },
    prompt: async (value) => { calls.push(['prompt', value]); return { accepted: true }; },
    ...overrides.sessions,
  };
  return { calls, manager, sync: createBaselineSync({ manager, sessions, changed: (...args) => calls.push(['changed', ...args]) }) };
}

for (const strategy of ['merge', 'rebase']) test(`${strategy} creates a bound native task with exact baseline and normal policy`, async () => {
  const { calls, sync } = fixture();
  const result = await sync.sync({ ...input, strategy }, new AbortController().signal);
  assert.equal(result.status, 'dispatched');
  assert.deepEqual(calls.map(([kind]) => kind), ['create', 'bind', 'model', 'rename', 'prompt', 'changed']);
  assert.deepEqual(calls.at(-1), ['changed', input.workspaceId, input.worktreeId, input.requestId]);
  assert.deepEqual(calls[0][1], { cwd: record.absolutePath });
  assert.deepEqual(calls[1][1], { workspaceId: 'ws', worktreeId: 'wt', sessionId: 'created' });
  const prompt = calls.find(([kind]) => kind === 'prompt')[1];
  assert.equal(prompt.mode, 'queue');
  assert.match(prompt.content[0].text, /refs\/heads\/main/);
  assert.match(prompt.content[0].text, new RegExp(strategy.toUpperCase()));
  assert.match(prompt.content[0].text, /do not stash, reset or discard/);
  assert.match(prompt.content[0].text, /Do not grant yourself additional permissions/);
  sync.dispose();
});

test('same admission is coalesced and replayed, changed payload cannot create another Session', async () => {
  const { calls, sync } = fixture();
  const signal = new AbortController().signal;
  const first = sync.sync(input, signal);
  assert.equal(sync.sync(input, signal), first);
  await first;
  assert.equal(sync.sync(input, signal), first);
  await assert.rejects(sync.sync({ ...input, strategy: 'rebase' }, signal), (error) => error.code === 'WORKTREE_STATE_CONFLICT');
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  sync.dispose();
});

for (const change of [
  { status: 'removed' }, { health: 'repair' }, { health: 'branch-drift' }, { currentBranch: null },
  { baseBranch: 'changed' }, { workspaceId: 'other' },
  { currentBranch: 'other-branch' }, { currentHead: { kind: 'tag', name: 'v1' } },
]) test(`rejects stale or unavailable target before creation: ${JSON.stringify(change)}`, async () => {
  const { calls, sync } = fixture({ manager: { listWorktrees: async () => [{ ...record, ...change }] } });
  await assert.rejects(sync.sync(input, new AbortController().signal));
  assert.equal(calls.length, 0);
  sync.dispose();
});

test('rechecks after model resolution and rejects missing or ambiguous branch identity', async () => {
  for (const branches of [[], [{ name: 'main', ref: 'refs/heads/main' }, { name: 'main', kind: 'remote', ref: 'refs/remotes/main' }]]) {
    const { calls, sync } = fixture({ manager: { listBranches: async () => branches } });
    await assert.rejects(sync.sync(input, new AbortController().signal));
    assert.equal(calls.length, 0);
    sync.dispose();
  }
  let reads = 0;
  const { calls, sync } = fixture({ manager: { listWorktrees: async () => [{ ...record, baseBranch: ++reads === 1 ? 'main' : 'changed' }] } });
  await assert.rejects(sync.sync(input, new AbortController().signal));
  assert.equal(calls.length, 0);
  sync.dispose();
});

for (const change of [{ baseBranch: 'release' }, { status: 'removed' }, { health: 'branch-drift' },
  { currentBranch: 'other' }, { currentHead: { kind: 'tag', name: 'v1' } }]) test(`rejects a target changed while the final branch enumeration is pending: ${JSON.stringify(change)}`, async () => {
  let current = { ...record };
  let reads = 0;
  let resume;
  let paused;
  const gate = new Promise((resolve) => { resume = resolve; });
  const enumerating = new Promise((resolve) => { paused = resolve; });
  const { calls, manager, sync } = fixture({ manager: {
    listWorktrees: async () => [{ ...current }],
    listBranches: async () => {
      if (++reads === 2) {
        paused();
        await gate;
      }
      return [{ name: 'main', ref: 'refs/heads/main' }, { name: 'release', ref: 'refs/heads/release' }];
    },
  } });
  try {
    const pending = sync.sync(input, new AbortController().signal);
    await enumerating;
    await manager.withWorktreeBaseline(input, async () => { current = { ...current, ...change }; });
    resume();
    await assert.rejects(pending, (error) => error.code === 'WORKTREE_STATE_CONFLICT');
    assert.equal(calls.length, 0, 'stale baseline must not create, bind or prompt a Session');
  } finally {
    resume();
    sync.dispose();
  }
});

test('baseline saves wait through native admission and do not block other Worktrees', async () => {
  let resume;
  let paused;
  const gate = new Promise((resolve) => { resume = resolve; });
  const creating = new Promise((resolve) => { paused = resolve; });
  const { calls, manager, sync } = fixture({ sessions: { create: async (value) => {
    calls.push(['create', value]);
    paused();
    await gate;
    return { sessionId: 'created' };
  } } });
  try {
    const pending = sync.sync(input, new AbortController().signal);
    await creating;
    const save = manager.withWorktreeBaseline(input, async () => { calls.push(['save']); });
    await manager.withWorktreeBaseline({ ...input, worktreeId: 'another' }, async () => {});
    assert.equal(calls.some(([kind]) => kind === 'save'), false);
    resume();
    assert.equal((await pending).status, 'dispatched');
    await save;
    assert.deepEqual(calls.map(([kind]) => kind), ['create', 'bind', 'model', 'rename', 'prompt', 'changed', 'save']);
  } finally {
    resume();
    sync.dispose();
  }
});

test('a queued baseline save wins before final validation; rejected admission can retry', async () => {
  let resume;
  let paused;
  let current = { ...record };
  const gate = new Promise((resolve) => { resume = resolve; });
  const saving = new Promise((resolve) => { paused = resolve; });
  const { calls, manager, sync } = fixture({ manager: {
    listWorktrees: async () => [{ ...current }],
    listBranches: async () => [{ name: 'main', ref: 'refs/heads/main' }, { name: 'release', ref: 'refs/heads/release' }],
  } });
  try {
    const save = manager.withWorktreeBaseline(input, async () => {
      paused();
      await gate;
      current = { ...current, baseBranch: 'release' };
    });
    await saving;
    const pending = sync.sync(input, new AbortController().signal);
    resume();
    await save;
    await assert.rejects(pending, { code: 'WORKTREE_STATE_CONFLICT' });
    assert.equal(calls.length, 0);
    const retry = await sync.sync({ ...input, baseBranch: 'release' }, new AbortController().signal);
    assert.equal(retry.status, 'dispatched');
    assert.match(calls.find(([kind]) => kind === 'prompt')[1].content[0].text, /refs\/heads\/release/);
  } finally {
    resume();
    sync.dispose();
  }
});

for (const [method, status] of [['bindSession', 'binding-failed'], ['configureModel', 'model-failed'], ['rename', 'title-failed'], ['prompt', 'prompt-failed']]) {
  test(`preserves partial Session identity and never redispatches ${status}`, async () => {
    const failure = async () => { throw new Error('native failure'); };
    const { calls, sync } = fixture(method === 'bindSession' ? { manager: { [method]: failure } } : { sessions: { [method]: failure } });
    const signal = new AbortController().signal;
    const result = await sync.sync(input, signal);
    assert.equal(result.status, status);
    assert.equal(result.sessionId, 'created');
    assert.equal((await sync.sync(input, signal)).requestId, result.requestId);
    assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
    sync.dispose();
  });
}

test('cancelled and disposed dispatches fail before creating a native Session', async () => {
  const { calls, sync } = fixture();
  await assert.rejects(sync.sync(input, AbortSignal.abort()));
  sync.dispose();
  await assert.rejects(sync.sync({ ...input, requestId: 'disposed' }, new AbortController().signal));
  assert.equal(calls.length, 0);
});

test('concurrent different requests for the same Worktree cannot both create a Session', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { calls, sync } = fixture({ sessions: { modelCatalog: async () => {
    await gate;
    return { default: { provider: 'test', model: 'default' } };
  } } });
  const first = sync.sync(input, new AbortController().signal);
  await assert.rejects(sync.sync({ ...input, requestId: 'another' }, new AbortController().signal),
    (error) => error.code === 'WORKTREE_MUTATION_BUSY');
  release();
  await first;
  assert.equal(calls.filter(([kind]) => kind === 'create').length, 1);
  sync.dispose();
});

test('cancellation after creation returns partial identity and cannot dispatch a duplicate', async () => {
  const controller = new AbortController();
  const { sync } = fixture({ sessions: { create: async () => {
    controller.abort();
    return { sessionId: 'created-before-abort' };
  } } });
  const first = await sync.sync(input, controller.signal);
  assert.equal(first.sessionId, 'created-before-abort');
  assert.equal(first.status, 'binding-failed');
  assert.deepEqual(await sync.sync(input, new AbortController().signal), first);
  sync.dispose();
});
