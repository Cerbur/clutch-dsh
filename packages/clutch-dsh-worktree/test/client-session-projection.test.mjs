import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorktreeViewReader } from '../lib/client/view/worktree-view-read.js';
import { createWorktreeSessionConnector } from '../lib/client/session/worktree-session.js';
import { createWorktreeSessionCreation } from '../lib/host/session-creation.js';

const target = { workspaceId: 'ws', worktreeId: 'wt', absolutePath: '/wt', status: 'active', health: 'ready', branch: 'feature' };
const binding = { workspaceId: 'ws', worktreeId: 'wt', sessionId: 'new', status: 'active' };

for (const readFails of [false, true]) test(`creation prepares its response before notifying other readers (snapshot failure: ${readFails})`, async () => {
  let release;
  let entered;
  const postRead = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  let reads = 0;
  let notifications = 0;
  const host = createWorktreeSessionCreation({
    manager: {
      listWorktrees: () => assert.fail('target read required'),
      bindSession: async () => binding,
      readWorktreeSessionState: async () => {
        if (++reads === 2) { entered(); await gate; if (readFails) throw new Error('read unavailable'); }
        return { workspaceId: 'ws', target, revision: '2', bindings: [binding] };
      },
    },
    sessions: { create: async () => ({ sessionId: 'new' }), enterWorkingDirectory: async () => {} },
    changed: () => { notifications++; },
  });
  const creation = host.create({ workspaceId: 'ws', worktreeId: 'wt', requestId: 'ordered' }, new globalThis.AbortController().signal);
  try {
    await postRead;
    assert.equal(notifications, 0, 'notifications must not race the post-commit target read');
  } finally { release(); }
  const result = await creation;
  assert.equal(result.bound, true);
  assert.equal(result.state === undefined, readFails);
  assert.equal(notifications, 1);
  host.dispose();
});
function fixture() {
  const counts = { full: 0, target: 0, create: 0 };
  let bindings = [];
  let revision = '1';
  const manager = {
    listWorktrees: async () => { counts.full++; return [target]; },
    listBranches: async () => [{ name: 'main', isCurrent: true }],
    listBindings: async () => bindings,
    readWorktreeSessionState: async () => { counts.target++; return { workspaceId: 'ws', target, revision, bindings }; },
    bindSession: async () => { bindings = [binding]; revision = '2'; return binding; },
  };
  const reader = createWorktreeViewReader(manager);
  return { manager, reader, counts };
}

for (const notificationFirst of [true, false]) test(`warm creation publishes committed state with no full scan (notification first: ${notificationFirst})`, async () => {
  const { manager, reader, counts } = fixture();
  await reader.read('ws'); counts.full = 0;
  let notify;
  const host = createWorktreeSessionCreation({ manager,
    sessions: { create: async () => { counts.create++; return { sessionId: 'new' }; }, enterWorkingDirectory: async () => {} },
    changed: (workspaceId, _worktreeId, requestId) => {
      notify = () => reader.invalidate(workspaceId, { changeId: requestId });
      if (notificationFirst) notify();
    },
  });
  const opened = [];
  const connector = createWorktreeSessionConnector({ manager, viewReader: reader,
    sessions: { getSnapshot: () => ({ phase: 'ready', ids: [], byId: {} }) }, archivedSessionIds: () => [],
    createBoundSession: (input) => host.create(input, new globalThis.AbortController().signal),
    createSession: () => assert.fail('Host owns creation'), ensureSessionWorkspace() {}, openSession: (id) => opened.push(id) });
  await connector.create({ workspaceId: 'ws', worktreeId: 'wt', cwd: '/wt' }, async (id, ready) => {
    assert.equal(ready, true);
    if (!notificationFirst) notify();
    const view = await reader.read('ws');
    assert.equal(view.bindings[0].sessionId, id);
  });
  assert.deepEqual(opened, ['new']);
  assert.equal(counts.full, 0);
  assert.equal(counts.target, 3);
  assert.equal(counts.create, 1);
  host.dispose(); connector.dispose(); reader.dispose();
});

