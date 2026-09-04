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

function bindingLookup(sessionIds, resolveBinding) {
  return {
    bySessionId: new Map(
      sessionIds.map((sessionId) => {
        const value = resolveBinding(sessionId);
        return [
          sessionId,
          value === undefined ? { status: 'missing' } : { status: 'found', binding: value },
        ];
      }),
    ),
  };
}

test('forks with native options and waits for Worktree membership refresh', async () => {
  const calls = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: async (input) => {
      calls.push(['fork', input]);
      return 'child-session';
    },
    findBindings: async (sessionIds) => {
      calls.push(['findBindings', [...sessionIds]]);
      return bindingLookup(sessionIds, () => binding());
    },
    bindSession: async (input) => {
      calls.push(['bindSession', input]);
      return binding({ sessionId: input.sessionId });
    },
    ensureSessionWorkspace: (workspaceId, sessionId) => {
      calls.push(['ensureSessionWorkspace', workspaceId, sessionId]);
    },
    onBound: (childBinding) => {
      calls.push(['onBound', childBinding]);
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
    ['findBindings', ['parent-session']],
    [
      'bindSession',
      {
        workspaceId: 'workspace-one',
        worktreeId: 'worktree-one',
        sessionId: 'child-session',
      },
    ],
    [
      'onBound',
      {
        workspaceId: 'workspace-one',
        worktreeId: 'worktree-one',
        sessionId: 'child-session',
        status: 'active',
      },
    ],
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
    findBindings: async (sessionIds) => bindingLookup(sessionIds, () => undefined),
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

test('keeps the native child when sidecar binding fails and retries without eager projection', async () => {
  let shouldFail = true;
  let findBindingCalls = 0;
  const ensured = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: async () => 'child-session',
    findBindings: async (sessionIds) => {
      findBindingCalls += 1;
      return bindingLookup(sessionIds, () => binding());
    },
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
  assert.deepEqual(failed.affectedWorkspaceIds, ['workspace-one']);
  assert.equal(ensured.length, 0);

  shouldFail = false;
  assert.equal(await coordinator.retry(failed.pending[0].key), true);
  assert.equal(findBindingCalls, 1);
  assert.deepEqual(ensured, []);
  assert.deepEqual(coordinator.recovery.getSnapshot().pending, []);
  assert.deepEqual(coordinator.recovery.getSnapshot().affectedWorkspaceIds, ['workspace-one']);
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
    findBindings: async (sessionIds) => {
      calls.push(['findBindings', [...sessionIds]]);
      return bindingLookup(sessionIds, (sessionId) =>
        sessionId === 'parent-session' ? binding() : undefined,
      );
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
    ['findBindings', ['parent-session']],
    ['bindSession', {
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      sessionId: 'child-session',
    }],
  ]);
  coordinator.dispose();
});

test('does not rescan an unresolved child for equivalent Session notifications', async () => {
  let snapshot = sessionList();
  let lookupCount = 0;
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: { getSnapshot: () => snapshot },
    fork: async () => 'unused',
    findBindings: async (sessionIds) => {
      lookupCount += 1;
      return bindingLookup(sessionIds, () => undefined);
    },
    bindSession: async () => {
      throw new Error('no binding should be attempted');
    },
  });

  await coordinator.reconcile();
  await coordinator.reconcile();
  assert.equal(lookupCount, 1);

  snapshot = sessionList({
    ids: ['parent-session', 'parent-two', 'child-session'],
    byId: {
      'parent-session': { blank: false },
      'parent-two': { blank: false },
      'child-session': { blank: false, parentId: 'parent-two' },
    },
  });
  await coordinator.reconcile();
  assert.equal(lookupCount, 2);

  await coordinator.reconcile({ force: true });
  assert.equal(lookupCount, 3);
  coordinator.dispose();
});

test('uses one binding lookup batch for unique parent Sessions', async () => {
  const lookupRequests = [];
  const boundChildren = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: {
      getSnapshot: () => ({
        phase: 'ready',
        ids: ['parent-one', 'parent-two', 'child-one', 'child-two', 'child-three'],
        byId: {
          'parent-one': { blank: false },
          'parent-two': { blank: false },
          'child-one': { blank: false, parentId: 'parent-one' },
          'child-two': { blank: false, parentId: 'parent-one' },
          'child-three': { blank: false, parentId: 'parent-two' },
        },
      }),
    },
    fork: async () => 'unused',
    findBindings: async (sessionIds) => {
      lookupRequests.push([...sessionIds]);
      return {
        bySessionId: new Map(
          sessionIds.map((sessionId) => [
            sessionId,
            {
              status: 'found',
              binding: binding({ sessionId, worktreeId: `worktree-${sessionId}` }),
            },
          ]),
        ),
      };
    },
    bindSession: async (input) => {
      boundChildren.push(input.sessionId);
    },
  });

  await coordinator.reconcile();

  assert.deepEqual(lookupRequests, [['parent-one', 'parent-two']]);
  assert.deepEqual(boundChildren, ['child-one', 'child-two', 'child-three']);
  coordinator.dispose();
});

