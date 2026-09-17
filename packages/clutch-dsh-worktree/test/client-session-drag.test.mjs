import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitSessionOrder,
  resolveSessionDragOrder,
} from '../lib/client/surface/actions/useDragActions.js';

test('commits Worktree Session order locally without native Workspace mutation', async () => {
  const calls = [];
  let localOrder;

  await commitSessionOrder({
    groupKey: 'worktree:wt-1',
    workspaceId: 'workspace-1',
    sessionId: 'session-2',
    beforeSessionId: 'session-1',
    nextOrder: ['session-2', 'session-1'],
    insertSessionBefore: async (...args) => {
      calls.push(args);
      throw new Error('Worktree Sessions are not native Workspace members');
    },
    setOrder: (groupKey, order) => {
      localOrder = { groupKey, order: [...order] };
    },
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(localOrder, {
    groupKey: 'worktree:wt-1',
    order: ['session-2', 'session-1'],
  });
});

test('resolves filtered drops against the full order and retains hidden Sessions', () => {
  assert.deepEqual(
    resolveSessionDragOrder({
      visibleSessionIds: ['a', 'c'],
      currentOrder: ['a', 'b', 'c', 'd'],
      sessionId: 'a',
      over: { sessionId: 'c', half: 'before' },
    }),
    {
      beforeSessionId: 'c',
      nextOrder: ['b', 'a', 'c', 'd'],
    },
  );
  assert.deepEqual(
    resolveSessionDragOrder({
      visibleSessionIds: ['a', 'c'],
      currentOrder: ['a', 'b', 'c', 'd'],
      sessionId: 'c',
      over: { sessionId: 'a', half: 'after' },
    }),
    {
      beforeSessionId: 'b',
      nextOrder: ['a', 'c', 'b', 'd'],
    },
  );
  assert.deepEqual(
    resolveSessionDragOrder({
      visibleSessionIds: ['a', 'c'],
      currentOrder: ['a', 'hidden'],
      sessionId: 'a',
      over: { sessionId: 'c', half: 'before' },
    }),
    {
      beforeSessionId: 'c',
      nextOrder: ['hidden', 'a', 'c'],
    },
  );
});

test('derives full-order native anchors and no-op results', () => {
  assert.deepEqual(
    resolveSessionDragOrder({
      visibleSessionIds: ['a', 'b', 'c'],
      currentOrder: ['a', 'b', 'c'],
      sessionId: 'a',
      over: { sessionId: 'b', half: 'after' },
    }),
    {
      beforeSessionId: 'c',
      nextOrder: ['b', 'a', 'c'],
    },
  );
  assert.deepEqual(
    resolveSessionDragOrder({
      visibleSessionIds: ['a', 'b', 'c'],
      currentOrder: ['a', 'b', 'c'],
      sessionId: 'a',
      over: { sessionId: 'c', half: 'after' },
    }),
    {
      beforeSessionId: undefined,
      nextOrder: ['b', 'c', 'a'],
    },
  );
  assert.equal(
    resolveSessionDragOrder({
      visibleSessionIds: ['a', 'b', 'c'],
      currentOrder: ['a', 'b', 'c'],
      sessionId: 'c',
      over: { sessionId: 'b', half: 'after' },
    }),
    undefined,
  );
  assert.equal(
    resolveSessionDragOrder({
      visibleSessionIds: ['a', 'b'],
      currentOrder: ['a', 'b'],
      sessionId: 'missing',
      over: { sessionId: 'b', half: 'after' },
    }),
    undefined,
  );
});

test('commits Main Session order through DSH before updating the local projection', async () => {
  const events = [];
  const move = resolveSessionDragOrder({
    visibleSessionIds: ['a', 'b', 'c'],
    currentOrder: ['a', 'b', 'c'],
    sessionId: 'a',
    over: { sessionId: 'b', half: 'after' },
  });

  assert.deepEqual(move, {
    beforeSessionId: 'c',
    nextOrder: ['b', 'a', 'c'],
  });
  if (move === undefined) throw new Error('expected a Main Session move');

  await commitSessionOrder({
    groupKey: 'main:workspace-1',
    workspaceId: 'workspace-1',
    sessionId: 'a',
    beforeSessionId: move.beforeSessionId,
    nextOrder: move.nextOrder,
    insertSessionBefore: async (...args) => {
      events.push(['native', args]);
    },
    setOrder: (groupKey, order) => {
      events.push(['local', groupKey, [...order]]);
    },
  });

  assert.deepEqual(events, [
    ['native', ['workspace-1', 'a', 'c']],
    ['local', 'main:workspace-1', ['b', 'a', 'c']],
  ]);
});

test('leaves the Main local projection unchanged when native ordering rejects', async () => {
  let localCalls = 0;

  await assert.rejects(
    commitSessionOrder({
      groupKey: 'main:workspace-1',
      workspaceId: 'workspace-1',
      sessionId: 'session-2',
      beforeSessionId: 'session-1',
      nextOrder: ['session-2', 'session-1'],
      insertSessionBefore: async () => {
        throw new Error('native ordering rejected');
      },
      setOrder: () => {
        localCalls += 1;
      },
    }),
    /native ordering rejected/,
  );
  assert.equal(localCalls, 0);
});
