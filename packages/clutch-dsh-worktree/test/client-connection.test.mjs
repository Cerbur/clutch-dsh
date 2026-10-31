import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_CONNECTION_ENDPOINTS,
  WorktreeConnectionError,
  createWorktreeConnectionAdapter,
} from '../lib/client/worktree-connection.js';

const METHODS = [
  ['createWorktreeSession', { workspaceId: 'ws1', worktreeId: 'wt1', requestId: 'create-1' }, { sessionId: 's1', bound: true }],
  ['syncWorktreeBaseline', { workspaceId: 'ws1', worktreeId: 'wt1', baseBranch: 'main', strategy: 'merge', requestId: 'req1' }, { sessionId: 's1', status: 'dispatched' }],
  ['getWorkspaceGitState', { workspaceId: 'ws1' }, { currentBranch: 'main' }],
  ['getToolSettings', { scope: { kind: 'general' } }, { enabled: false, tools: [] }],
  ['updateToolSettings', { scope: { kind: 'general' }, selection: { enabled: true, tools: [] }, expected: { enabled: false, tools: [] } }, { enabled: false, tools: [] }],
  ['getWorktreeInstructions', { workspaceId: 'ws1', worktreeId: 'wt1' }, 'Use tests'],
  ['updateWorktreeInstructions', { workspaceId: 'ws1', worktreeId: 'wt1', instructions: 'Use tests', expectedInstructions: '' }, 'Use tests'],
  ['updateWorktreeBaseBranch', { workspaceId: 'ws1', worktreeId: 'wt1', baseBranch: 'main', expectedBaseBranch: 'old' }, 'main'],
  ['adoptWorktreeBranch', { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token', expectedBranch: 'merge/foo' }, null],
  ['recoverWorktrees', { workspaceId: 'ws1' }, null],
  ['listWorktrees', { workspaceId: 'ws1' }, []],
  ['listWorktreeCommits', { workspaceId: 'ws1', worktreeId: 'wt1', baseBranch: 'main' }, { commits: [], truncated: false }],
  ['listWorktreeCommitFiles', { workspaceId: 'ws1', worktreeId: 'wt1', commit: 'a'.repeat(40), baseBranch: 'main' }, { commit: 'a'.repeat(40), files: [] }],
  ['getWorktreeCommitFileDiff', { workspaceId: 'ws1', worktreeId: 'wt1', commit: 'a'.repeat(40), path: 'src/index.ts', baseBranch: 'main' }, { commit: 'a'.repeat(40), path: 'src/index.ts', patch: '', binary: false }],
  ['listImportCandidates', { workspaceId: 'ws1' }, []],
  ['listBranches', { workspaceId: 'ws1' }, []],
  ['fetchRemoteBranches', { workspaceId: 'ws1' }, []],
  ['getWorkspaceCheckout', { workspaceId: 'ws1' }, { gitRootPath: '/repo', workspacePath: '/repo/app', currentHead: { kind: 'tag', name: 'v1', commit: 'a'.repeat(40) } }],
  ['createWorktree', { workspaceId: 'ws1', branch: 'feature/login' }, { worktreeId: 'wt1' }],
  ['importWorktree', { workspaceId: 'ws1', absolutePath: '/tmp/external' }, { worktreeId: 'wt_external' }],
  ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token-example' }, null],
  ['insertWorktreeBefore', {
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    beforeWorktreeId: 'wt2',
  }, ['wt1', 'wt2']],
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

test('shares concurrent branch reads per Workspace but rereads after terminal changes', async () => {
  const calls = [];
  const resolves = [];
  const adapter = createWorktreeConnectionAdapter({ call(channel, endpoint, payload) {
    calls.push({ channel, endpoint, payload });
    return new Promise((resolve) => resolves.push(resolve));
  } });
  const first = adapter.listBranches({ workspaceId: 'ws1' });
  const duplicate = adapter.listBranches({ workspaceId: 'ws1' });
  assert.equal(first, duplicate);
  const other = adapter.listBranches({ workspaceId: 'ws2' });
  assert.equal(calls.length, 2);
  resolves[0]({ ok: true, value: { ok: true, value: [{ name: 'main' }] } });
  resolves[1]({ ok: true, value: { ok: true, value: [] } });
  await Promise.all([first, duplicate, other]);
  const fresh = adapter.listBranches({ workspaceId: 'ws1' });
  assert.equal(calls.length, 3);
  resolves[2]({ ok: true, value: { ok: true, value: [{ name: 'terminal/new' }] } });
  assert.deepEqual(await fresh, [{ name: 'terminal/new' }]);
  adapter.dispose();
});

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
    'worktreeManager/createWorktreeSession',
    'worktreeManager/syncWorktreeBaseline',
    'worktreeManager/getWorkspaceGitState',
    'worktreeManager/getToolSettings',
    'worktreeManager/updateToolSettings',
    'worktreeManager/watchToolChanges',
    'worktreeManager/listWorktrees',
    'worktreeManager/listWorktreeCommits',
    'worktreeManager/listWorktreeCommitFiles',
    'worktreeManager/getWorktreeCommitFileDiff',
    'worktreeManager/listImportCandidates',
    'worktreeManager/listBranches',
    'worktreeManager/fetchRemoteBranches',
    'worktreeManager/getWorkspaceCheckout',
    'worktreeManager/createWorktree',
    'worktreeManager/importWorktree',
    'worktreeManager/removeWorktree',
    'worktreeManager/unarchiveWorktree',
    'worktreeManager/cleanWorktree',
    'worktreeManager/adoptWorktreeBranch',
    'worktreeManager/recoverWorktrees',
    'worktreeManager/forgetWorktree',
    'worktreeManager/insertWorktreeBefore',
    'worktreeManager/getWorktreeInstructions',
    'worktreeManager/updateWorktreeInstructions',
    'worktreeManager/updateWorktreeBaseBranch',
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

test('dispose aborts an in-flight external Worktree import request', async () => {
  let signal;
  const adapter = createWorktreeConnectionAdapter({
    call: (_channel, _endpoint, _payload, requestSignal) => {
      signal = requestSignal;
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });

  const pending = adapter.importWorktree({ workspaceId: 'ws1', absolutePath: '/tmp/external' });
  adapter.dispose();
  assert.equal(signal.aborted, true);
  await assert.rejects(pending, (error) => error?.code === 'CLIENT_DISPOSED');
});
