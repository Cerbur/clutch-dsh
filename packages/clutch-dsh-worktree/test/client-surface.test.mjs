import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  executeWorktreeAction,
  loadWorktreeView,
  toWorktreeViewError,
} from '../lib/client/worktree-view.js';

function manager(overrides = {}) {
  return {
    async listWorktrees() {
      return [
        {
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          absolutePath: '/tmp/wt1',
          branch: 'main',
          status: 'active',
        },
      ];
    },
    async listBranches() {
      return [{ name: 'main', isCurrent: true, checkedOut: true }];
    },
    async listBindings() {
      return [{ workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1', status: 'active' }];
    },
    async createWorktree(input) {
      return {
        worktreeId: 'created',
        ...input,
        workspaceId: 'ws1',
        absolutePath: '/tmp/created',
        status: 'active',
      };
    },
    async removeWorktree() {},
    async bindSession(input) {
      return { ...input, status: 'active' };
    },
    ...overrides,
  };
}

test('loads Worktree, branch, and binding projection through the Manager contract', async () => {
  const calls = [];
  const data = await loadWorktreeView(
    manager({
      async listWorktrees(input) {
        calls.push(['listWorktrees', input]);
        return [];
      },
      async listBranches(input) {
        calls.push(['listBranches', input]);
        return [];
      },
      async listBindings(input) {
        calls.push(['listBindings', input]);
        return [];
      },
    }),
    'ws1',
  );

  assert.deepEqual(data, { worktrees: [], branches: [], bindings: [] });
  assert.deepEqual(calls, [
    ['listWorktrees', { workspaceId: 'ws1' }],
    ['listBranches', { workspaceId: 'ws1' }],
    ['listBindings', { workspaceId: 'ws1' }],
  ]);
});

test('preserves an endpoint failure as an explicit retryable view error', async () => {
  const failure = {
    code: 'method-unavailable',
    message: 'Worktree endpoint worktreeManager/listWorktrees is unavailable; retry the request.',
    details: { endpoint: 'worktreeManager/listWorktrees' },
    retryable: true,
  };
  await assert.rejects(
    loadWorktreeView(
      manager({
        async listWorktrees() {
          throw failure;
        },
      }),
      'ws1',
    ),
    failure,
  );
  assert.deepEqual(toWorktreeViewError(failure), {
    code: failure.code,
    message: failure.message,
    retryable: true,
  });
});

test('executes create, remove, and bind actions through the Manager contract', async () => {
  const calls = [];
  const worktreeManager = manager({
    async createWorktree(input) {
      calls.push(['createWorktree', input]);
      return manager().createWorktree(input);
    },
    async removeWorktree(input) {
      calls.push(['removeWorktree', input]);
    },
    async bindSession(input) {
      calls.push(['bindSession', input]);
      return manager().bindSession(input);
    },
  });

  await executeWorktreeAction(worktreeManager, {
    type: 'createWorktree',
    input: { workspaceId: 'ws1', branch: 'feature/login' },
  });
  await executeWorktreeAction(worktreeManager, {
    type: 'removeWorktree',
    input: { workspaceId: 'ws1', worktreeId: 'wt1' },
  });
  await executeWorktreeAction(worktreeManager, {
    type: 'bindSession',
    input: { workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1' },
  });

  assert.deepEqual(calls, [
    ['createWorktree', { workspaceId: 'ws1', branch: 'feature/login' }],
    ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1' }],
    ['bindSession', { workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1' }],
  ]);
});

test('renders a retry surface instead of treating Worktree failures as an empty list', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /data-worktree-error/);
  assert.match(source, />\s*Retry\s*<\/button>/);
  assert.match(source, /status === 'error'/);
  assert.match(source, /executeWorktreeAction/);
});
