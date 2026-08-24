import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';

import {
  createWorktreeSessionConnector,
  resolveWorktreeSessionAction,
  retryWorktreeSessionBinding,
} from '../lib/client/worktree-session.js';

function target(overrides = {}) {
  return {
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    absolutePath: '/tmp/worktree-one',
    status: 'active',
    health: 'ready',
    ...overrides,
  };
}

function sessions(overrides = {}) {
  return {
    phase: 'ready',
    ids: ['blank-one'],
    byId: {
      'blank-one': { blank: true, cwd: '/tmp/worktree-one' },
    },
    ...overrides,
  };
}

test('opens a qualifying blank Session already bound to the target Worktree', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions(),
      archivedSessionIds: [],
      bindings: [
        {
          workspaceId: 'ws-one',
          worktreeId: 'wt-one',
          sessionId: 'blank-one',
          status: 'active',
        },
      ],
    }),
    { kind: 'open-bound', sessionId: 'blank-one' },
  );
});

test('binds an unbound qualifying blank Session before opening it', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions(),
      archivedSessionIds: [],
      bindings: [],
    }),
    { kind: 'bind-existing', sessionId: 'blank-one' },
  );
});

test('waits instead of creating while the Session list is not ready', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions({ phase: 'pending' }),
      archivedSessionIds: [],
      bindings: [],
    }),
    { kind: 'wait', reason: 'sessions-not-ready' },
  );
});

test('reports repair when an active target binding points to a missing Session', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions({ ids: [], byId: {} }),
      archivedSessionIds: [],
      bindings: [
        {
          workspaceId: 'ws-one',
          worktreeId: 'wt-one',
          sessionId: 'missing-session',
          status: 'active',
        },
      ],
    }),
    { kind: 'repair', reason: 'active-binding-session-missing', sessionId: 'missing-session' },
  );
});

test('reports repair when an active target binding has the wrong Session cwd', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions({
        byId: { 'blank-one': { blank: true, cwd: '/tmp/other-worktree' } },
      }),
      archivedSessionIds: [],
      bindings: [
        {
          workspaceId: 'ws-one',
          worktreeId: 'wt-one',
          sessionId: 'blank-one',
          status: 'active',
        },
      ],
    }),
    { kind: 'repair', reason: 'active-binding-cwd-mismatch', sessionId: 'blank-one' },
  );
});

test('waits when a ready Session list lacks blank/cwd facts needed for reuse', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions({
        byId: { 'blank-one': { blank: true } },
      }),
      archivedSessionIds: [],
      bindings: [],
    }),
    { kind: 'wait', reason: 'session-facts-incomplete' },
  );
});

test('selects the first qualifying unbound blank Session in native list order', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions({
        ids: ['blank-two', 'blank-one'],
        byId: {
          'blank-one': { blank: true, cwd: '/tmp/worktree-one' },
          'blank-two': { blank: true, cwd: '/tmp/worktree-one' },
        },
      }),
      archivedSessionIds: [],
      bindings: [],
    }),
    { kind: 'bind-existing', sessionId: 'blank-two' },
  );
});

test('does not reuse archived or nonblank Sessions with the same cwd', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions({
        ids: ['archived-blank', 'normal'],
        byId: {
          'archived-blank': { blank: true, cwd: '/tmp/worktree-one' },
          normal: { blank: false, cwd: '/tmp/worktree-one' },
        },
      }),
      archivedSessionIds: ['archived-blank'],
      bindings: [],
    }),
    { kind: 'create' },
  );
});

test('does not reactivate detached bindings or claim a Session bound to another Worktree', () => {
  assert.deepEqual(
    resolveWorktreeSessionAction({
      target: target(),
      sessions: sessions({
        ids: ['detached-blank', 'other-blank', 'free-blank'],
        byId: {
          'detached-blank': { blank: true, cwd: '/tmp/worktree-one' },
          'other-blank': { blank: true, cwd: '/tmp/worktree-one' },
          'free-blank': { blank: true, cwd: '/tmp/worktree-one' },
        },
      }),
      archivedSessionIds: [],
      bindings: [
        {
          workspaceId: 'ws-one',
          worktreeId: 'wt-one',
          sessionId: 'detached-blank',
          status: 'detached',
        },
        {
          workspaceId: 'ws-one',
          worktreeId: 'wt-other',
          sessionId: 'other-blank',
          status: 'active',
        },
      ],
    }),
    { kind: 'bind-existing', sessionId: 'free-blank' },
  );
});

