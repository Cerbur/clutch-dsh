import assert from 'node:assert/strict';
import test from 'node:test';

test('creates a DSH Session at the Worktree cwd and binds it automatically', async () => {
  const { createSessionForWorktree } = await import('../lib/client/worktree-view.js');
  const calls = [];
  const opened = [];

  const sessionId = await createSessionForWorktree({
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    cwd: '/tmp/worktree-one',
    async createSession(input) {
      calls.push(['session.create', input]);
      return 'session-new';
    },
    manager: {
      async bindSession(input) {
        calls.push(['bindSession', input]);
        return { ...input, status: 'active' };
      },
    },
    openSession(session) {
      opened.push(session);
    },
  });

  assert.equal(sessionId, 'session-new');
  assert.deepEqual(calls, [
    ['session.create', { cwd: '/tmp/worktree-one' }],
    [
      'bindSession',
      { workspaceId: 'ws-one', worktreeId: 'wt-one', sessionId: 'session-new' },
    ],
  ]);
  assert.deepEqual(opened, ['session-new']);
});

test('keeps the DSH-created Session addressable when binding needs repair', async () => {
  const { createSessionForWorktree, WorktreeSessionBindingError } = await import(
    '../lib/client/worktree-view.js',
  );
  const created = [];
  const opened = [];

  await assert.rejects(
    createSessionForWorktree({
      workspaceId: 'ws-one',
      worktreeId: 'wt-one',
      cwd: '/tmp/worktree-one',
      async createSession(input) {
        created.push(input);
        return 'session-repair';
      },
      manager: {
        async bindSession() {
          throw new Error('sidecar is temporarily unavailable');
        },
      },
      openSession(session) {
        opened.push(session);
      },
    }),
    (error) => {
      assert.ok(error instanceof WorktreeSessionBindingError);
      assert.equal(error.sessionId, 'session-repair');
      return true;
    },
  );

  assert.deepEqual(created, [{ cwd: '/tmp/worktree-one' }]);
  assert.deepEqual(opened, []);
});
