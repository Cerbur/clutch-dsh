import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorktreeRemoteProjection } from '../lib/host/remote.js';
import {
  WORKTREE_CONNECTION_ENDPOINTS,
  createWorktreeConnectionAdapter,
} from '../lib/client/worktree-connection.js';

const input = {
  workspaceId: 'workspace-one',
  worktreeId: 'worktree-one',
  sessionId: 'session-one',
  confirmed: true,
};

const permission = {
  status: 'full-applied',
  preset: 'worktree-full-access',
  sandboxMode: 'danger-full-access',
  approvalPolicy: 'ask',
  retryable: false,
};

test('projects the Worktree permission operation through the Host Remote', async () => {
  const remote = createWorktreeRemoteProjection({}, {
    async ensureWorktreePermission(request) {
      assert.deepEqual(request, input);
      return permission;
    },
    async normalizeDetachedWorktreePermissions(request) {
      assert.deepEqual(request, {
        workspaceId: input.workspaceId,
        worktreeId: input.worktreeId,
      });
      return { status: 'normalized-workspace-write', sessionIds: [input.sessionId], retryable: false };
    },
  });

  assert.deepEqual(await remote.ensureWorktreePermission(input), {
    ok: true,
    value: permission,
  });
  assert.deepEqual(await remote.normalizeDetachedWorktreePermissions({
    workspaceId: input.workspaceId,
    worktreeId: input.worktreeId,
  }), {
    ok: true,
    value: {
      status: 'normalized-workspace-write',
      sessionIds: [input.sessionId],
      retryable: false,
    },
  });
});

test('routes Worktree permission through the shared /api Connection endpoint', async () => {
  const calls = [];
  const adapter = createWorktreeConnectionAdapter({
    async call(channel, endpoint, payload, signal) {
      calls.push({ channel, endpoint, payload, signal });
      return { ok: true, value: { ok: true, value: permission } };
    },
  });

  assert.deepEqual(await adapter.ensureWorktreePermission(input), permission);
  assert.deepEqual(
    await adapter.normalizeDetachedWorktreePermissions({
      workspaceId: input.workspaceId,
      worktreeId: input.worktreeId,
    }),
    permission,
  );
  assert.deepEqual(calls.map(({ channel, endpoint, payload }) => ({
    channel,
    endpoint,
    payload,
  })), [
    {
      channel: '/api',
      endpoint: 'worktreeManager/ensureWorktreePermission',
      payload: { args: { input } },
    },
    {
      channel: '/api',
      endpoint: 'worktreeManager/normalizeDetachedWorktreePermissions',
      payload: {
        args: {
          input: {
            workspaceId: input.workspaceId,
            worktreeId: input.worktreeId,
          },
        },
      },
    },
  ]);
  assert.equal(
    WORKTREE_CONNECTION_ENDPOINTS.ensureWorktreePermission,
    'worktreeManager/ensureWorktreePermission',
  );
  assert.equal(
    WORKTREE_CONNECTION_ENDPOINTS.normalizeDetachedWorktreePermissions,
    'worktreeManager/normalizeDetachedWorktreePermissions',
  );
  adapter.dispose();
});