test('rejects removed and repair Worktrees before considering Sessions', () => {
  for (const candidate of [
    target({ status: 'removed' }),
    target({ health: 'repair' }),
  ]) {
    assert.deepEqual(
      resolveWorktreeSessionAction({
        target: candidate,
        sessions: sessions(),
        archivedSessionIds: [],
        bindings: [],
      }),
      { kind: 'reject', reason: 'worktree-not-available' },
    );
  }
});

test('opens a bound blank Session without creating or rebinding it', async () => {
  const calls = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        calls.push('listWorktrees');
        return [target()];
      },
      async listBindings() {
        calls.push('listBindings');
        return [{
          workspaceId: 'ws-one',
          worktreeId: 'wt-one',
          sessionId: 'blank-one',
          status: 'active',
        }];
      },
      async bindSession() {
        calls.push('bindSession');
        throw new Error('must not bind');
      },
    },
    sessions: { getSnapshot: () => sessions() },
    archivedSessionIds: () => [],
    createSession: async () => {
      calls.push('createSession');
      return 'unexpected';
    },
    ensureSessionWorkspace(workspaceId, sessionId) {
      calls.push(['ensure', workspaceId, sessionId]);
    },
    openSession(sessionId) {
      calls.push(['open', sessionId]);
    },
  });

  assert.equal(
    await connector.create({
      workspaceId: 'ws-one',
      worktreeId: 'wt-one',
      cwd: '/tmp/worktree-one',
    }),
    'blank-one',
  );
  assert.equal(calls.includes('createSession'), false);
  assert.equal(calls.includes('bindSession'), false);
  assert.deepEqual(calls.slice(-2), [
    ['ensure', 'ws-one', 'blank-one'],
    ['open', 'blank-one'],
  ]);
});

test('binds an existing blank Session before projecting and opening it', async () => {
  const calls = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession(input) {
        calls.push(['bind', input.sessionId]);
        return { ...input, status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions() },
    archivedSessionIds: () => [],
    createSession: async () => {
      calls.push('create');
      return 'unexpected';
    },
    ensureSessionWorkspace(workspaceId, sessionId) {
      calls.push(['ensure', workspaceId, sessionId]);
    },
    openSession(sessionId) {
      calls.push(['open', sessionId]);
    },
  });

  assert.equal(
    await connector.create({
      workspaceId: 'ws-one',
      worktreeId: 'wt-one',
      cwd: '/tmp/worktree-one',
    }),
    'blank-one',
  );
  assert.deepEqual(calls, [
    ['bind', 'blank-one'],
    ['ensure', 'ws-one', 'blank-one'],
    ['open', 'blank-one'],
  ]);
});

test('creates, binds, projects, and opens in the rc.8-compatible order', async () => {
  const calls = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession(input) {
        calls.push(['bind', input.sessionId]);
        return { ...input, status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    async createSession(input) {
      calls.push(['create', input]);
      return 'created-blank';
    },
    ensureSessionWorkspace(workspaceId, sessionId) {
      calls.push(['ensure', workspaceId, sessionId]);
    },
    openSession(sessionId) {
      calls.push(['open', sessionId]);
    },
  });

  assert.equal(
    await connector.create({
      workspaceId: 'ws-one',
      worktreeId: 'wt-one',
      cwd: '/tmp/worktree-one',
    }),
    'created-blank',
  );
  assert.deepEqual(calls, [
    ['create', { cwd: '/tmp/worktree-one' }],
    ['bind', 'created-blank'],
    ['ensure', 'ws-one', 'created-blank'],
    ['open', 'created-blank'],
  ]);
});