test('keeps lookup failures retryable without repeating them for metadata updates', async () => {
  const lookupRequests = [];
  let shouldFail = true;
  const lookupError = Object.assign(new Error('binding read unavailable'), {
    code: 'SIDECAR_UNAVAILABLE',
    retryable: true,
  });
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: { getSnapshot: () => sessionList() },
    fork: async () => 'unused',
    findBindings: async (sessionIds) => {
      lookupRequests.push([...sessionIds]);
      if (shouldFail) {
        return {
          bySessionId: new Map(
            sessionIds.map((sessionId) => [
              sessionId,
              {
                status: 'error',
                error: lookupError,
              },
            ]),
          ),
        };
      }
      return bindingLookup(sessionIds, () => binding());
    },
    bindSession: async () => undefined,
  });

  await coordinator.reconcile();
  assert.equal(coordinator.recovery.getSnapshot().pending.length, 1);
  await coordinator.reconcile();
  assert.deepEqual(lookupRequests, [['parent-session']]);

  shouldFail = false;
  assert.equal(await coordinator.retry(coordinator.recovery.getSnapshot().pending[0].key), true);
  assert.deepEqual(lookupRequests, [['parent-session'], ['parent-session']]);
  assert.deepEqual(coordinator.recovery.getSnapshot().pending, []);
  coordinator.dispose();
});

test('publishes when a missing lookup clears recovery without a known Workspace', async () => {
  const lookupError = new Error('binding read unavailable');
  let lookupCount = 0;
  const notifications = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: { getSnapshot: () => sessionList() },
    fork: async () => 'unused',
    findBindings: async (sessionIds) => {
      lookupCount += 1;
      if (lookupCount === 1) {
        return {
          bySessionId: new Map(
            sessionIds.map((sessionId) => [
              sessionId,
              { status: 'error', error: lookupError },
            ]),
          ),
        };
      }
      return {
        bySessionId: new Map(
          sessionIds.map((sessionId) => [sessionId, { status: 'missing' }]),
        ),
      };
    },
    bindSession: async () => {
      throw new Error('missing bindings must not be bound');
    },
  });
  const unsubscribe = coordinator.recovery.subscribe(() => {
    notifications.push(coordinator.recovery.getSnapshot());
  });

  await coordinator.reconcile();
  const failed = coordinator.recovery.getSnapshot();
  assert.equal(failed.pending.length, 1);
  assert.equal(failed.pending[0].binding, undefined);
  assert.deepEqual(failed.affectedWorkspaceIds, []);
  assert.equal(lookupCount, 1);
  assert.equal(notifications.length, 1);

  await coordinator.reconcile({ force: true });
  const cleared = coordinator.recovery.getSnapshot();
  assert.deepEqual(cleared.pending, []);
  assert.deepEqual(cleared.affectedWorkspaceIds, []);
  assert.equal(cleared.revision, failed.revision + 1);
  assert.equal(lookupCount, 2);
  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications[1].pending, []);
  assert.deepEqual(notifications[1].affectedWorkspaceIds, []);

  unsubscribe();
  coordinator.dispose();
});

test('does not invent a Workspace scope for an unknown binding lookup failure', async () => {
  const lookupError = new Error('binding read unavailable');
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: { getSnapshot: () => sessionList() },
    fork: async () => 'unused',
    findBindings: async () => {
      throw lookupError;
    },
    bindSession: async () => undefined,
  });

  await coordinator.reconcile();

  assert.deepEqual(coordinator.recovery.getSnapshot().affectedWorkspaceIds, []);
  assert.equal(coordinator.recovery.getSnapshot().pending.length, 1);
  coordinator.dispose();
});

test('waits for a usable Session snapshot after malformed data', async () => {
  let snapshot = { phase: 'pending', ids: [], byId: {} };
  let lookupCount = 0;
  const coordinator = createWorktreeSessionForkCoordinator({
    sessions: { getSnapshot: () => snapshot },
    fork: async () => 'unused',
    findBindings: async (sessionIds) => {
      lookupCount += 1;
      return bindingLookup(sessionIds, () => undefined);
    },
    bindSession: async () => undefined,
  });

  await coordinator.reconcile();
  assert.equal(lookupCount, 0);

  snapshot = null;
  await assert.doesNotReject(coordinator.reconcile());
  assert.equal(lookupCount, 0);

  snapshot = sessionList();
  await coordinator.reconcile();
  assert.equal(lookupCount, 1);
  coordinator.dispose();
});

test('does not run plugin work after disposal if native fork resolves late', async () => {
  let resolveFork;
  const calls = [];
  const coordinator = createWorktreeSessionForkCoordinator({
    fork: () => new Promise((resolve) => {
      resolveFork = resolve;
    }),
    findBindings: async () => {
      calls.push('findBindings');
      return bindingLookup(['parent-session'], () => binding());
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
