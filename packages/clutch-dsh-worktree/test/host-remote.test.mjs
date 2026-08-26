import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorktreeRemoteProjection } from '../lib/host/remote.js';

function createManager(overrides = {}) {
  return {
    async listWorktrees() {
      return [];
    },
    async listBranches() {
      return [];
    },
    async createWorktree(input) {
      return {
        worktreeId: 'wt_example',
        workspaceId: input.workspaceId,
        absolutePath: '/tmp/dsh/worktree/wt_example',
        branch: input.branch,
        source: 'plugin',
        status: 'active',
      };
    },
    async listImportCandidates() {
      return [];
    },
    async importWorktree(input) {
      return {
        worktreeId: 'wt_external',
        workspaceId: input.workspaceId,
        absolutePath: input.absolutePath,
        branch: 'feature/external',
        source: 'external',
        status: 'active',
      };
    },
    async removeWorktree() {},
    async insertWorktreeBefore() {
      return ['wt_example'];
    },
    async listBindings() {
      return [];
    },
    async bindSession(input) {
      return { ...input, status: 'active' };
    },
    async resolveRuntimeCwd() {
      return '/tmp/dsh/worktree/wt_example';
    },
    ...overrides,
  };
}

test('projects every approved Manager operation as a serializable result', async () => {
  const remote = createWorktreeRemoteProjection(createManager());

  assert.deepEqual(await remote.listWorktrees({ workspaceId: 'ws_example' }), {
    ok: true,
    value: [],
  });
  assert.deepEqual(await remote.listBranches({ workspaceId: 'ws_example' }), {
    ok: true,
    value: [],
  });
  assert.deepEqual(await remote.listImportCandidates({ workspaceId: 'ws_example' }), {
    ok: true,
    value: [],
  });
  assert.deepEqual(
    await remote.createWorktree({ workspaceId: 'ws_example', branch: 'feature/example' }),
    {
      ok: true,
      value: {
        worktreeId: 'wt_example',
        workspaceId: 'ws_example',
        absolutePath: '/tmp/dsh/worktree/wt_example',
        branch: 'feature/example',
        source: 'plugin',
        status: 'active',
      },
    },
  );
  assert.deepEqual(
    await remote.importWorktree({ workspaceId: 'ws_example', absolutePath: '/tmp/external' }),
    {
      ok: true,
      value: {
        worktreeId: 'wt_external',
        workspaceId: 'ws_example',
        absolutePath: '/tmp/external',
        branch: 'feature/external',
        source: 'external',
        status: 'active',
      },
    },
  );
  assert.deepEqual(
    await remote.removeWorktree({ workspaceId: 'ws_example', worktreeId: 'wt_example' }),
    { ok: true, value: null },
  );
  assert.deepEqual(
    await remote.insertWorktreeBefore({
      workspaceId: 'ws_example',
      worktreeId: 'wt_example',
    }),
    { ok: true, value: ['wt_example'] },
  );
  assert.deepEqual(await remote.listBindings({ workspaceId: 'ws_example' }), {
    ok: true,
    value: [],
  });
  assert.deepEqual(
    await remote.bindSession({
      workspaceId: 'ws_example',
      worktreeId: 'wt_example',
      sessionId: 'session_example',
    }),
    {
      ok: true,
      value: {
        workspaceId: 'ws_example',
        worktreeId: 'wt_example',
        sessionId: 'session_example',
        status: 'active',
      },
    },
  );
  assert.equal('resolveRuntimeCwd' in remote, false);
});

test('serializes stable Worktree failures without importing Provider internals', async () => {
  const remote = createWorktreeRemoteProjection(
    createManager({
      async listWorktrees() {
        throw {
          code: 'SIDECAR_UNAVAILABLE',
          message: 'sidecar unavailable',
          details: { workspaceId: 'ws_example' },
        };
      },
    }),
  );

  assert.deepEqual(await remote.listWorktrees({ workspaceId: 'ws_example' }), {
    ok: false,
    error: {
      code: 'SIDECAR_UNAVAILABLE',
      message: 'sidecar unavailable',
      details: { workspaceId: 'ws_example' },
    },
  });
});

test('leaves unexpected Host failures for the DSH Gateway to classify', async () => {
  const failure = new Error('unexpected failure');
  const remote = createWorktreeRemoteProjection(
    createManager({
      async listWorktrees() {
        throw failure;
      },
    }),
  );

  await assert.rejects(remote.listWorktrees({ workspaceId: 'ws_example' }), failure);
});

test('projects transient Worktree health as plain JSON', async () => {
  const remote = createWorktreeRemoteProjection(
    createManager({
      async listWorktrees() {
        return [{
          worktreeId: 'wt_health',
          workspaceId: 'ws_example',
          absolutePath: '/tmp/dsh/worktree/wt_health',
          branch: 'feature/health',
          status: 'active',
          health: 'repair',
        }];
      },
    }),
  );

  const result = await remote.listWorktrees({ workspaceId: 'ws_example' });
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.getPrototypeOf(result.value[0]), Object.prototype);
});