test('does not bind or open when fresh Session creation fails', async () => {
  const calls = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession() {
        calls.push('bind');
        return { workspaceId: 'ws-one', worktreeId: 'wt-one', sessionId: 'never', status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    async createSession() {
      calls.push('create');
      throw new Error('DSH unavailable');
    },
    ensureSessionWorkspace() {
      calls.push('ensure');
    },
    openSession() {
      calls.push('open');
    },
  });

  await assert.rejects(connector.create({
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    cwd: '/tmp/worktree-one',
  }), /DSH unavailable/);
  assert.deepEqual(calls, ['create']);
});

test('does not create when the binding list cannot be read', async () => {
  const calls = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        calls.push('listWorktrees');
        return [target()];
      },
      async listBindings() {
        calls.push('listBindings');
        throw new Error('sidecar unavailable');
      },
      async bindSession() {
        calls.push('bind');
        return { workspaceId: 'ws-one', worktreeId: 'wt-one', sessionId: 'never', status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    async createSession() {
      calls.push('create');
      return 'never';
    },
    ensureSessionWorkspace() {},
    openSession() {},
  });

  await assert.rejects(connector.create({
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    cwd: '/tmp/worktree-one',
  }), /sidecar unavailable/);
  assert.deepEqual(calls, ['listWorktrees', 'listBindings']);
});

test('keeps the fresh Session id in a binding failure for recovery', async () => {
  const opened = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession() {
        throw new Error('sidecar is temporarily unavailable');
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    createSession: async () => 'created-for-recovery',
    ensureSessionWorkspace() {
      throw new Error('must not project');
    },
    openSession(sessionId) {
      opened.push(sessionId);
    },
  });

  await assert.rejects(
    connector.create({
      workspaceId: 'ws-one',
      worktreeId: 'wt-one',
      cwd: '/tmp/worktree-one',
    }),
    (error) => {
      assert.equal(error.name, 'WorktreeSessionBindingError');
      assert.equal(error.sessionId, 'created-for-recovery');
      return true;
    },
  );
  assert.deepEqual(opened, []);
});

test('retries binding with the pending id, then ensures projection before opening', async () => {
  const calls = [];

  await retryWorktreeSessionBinding({
    manager: {
      async bindSession(input) {
        calls.push(['bind', input.sessionId]);
        return { ...input, status: 'active' };
      },
    },
    pending: {
      workspaceId: 'ws-one',
      worktreeId: 'wt-one',
      cwd: '/tmp/worktree-one',
      sessionId: 'pending-session',
    },
    archived: false,
    ensureSessionWorkspace(workspaceId, sessionId) {
      calls.push(['ensure', workspaceId, sessionId]);
    },
    openSession(sessionId) {
      calls.push(['open', sessionId]);
    },
  });

  assert.deepEqual(calls, [
    ['bind', 'pending-session'],
    ['ensure', 'ws-one', 'pending-session'],
    ['open', 'pending-session'],
  ]);
});