test('warm reuse performs no full scan and no native create', async () => {
  const { manager, reader, counts } = fixture();
  await manager.bindSession(); await reader.read('ws'); counts.full = 0;
  const connector = createWorktreeSessionConnector({ manager, viewReader: reader,
    sessions: { getSnapshot: () => ({ phase: 'ready', ids: ['new'], byId: { new: { blank: true, cwd: '/repo' } } }) },
    archivedSessionIds: () => [], createBoundSession: () => assert.fail('must reuse'),
    createSession: () => assert.fail('must reuse'), ensureSessionWorkspace() {}, openSession() {} });
  await connector.create({ workspaceId: 'ws', worktreeId: 'wt', cwd: '/wt' }, async (_id, ready) => {
    assert.equal(ready, true); assert.deepEqual((await reader.read('ws')).bindings, [binding]);
  });
  assert.equal(counts.full, 0); assert.equal(counts.target, 2);
  connector.dispose(); reader.dispose();
});

for (const interruption of ['unrelated-change', 'reconnect', 'dispose', 'old-revision', 'failure', 'cold']) {
  test(`session result falls back instead of overwriting newer state: ${interruption}`, async () => {
    const { reader } = fixture();
    if (interruption !== 'cold') await reader.read('ws');
    const finish = reader.beginSessionChange('ws', 'create');
    reader.invalidate('ws', { changeId: 'create' });
    if (interruption === 'unrelated-change') reader.invalidate('ws', { changeId: 'other' });
    if (interruption === 'reconnect') reader.resetChangeIds();
    if (interruption === 'dispose') reader.dispose();
    const state = interruption === 'failure' ? undefined : { workspaceId: 'ws', revision: '2', target, bindings: [binding] };
    assert.equal(finish(state, interruption === 'old-revision' ? '3' : '1'), false);
    reader.dispose();
  });
}

test('older revision cannot replace a published Session state', async () => {
  const { reader, manager } = fixture();
  await reader.read('ws');
  const finish = reader.beginSessionChange('ws', 'create');
  assert.equal(finish({ workspaceId: 'ws', revision: '3', target, bindings: [binding] }), true);
  const stale = reader.beginSessionChange('ws', 'old');
  assert.equal(stale({ workspaceId: 'ws', revision: '2', target, bindings: [] }), false);
  await manager.bindSession();
  assert.deepEqual((await reader.read('ws')).bindings, [binding]);
  reader.dispose();
});

for (const change of ['removed', 'rebound', 'missing']) {
  test(`creation never opens a target changed after binding: ${change}`, async () => {
    const { manager, reader } = fixture();
    await reader.read('ws');
    const connector = createWorktreeSessionConnector({ manager, viewReader: reader,
      sessions: { getSnapshot: () => ({ phase: 'ready', ids: [], byId: {} }) },
      archivedSessionIds: () => [],
      createBoundSession: async () => ({ sessionId: 'new', bound: true, state: {
        workspaceId: 'ws', revision: '3',
        target: change === 'missing' ? undefined : { ...target, status: change === 'removed' ? 'removed' : 'active' },
        bindings: [{ ...binding, worktreeId: change === 'rebound' ? 'other' : 'wt' }],
      } }),
      createSession: () => assert.fail('Host owns creation'), ensureSessionWorkspace() {},
      openSession: () => assert.fail('changed target must not open'),
    });
    await assert.rejects(connector.create({ workspaceId: 'ws', worktreeId: 'wt', cwd: '/wt' }),
      { code: 'WORKTREE_SESSION_REPAIR_REQUIRED' });
    connector.dispose(); reader.dispose();
  });
}

test('an old in-flight full read cannot overwrite committed target state', async () => {
  const { manager, reader } = fixture();
  await reader.read('ws');
  reader.invalidate('ws');
  let release;
  manager.listWorktrees = () => new Promise((resolve) => { release = resolve; });
  const oldRead = reader.read('ws');
  // A cold ticket cannot merge while this read is outstanding.
  const finish = reader.beginSessionChange('ws', 'create');
  assert.equal(finish({ workspaceId: 'ws', revision: '2', target, bindings: [binding] }), false);
  manager.listWorktrees = async () => [target];
  await manager.bindSession();
  await reader.read('ws');
  release([{ ...target, branch: 'obsolete' }]);
  await oldRead;
  assert.equal((await reader.read('ws')).worktrees[0].branch, 'feature');
  assert.deepEqual((await reader.read('ws')).bindings, [binding]);
  reader.dispose();
});
