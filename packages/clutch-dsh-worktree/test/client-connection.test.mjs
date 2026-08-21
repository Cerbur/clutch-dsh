import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_CONNECTION_ENDPOINTS,
  WorktreeConnectionError,
  createWorktreeConnectionAdapter,
} from '../lib/client/worktree-connection.js';

const METHODS = [
  ['listWorktrees', { workspaceId: 'ws1' }, []],
  ['listBranches', { workspaceId: 'ws1' }, []],
  ['createWorktree', { workspaceId: 'ws1', branch: 'feature/login' }, { worktreeId: 'wt1' }],
  ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1' }, null],
  ['listBindings', { workspaceId: 'ws1' }, []],
  ['bindSession', { workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1' }, { sessionId: 's1' }],
];

function successfulRpc(calls) {
  return {
    call(channel, endpoint, payload, signal) {
      calls.push({ channel, endpoint, payload, signal });
      return Promise.resolve({ ok: true, value: { ok: true, value: payload.args.input } });
    },
  };
}

test('routes all Worktree methods through /api with the canonical endpoint and payload', async () => {
  const calls = [];
  const adapter = createWorktreeConnectionAdapter(successfulRpc(calls));

  for (const [method, input] of METHODS) {
    await adapter[method](input);
  }

  assert.deepEqual(
    calls.map(({ channel, endpoint, payload, signal }) => ({
      channel,
      endpoint,
      payload,
      hasSignal:
        signal !== undefined &&
        typeof signal.aborted === 'boolean' &&
        typeof signal.addEventListener === 'function',
    })),
    METHODS.map(([method, input]) => ({
      channel: '/api',
      endpoint: WORKTREE_CONNECTION_ENDPOINTS[method],
      payload: { args: { input } },
      hasSignal: true,
    })),
  );
  assert.deepEqual(Object.values(WORKTREE_CONNECTION_ENDPOINTS), [
    'worktreeManager/listWorktrees',
    'worktreeManager/listBranches',
    'worktreeManager/createWorktree',
    'worktreeManager/removeWorktree',
    'worktreeManager/listBindings',
    'worktreeManager/bindSession',
  ]);
  adapter.dispose();
});

test('unwraps the Connection result before the Worktree domain result', async () => {
  const domainError = {
    code: 'SIDECAR_CORRUPT',
    message: 'sidecar is corrupt',
    details: { workspaceId: 'ws1' },
  };
  const adapter = createWorktreeConnectionAdapter({
    call: async () => ({ ok: true, value: { ok: false, error: domainError } }),
  });

  await assert.rejects(adapter.listWorktrees({ workspaceId: 'ws1' }), (error) => {
    assert.ok(error instanceof WorktreeConnectionError);
    assert.equal(error.code, domainError.code);
    assert.equal(error.message, domainError.message);
    assert.deepEqual(error.details, domainError.details);
    assert.equal(error.retryable, false);
    return true;
  });
});

test('turns Gateway failures, thrown calls, and malformed endpoint results into retryable errors', async () => {
  const cases = [
    {
      name: 'Gateway failure',
      rpc: {
        call: async () => ({
          ok: false,
          error: { code: 'method-unavailable', message: 'endpoint missing', details: {} },
        }),
      },
      expectedCode: 'method-unavailable',
      expectedMessage: 'endpoint missing',
    },
    {
      name: 'thrown call',
      rpc: { call: async () => Promise.reject(new Error('connection lost')) },
      expectedCode: 'CONNECTION_CALL_FAILED',
      expectedMessage: 'connection lost',
    },
    {
      name: 'malformed value',
      rpc: { call: async () => ({ ok: true, value: { unexpected: true } }) },
      expectedCode: 'WORKTREE_RPC_INVALID_RESULT',
      expectedMessage: '',
    },
  ];

  for (const { name, rpc, expectedCode, expectedMessage } of cases) {
    const adapter = createWorktreeConnectionAdapter(rpc);
    await assert.rejects(adapter.listWorktrees({ workspaceId: 'ws1' }), (error) => {
      assert.ok(error instanceof WorktreeConnectionError, name);
      assert.equal(error.code, expectedCode, name);
      assert.equal(error.message, expectedMessage, name);
      assert.equal(error.details.endpoint, 'worktreeManager/listWorktrees', name);
      assert.equal(error.retryable, true, name);
      return true;
    });
    adapter.dispose();
  }
});

test('dispose aborts in-flight calls and rejects new calls', async () => {
  let signal;
  const adapter = createWorktreeConnectionAdapter({
    call: (_channel, _endpoint, _payload, requestSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });

  const pending = adapter.listWorktrees({ workspaceId: 'ws1' });
  adapter.dispose();
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, WorktreeConnectionError);
  await assert.rejects(adapter.listWorktrees({ workspaceId: 'ws1' }), (error) => {
    assert.ok(error instanceof WorktreeConnectionError);
    assert.equal(error.code, 'CLIENT_DISPOSED');
    assert.equal(error.retryable, false);
    return true;
  });
});
