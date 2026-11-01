import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalSessionConnector } from '../lib/client/session/local-session.js';

function fixture(bindings = []) {
  const calls = [];
  const options = {
    manager: { listBindings: async () => bindings },
    sessions: { getSnapshot: () => ({ phase: 'ready', ids: ['wt', 'detached', 'archived', 'local'],
      byId: Object.fromEntries(['wt', 'detached', 'archived', 'local'].map((id) => [id, { blank: true, cwd: '/repo' }])) }) },
    workspace: () => ({ path: '/repo', sessionIds: ['wt', 'detached', 'archived', 'local'] }),
    archivedSessionIds: () => ['archived'],
    canReuseSession: async () => true,
    createSession: async (input) => { calls.push(input); return input.sessionId ?? 'fresh'; },
    refreshSession: async (id) => calls.push(`refresh:${id}`),
    openSession: (id) => calls.push(`open:${id}`),
  };
  return { options, calls };
}

test('Local excludes both active and detached Worktree blanks with the same original cwd', async () => {
  const { options, calls } = fixture([{ sessionId: 'wt', status: 'active' }, { sessionId: 'detached', status: 'detached' }]);
  const connector = createLocalSessionConnector(options);
  await connector.create('ws');
  assert.deepEqual(calls, [{ workspaceId: 'ws', cwd: '/repo', sessionId: 'local' }, 'open:local']);
});

test('Local skips an unbound blank whose native effective cwd is still a Worktree', async () => {
  const { options, calls } = fixture();
  options.canReuseSession = async ({ sessionId }) => sessionId === 'local';
  await createLocalSessionConnector(options).create('ws');
  assert.deepEqual(calls, [{ workspaceId: 'ws', cwd: '/repo', sessionId: 'local' }, 'open:local']);
});

test('Local fails closed when effective directory validation fails', async () => {
  const { options, calls } = fixture();
  options.canReuseSession = async () => { throw new Error('directory unavailable'); };
  await assert.rejects(createLocalSessionConnector(options).create('ws'), /directory unavailable/);
  assert.deepEqual(calls, []);
});

test('Local refuses navigation if the candidate directory changes during native reuse', async () => {
  const { options, calls } = fixture();
  let reads = 0;
  options.canReuseSession = async () => ++reads === 1;
  await assert.rejects(createLocalSessionConnector(options).create('ws'), { code: 'SESSION_CWD_MISMATCH' });
  assert.deepEqual(calls, [{ workspaceId: 'ws', cwd: '/repo', sessionId: 'wt' }]);
});

test('when only a Worktree blank exists Local creates a distinct native Session', async () => {
  const { options, calls } = fixture([{ sessionId: 'wt', status: 'active' }]);
  options.workspace = () => ({ path: '/repo', sessionIds: ['wt'] });
  await createLocalSessionConnector(options).create('ws');
  assert.deepEqual(calls, [{ workspaceId: 'ws', cwd: '/repo' }, 'open:fresh']);
});

test('Local coalesces repeated clicks and disposal prevents late navigation', async () => {
  const { options, calls } = fixture();
  let release;
  options.manager.listBindings = () => new Promise((resolve) => { release = resolve; });
  const connector = createLocalSessionConnector(options);
  const first = connector.create('ws');
  assert.equal(connector.create('ws'), first);
  connector.dispose();
  release([]);
  await first;
  assert.deepEqual(calls, []);
});

test('Local fails closed on binding read failure and permits retry', async () => {
  const { options, calls } = fixture();
  options.manager.listBindings = async () => { throw new Error('read failed'); };
  const connector = createLocalSessionConnector(options);
  await assert.rejects(connector.create('ws'), /read failed/);
  assert.deepEqual(calls, []);
  options.manager.listBindings = async () => [];
  await connector.create('ws');
  assert.equal(calls.at(-1), 'open:wt');
});

test('Local lets the native Host reject stale blank reuse and refreshes the declined candidate', async () => {
  const { options, calls } = fixture();
  options.createSession = async () => 'fresh';
  await createLocalSessionConnector(options).create('ws');
  assert.deepEqual(calls, ['refresh:wt', 'open:fresh']);
});

test('native creation failure leaves the current Worktree Session selected', async () => {
  const { options, calls } = fixture();
  options.createSession = async () => { throw new Error('native refused'); };
  await assert.rejects(createLocalSessionConnector(options).create('ws'), /native refused/);
  assert.deepEqual(calls, []);
});

test('Local refuses creation before the native Session catalog is ready', async () => {
  const { options, calls } = fixture();
  options.sessions.getSnapshot = () => ({ phase: 'pending', ids: [], byId: {} });
  await assert.rejects(createLocalSessionConnector(options).create('ws'), { code: 'WORKTREE_VIEW_UNAVAILABLE' });
  assert.deepEqual(calls, []);
});
