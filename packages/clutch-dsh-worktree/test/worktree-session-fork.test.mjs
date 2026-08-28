import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorktreeSessionForkCoordinator } from '../lib/client/worktree-session-fork.js';

function binding(overrides = {}) {
  return {
    workspaceId: 'workspace-one',
    worktreeId: 'worktree-one',
    sessionId: 'parent-session',
    status: 'active',
    ...overrides,
  };
}

function sessionList(overrides = {}) {
  return {
    phase: 'ready',
    ids: ['parent-session', 'child-session'],
    byId: {
      'parent-session': { blank: false },
      'child-session': { blank: false, parentId: 'parent-session' },
    },
    ...overrides,
  };
}

test('forks with native options, binds the child, and projects Worktree membership', async () => {
  const calls = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: async (input) => {
      calls.push(['fork', input]);
      return 'child-session';
    },
    findBinding: async (sessionId) => {
      calls.push(['findBinding', sessionId]);
      return binding();
    },
    bindSession: async (input) => {
      calls.push(['bindSession', input]);
      return binding({ sessionId: input.sessionId });
    },
    ensureSessionWorkspace: (workspaceId, sessionId) => {
      calls.push(['ensureSessionWorkspace', workspaceId, sessionId]);
    },
  });

  const childId = await coordinator.fork({
    sessionId: 'parent-session',
    atSeq: 12.75,
    increaseTitle: true,
  });

  assert.equal(childId, 'child-session');
  assert.deepEqual(calls, [
    ['fork', { sessionId: 'parent-session', atSeq: 12.75, increaseTitle: true }],
    ['findBinding', 'parent-session'],
    ['bindSession', {
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      sessionId: 'child-session',
    }],
    ['ensureSessionWorkspace', 'workspace-one', 'child-session'],
  ]);
  assert.deepEqual(coordinator.recovery.getSnapshot().pending, []);
  assert.equal(coordinator.recovery.getSnapshot().revision, 1);
  assert.equal(coordinator.recovery.getSnapshot(), coordinator.recovery.getSnapshot());
  coordinator.dispose();
});

test('leaves a Main Session fork alone when no active Worktree binding exists', async () => {
  const calls = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: async () => 'child-session',
    findBinding: async () => undefined,
    bindSession: async (input) => {
      calls.push(input);
    },
    ensureSessionWorkspace: (...input) => {
      calls.push(input);
    },
  });

  assert.equal(await coordinator.fork({ sessionId: 'parent-session' }), 'child-session');
  assert.deepEqual(calls, []);
  assert.deepEqual(coordinator.recovery.getSnapshot().pending, []);
  coordinator.dispose();
});

test('keeps the native child when sidecar binding fails and retries the same child', async () => {
  let shouldFail = true;
  const ensured = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: async () => 'child-session',
    findBinding: async () => binding(),
    bindSession: async () => {
      if (shouldFail) throw Object.assign(new Error('sidecar unavailable'), {
        code: 'SIDECAR_UNAVAILABLE',
        retryable: true,
      });
      return binding({ sessionId: 'child-session' });
    },
    ensureSessionWorkspace: (...input) => {
      ensured.push(input);
    },
  });

  assert.equal(await coordinator.fork({ sessionId: 'parent-session' }), 'child-session');
  const failed = coordinator.recovery.getSnapshot();
  assert.equal(failed.pending.length, 1);
  assert.equal(failed.pending[0].childSessionId, 'child-session');
  assert.equal(failed.pending[0].sourceSessionId, 'parent-session');
  assert.equal(failed.pending[0].binding.worktreeId, 'worktree-one');
  assert.equal(ensured.length, 0);

  shouldFail = false;
  assert.equal(await coordinator.retry(failed.pending[0].key), true);
  assert.deepEqual(ensured, [['workspace-one', 'child-session']]);
  assert.deepEqual(coordinator.recovery.getSnapshot().pending, []);
  coordinator.dispose();
});

test('reconciles only persisted fork children, not subagents or unrelated sessions', async () => {
  const calls = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: {
      getSnapshot: () => sessionList({
        ids: ['parent-session', 'child-session', 'subagent-session', 'orphan-session'],
        byId: {
          'parent-session': { blank: false },
          'child-session': { blank: false, parentId: 'parent-session' },
          'subagent-session': {
            blank: false,
            parentId: 'parent-session',
            origin: 'subagent',
          },
          'orphan-session': { blank: false, parentId: 'missing-parent' },
        },
      }),
    },
    fork: async () => 'unused',
    findBinding: async (sessionId) => {
      calls.push(['findBinding', sessionId]);
      return sessionId === 'parent-session' ? binding() : undefined;
    },
    bindSession: async (input) => {
      calls.push(['bindSession', input]);
      return binding({ sessionId: input.sessionId });
    },
    ensureSessionWorkspace: (workspaceId, sessionId) => {
      calls.push(['ensureSessionWorkspace', workspaceId, sessionId]);
    },
  });

  await coordinator.reconcile();

  assert.deepEqual(calls, [
    ['findBinding', 'parent-session'],
    ['bindSession', {
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      sessionId: 'child-session',
    }],
    ['ensureSessionWorkspace', 'workspace-one', 'child-session'],
  ]);
  coordinator.dispose();
});

test('does not run plugin work after disposal if native fork resolves late', async () => {
  let resolveFork;
  const calls = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: () => new Promise((resolve) => {
      resolveFork = resolve;
    }),
    findBinding: async () => {
      calls.push('findBinding');
      return binding();
    },
    bindSession: async () => {
      calls.push('bindSession');
    },
    ensureSessionWorkspace: () => {
      calls.push('ensureSessionWorkspace');
    },
  });

  const forkPromise = coordinator.fork({ sessionId: 'parent-session' });
  coordinator.dispose();
  resolveFork('child-session');

  assert.equal(await forkPromise, 'child-session');
  assert.deepEqual(calls, []);
});
