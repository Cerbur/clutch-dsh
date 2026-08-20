import assert from 'node:assert/strict';
import test from 'node:test';

import { WORKTREE_REMOTE_METHODS } from '../lib/contract/index.js';
import {
  WorktreeConnectionError,
  createWorktreeConnectionAdapter,
} from '../lib/client/worktree-connection.js';

const worktree = {
  worktreeId: 'wt_example',
  workspaceId: 'ws_example',
  absolutePath: '/tmp/dsh/worktree/wt_example',
  branch: 'feature/example',
  status: 'active',
};

test('exposes only the six browser-safe Worktree Manager methods', () => {
  assert.deepEqual(WORKTREE_REMOTE_METHODS, [
    'listWorktrees',
    'listBranches',
    'createWorktree',
    'removeWorktree',
    'listBindings',
    'bindSession',
  ]);
  assert.equal(WORKTREE_REMOTE_METHODS.includes('resolveRuntimeCwd'), false);
});

test('adapts the shared Connection RPC to the WorktreeManager contract', async () => {
  const calls = [];
  const rpc = {
    async call(channel, endpoint, payload, signal) {
      calls.push({ channel, endpoint, payload, signal });
      const input = payload.args.input;
      const value = endpoint.endsWith('/listWorktrees')
        ? [worktree]
        : endpoint.endsWith('/createWorktree')
          ? worktree
          : endpoint.endsWith('/bindSession')
            ? {
                workspaceId: input.workspaceId,
                worktreeId: input.worktreeId,
                sessionId: input.sessionId,
                status: 'active',
              }
            : endpoint.endsWith('/removeWorktree')
              ? null
              : [];
      return { ok: true, value: { ok: true, value } };
    },
  };
  const manager = createWorktreeConnectionAdapter(rpc);

  assert.deepEqual(await manager.listWorktrees({ workspaceId: 'ws_example' }), [worktree]);
  assert.deepEqual(await manager.listBranches({ workspaceId: 'ws_example' }), []);
  assert.deepEqual(
    await manager.createWorktree({ workspaceId: 'ws_example', branch: 'feature/example' }),
    worktree,
  );
  assert.equal(
    await manager.removeWorktree({ workspaceId: 'ws_example', worktreeId: 'wt_example' }),
    undefined,
  );
  assert.deepEqual(await manager.listBindings({ workspaceId: 'ws_example' }), []);
  assert.deepEqual(
    await manager.bindSession({
      workspaceId: 'ws_example',
      worktreeId: 'wt_example',
      sessionId: 'session_example',
    }),
    {
      workspaceId: 'ws_example',
      worktreeId: 'wt_example',
      sessionId: 'session_example',
      status: 'active',
    },
  );
  assert.equal(
    calls.every(
      ({ channel, payload, signal }) => channel === '/api' && payload.args.input && signal,
    ),
    true,
  );
  manager.dispose();
});

test('preserves Worktree domain failures and Connection failures as browser-safe errors', async () => {
  const domainFailure = createWorktreeConnectionAdapter({
    async call() {
      return {
        ok: true,
        value: {
          ok: false,
          error: {
            code: 'SIDECAR_UNAVAILABLE',
            message: 'sidecar unavailable',
            details: { workspaceId: 'ws_example' },
          },
        },
      };
    },
  });
  await assert.rejects(
    domainFailure.listWorktrees({ workspaceId: 'ws_example' }),
    (error) =>
      error instanceof WorktreeConnectionError &&
      error.code === 'SIDECAR_UNAVAILABLE' &&
      error.details.workspaceId === 'ws_example' &&
      error.retryable === false,
  );

  const connectionFailure = createWorktreeConnectionAdapter({
    async call() {
      return {
        ok: false,
        error: { code: 'internal', message: 'gateway failed', details: {} },
      };
    },
  });
  await assert.rejects(
    connectionFailure.listWorktrees({ workspaceId: 'ws_example' }),
    (error) =>
      error instanceof WorktreeConnectionError &&
      error.code === 'internal' &&
      error.retryable === true &&
      error.message.includes('gateway failed'),
  );
});
