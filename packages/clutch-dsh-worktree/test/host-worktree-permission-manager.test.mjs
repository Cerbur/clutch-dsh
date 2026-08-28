import assert from 'node:assert/strict';
import test from 'node:test';

import { createWorktreePermissionManager } from '../lib/host/worktree-permission-manager.js';

const worktree = {
  worktreeId: 'worktree-one',
  workspaceId: 'workspace-one',
  absolutePath: '/tmp/worktree-one',
  branch: 'feature/one',
  source: 'plugin',
  status: 'active',
  health: 'ready',
};

const binding = {
  workspaceId: 'workspace-one',
  worktreeId: 'worktree-one',
  sessionId: 'session-one',
  status: 'active',
};

function createFixture(overrides = {}) {
  const calls = [];
  return {
    calls,
    manager: {
      async listWorktrees() {
        return [worktree];
      },
      async listBindings() {
        return [binding];
      },
    },
    dsh: {
      async getWorkspace() {
        return { workspaceId: 'workspace-one', rootPath: '/tmp/repository' };
      },
      async getSession() {
        return {
          sessionId: 'session-one',
          workspaceId: 'workspace-one',
          cwd: '/tmp/worktree-one',
        };
      },
      async listSessions() {
        return [];
      },
    },
    permissions: {
      async ensure(input) {
        calls.push(input);
        return {
          status: 'full-applied',
          preset: 'worktree-full-access',
          sandboxMode: 'danger-full-access',
          approvalPolicy: 'ask',
          retryable: false,
        };
      },
      async normalize() {
        throw new Error('not used');
      },
    },
    ...overrides,
  };
}

const request = {
  workspaceId: 'workspace-one',
  worktreeId: 'worktree-one',
  sessionId: 'session-one',
  confirmed: true,
};

test('validates the active Worktree binding before delegating permission changes', async () => {
  const fixture = createFixture();
  const permissions = createWorktreePermissionManager(fixture);

  assert.deepEqual(await permissions.ensureWorktreePermission(request), {
    status: 'full-applied',
    preset: 'worktree-full-access',
    sandboxMode: 'danger-full-access',
    approvalPolicy: 'ask',
    retryable: false,
  });
  assert.deepEqual(fixture.calls, [{ ...request, binding: 'active' }]);
});

test('rejects permission changes when the Session is not actively attached to the Worktree', async () => {
  const fixture = createFixture({
    manager: {
      async listWorktrees() {
        return [worktree];
      },
      async listBindings() {
        return [];
      },
    },
  });
  const permissions = createWorktreePermissionManager(fixture);

  await assert.rejects(
    permissions.ensureWorktreePermission(request),
    (error) => {
      assert.equal(error.code, 'WORKTREE_PERMISSION_BINDING_REQUIRED');
      return true;
    },
  );
  assert.deepEqual(fixture.calls, []);
});

test('returns an unverified result when the optional permission adapter is unavailable', async () => {
  const fixture = createFixture({ permissions: undefined });
  const permissions = createWorktreePermissionManager(fixture);

  assert.deepEqual(await permissions.ensureWorktreePermission(request), {
    status: 'unverified',
    retryable: true,
  });
});

test('normalizes every detached Session after a Worktree is removed', async () => {
  const calls = [];
  const fixture = createFixture({
    manager: {
      async listWorktrees() {
        return [{ ...worktree, status: 'removed', health: 'repair' }];
      },
      async listBindings() {
        return [{ ...binding, status: 'detached' }, {
          ...binding,
          sessionId: 'session-two',
          status: 'detached',
        }];
      },
    },
    permissions: {
      async normalize(input) {
        calls.push(input);
        return { status: 'normalized-workspace-write', retryable: false };
      },
    },
  });
  const permissions = createWorktreePermissionManager(fixture);

  assert.deepEqual(
    await permissions.normalizeDetachedWorktreePermissions({
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
    }),
    {
      status: 'normalized-workspace-write',
      sessionIds: ['session-one', 'session-two'],
      retryable: false,
    },
  );
  assert.deepEqual(calls, [
    {
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      sessionId: 'session-one',
      binding: 'detached',
    },
    {
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
      sessionId: 'session-two',
      binding: 'detached',
    },
  ]);
});

test('reports detached permission state as unverified when the optional adapter is unavailable', async () => {
  const fixture = createFixture({
    manager: {
      async listWorktrees() {
        return [{ ...worktree, status: 'removed', health: 'repair' }];
      },
      async listBindings() {
        return [{ ...binding, status: 'detached' }];
      },
    },
    permissions: undefined,
  });
  const permissions = createWorktreePermissionManager(fixture);

  assert.deepEqual(
    await permissions.normalizeDetachedWorktreePermissions({
      workspaceId: 'workspace-one',
      worktreeId: 'worktree-one',
    }),
    {
      status: 'unverified',
      sessionIds: ['session-one'],
      retryable: true,
    },
  );
});
