import assert from 'node:assert/strict';
import test from 'node:test';

import { WORKTREE_REMOTE_METHODS } from '../lib/contract/index.js';
import {
  WorktreeRemoteCallError,
  createWorktreeManagerFacade,
} from '../lib/client/index.js';

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

test('adapts the mounted DSH Remote namespace to the WorktreeManager contract', async () => {
  const calls = [];
  const remote = {
    async listWorktrees(input) {
      calls.push(['listWorktrees', input]);
      return { ok: true, value: { ok: true, value: [worktree] } };
    },
    async listBranches(input) {
      calls.push(['listBranches', input]);
      return { ok: true, value: { ok: true, value: [] } };
    },
    async createWorktree(input) {
      calls.push(['createWorktree', input]);
      return { ok: true, value: { ok: true, value: worktree } };
    },
    async removeWorktree(input) {
      calls.push(['removeWorktree', input]);
      return { ok: true, value: { ok: true, value: null } };
    },
    async listBindings(input) {
      calls.push(['listBindings', input]);
      return { ok: true, value: { ok: true, value: [] } };
    },
    async bindSession(input) {
      calls.push(['bindSession', input]);
      return {
        ok: true,
        value: {
          ok: true,
          value: {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
            sessionId: input.sessionId,
            status: 'active',
          },
        },
      };
    },
  };
  const manager = createWorktreeManagerFacade(remote);

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
  assert.deepEqual(calls, [
    ['listWorktrees', { workspaceId: 'ws_example' }],
    ['listBranches', { workspaceId: 'ws_example' }],
    ['createWorktree', { workspaceId: 'ws_example', branch: 'feature/example' }],
    ['removeWorktree', { workspaceId: 'ws_example', worktreeId: 'wt_example' }],
    ['listBindings', { workspaceId: 'ws_example' }],
    [
      'bindSession',
      {
        workspaceId: 'ws_example',
        worktreeId: 'wt_example',
        sessionId: 'session_example',
      },
    ],
  ]);
});

test('preserves domain failures and carrier failures as browser-safe errors', async () => {
  const domainFailure = createWorktreeManagerFacade({
    async listWorktrees() {
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
      error instanceof WorktreeRemoteCallError &&
      error.code === 'SIDECAR_UNAVAILABLE' &&
      error.details.workspaceId === 'ws_example',
  );

  const carrierFailure = createWorktreeManagerFacade({
    async listWorktrees() {
      return {
        ok: false,
        error: { code: 'internal', message: 'gateway failed', details: {} },
      };
    },
  });
  await assert.rejects(
    carrierFailure.listWorktrees({ workspaceId: 'ws_example' }),
    (error) =>
      error instanceof WorktreeRemoteCallError &&
      error.code === 'internal' &&
      error.message === 'gateway failed',
  );
});