test('prohibits Retry when the pending Session has been archived', async () => {
  const calls = [];

  await assert.rejects(
    retryWorktreeSessionBinding({
      manager: {
        async bindSession() {
          calls.push('bind');
          return { workspaceId: 'ws-one', worktreeId: 'wt-one', sessionId: 'pending-session', status: 'active' };
        },
      },
      pending: {
        workspaceId: 'ws-one',
        worktreeId: 'wt-one',
        cwd: '/tmp/worktree-one',
        sessionId: 'pending-session',
      },
      archived: true,
      ensureSessionWorkspace() {
        calls.push('ensure');
      },
      openSession() {
        calls.push('open');
      },
    }),
    (error) => {
      assert.equal(error.code, 'SESSION_ARCHIVED');
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

test('does not fallback to create after SESSION_ALREADY_BOUND', async () => {
  let creates = 0;
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession() {
        throw {
          code: 'SESSION_ALREADY_BOUND',
          message: 'Session is already bound elsewhere',
          retryable: false,
          details: { worktreeId: 'wt-other' },
        };
      },
    },
    sessions: { getSnapshot: () => sessions() },
    archivedSessionIds: () => [],
    async createSession() {
      creates += 1;
      return 'must-not-create';
    },
    ensureSessionWorkspace() {},
    openSession() {},
  });

  await assert.rejects(
    connector.create({
      workspaceId: 'ws-one',
      worktreeId: 'wt-one',
      cwd: '/tmp/worktree-one',
    }),
    (error) => {
      assert.equal(error.code, 'SESSION_ALREADY_BOUND');
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(creates, 0);
});

test('coalesces concurrent creates for the same Worktree and clears the key after success', async () => {
  let createCalls = 0;
  let resolveCreate;
  const calls = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession(input) {
        calls.push(['bind', input.sessionId]);
        return { ...input, status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    createSession: async () => {
      createCalls += 1;
      return new Promise((resolve) => {
        resolveCreate = resolve;
      });
    },
    ensureSessionWorkspace(workspaceId, sessionId) {
      calls.push(['ensure', workspaceId, sessionId]);
    },
    openSession(sessionId) {
      calls.push(['open', sessionId]);
    },
  });
  const input = {
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    cwd: '/tmp/worktree-one',
  };

  const first = connector.create(input);
  const second = connector.create(input);
  assert.strictEqual(first, second);
  await flush();
  assert.equal(createCalls, 1);

  resolveCreate('coalesced-session');
  assert.equal(await first, 'coalesced-session');
  assert.deepEqual(calls, [
    ['bind', 'coalesced-session'],
    ['ensure', 'ws-one', 'coalesced-session'],
    ['open', 'coalesced-session'],
  ]);
});

test('keeps concurrent creates for different Worktrees independent', async () => {
  const creates = new Map();
  const opened = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [
          target(),
          target({ worktreeId: 'wt-two', absolutePath: '/tmp/worktree-two' }),
        ];
      },
      async listBindings() {
        return [];
      },
      async bindSession(input) {
        return { ...input, status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    createSession: async ({ cwd }) =>
      new Promise((resolve) => {
        creates.set(cwd, resolve);
      }),
    ensureSessionWorkspace() {},
    openSession(sessionId) {
      opened.push(sessionId);
    },
  });

  const first = connector.create({
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    cwd: '/tmp/worktree-one',
  });
  const second = connector.create({
    workspaceId: 'ws-one',
    worktreeId: 'wt-two',
    cwd: '/tmp/worktree-two',
  });
  await flush();
  assert.equal(creates.size, 2);

  creates.get('/tmp/worktree-one')('session-one');
  creates.get('/tmp/worktree-two')('session-two');
  assert.deepEqual(await Promise.all([first, second]), ['session-one', 'session-two']);
  assert.deepEqual(opened.sort(), ['session-one', 'session-two']);
});

test('removes a failed Worktree create from the in-flight map so a later call can retry', async () => {
  let attempts = 0;
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession(input) {
        return { ...input, status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    createSession: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary DSH failure');
      return 'retried-session';
    },
    ensureSessionWorkspace() {},
    openSession() {},
  });
  const input = {
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    cwd: '/tmp/worktree-one',
  };

  await assert.rejects(connector.create(input), /temporary DSH failure/);
  assert.equal(await connector.create(input), 'retried-session');
  assert.equal(attempts, 2);
});

test('does not project or open a late create result after Client disposal', async () => {
  let resolveCreate;
  const calls = [];
  const connector = createWorktreeSessionConnector({
    manager: {
      async listWorktrees() {
        return [target()];
      },
      async listBindings() {
        return [];
      },
      async bindSession(input) {
        calls.push(['bind', input.sessionId]);
        return { ...input, status: 'active' };
      },
    },
    sessions: { getSnapshot: () => sessions({ ids: [], byId: {} }) },
    archivedSessionIds: () => [],
    createSession: async () =>
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    ensureSessionWorkspace() {
      calls.push('ensure');
    },
    openSession() {
      calls.push('open');
    },
  });
  const pending = connector.create({
    workspaceId: 'ws-one',
    worktreeId: 'wt-one',
    cwd: '/tmp/worktree-one',
  });
  await flush();
  connector.dispose();
  resolveCreate('late-session');

  await assert.rejects(pending, (error) => error.code === 'CLIENT_DISPOSED');
  assert.deepEqual(calls, [['bind', 'late-session']]);
});
