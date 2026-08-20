import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createDefaultWorktreeName,
  executeWorktreeAction,
  loadWorktreeView,
  loadWorktreeViews,
  selectDefaultBaseBranch,
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
        workspaceId: 'ws1',
        branch: input.newBranch ?? input.branch,
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

test('selects the current local branch as the default Worktree base branch', () => {
  assert.equal(
    selectDefaultBaseBranch([
      { name: 'feature/other', isCurrent: false, checkedOut: false },
      { name: 'main', isCurrent: true, checkedOut: true },
    ]),
    'main',
  );
  assert.equal(
    selectDefaultBaseBranch([
      { name: 'feature/other', isCurrent: false, checkedOut: false },
    ]),
    'feature/other',
  );
  assert.equal(selectDefaultBaseBranch([]), '');
});

test('generates an available dsh Worktree name and rolls after a collision', () => {
  const generated = [];
  const candidates = [
    '12345678-aaaa-bbbb-cccc-000000000000',
    '87654321-aaaa-bbbb-cccc-000000000000',
  ];
  const name = createDefaultWorktreeName(
    ['dsh/12345678', 'main'],
    () => {
      generated.push(candidates.shift());
      return generated.at(-1);
    },
  );

  assert.equal(name, 'dsh/87654321');
  assert.equal(generated.length, 2);
});

test('loads independent Worktree projections for every Workspace', async () => {
  const calls = [];
  const data = await loadWorktreeViews(
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
    ['ws1', 'ws2'],
  );

  assert.deepEqual(data, [
    { workspaceId: 'ws1', worktrees: [], branches: [], bindings: [] },
    { workspaceId: 'ws2', worktrees: [], branches: [], bindings: [] },
  ]);
  assert.deepEqual(calls, [
    ['listWorktrees', { workspaceId: 'ws1' }],
    ['listBranches', { workspaceId: 'ws1' }],
    ['listBindings', { workspaceId: 'ws1' }],
    ['listWorktrees', { workspaceId: 'ws2' }],
    ['listBranches', { workspaceId: 'ws2' }],
    ['listBindings', { workspaceId: 'ws2' }],
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

test('executes create and remove actions through the Manager contract', async () => {
  const calls = [];
  const worktreeManager = manager({
    async createWorktree(input) {
      calls.push(['createWorktree', input]);
      return manager().createWorktree(input);
    },
    async removeWorktree(input) {
      calls.push(['removeWorktree', input]);
    },
  });

  const created = await executeWorktreeAction(worktreeManager, {
    type: 'createWorktree',
    input: { workspaceId: 'ws1', branch: 'main', newBranch: 'dsh/12345678' },
  });
  await executeWorktreeAction(worktreeManager, {
    type: 'removeWorktree',
    input: { workspaceId: 'ws1', worktreeId: 'wt1' },
  });
  assert.deepEqual(calls, [
    ['createWorktree', { workspaceId: 'ws1', branch: 'main', newBranch: 'dsh/12345678' }],
    ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1' }],
  ]);
  assert.deepEqual(created, {
    worktreeId: 'created',
    workspaceId: 'ws1',
    branch: 'dsh/12345678',
    absolutePath: '/tmp/created',
    status: 'active',
  });
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

test('renders the Worktree hierarchy with search and nested creation affordances', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /Bind current Session/);
  assert.match(source, /Search Workspaces and Sessions/);
  assert.match(source, /data-workspace-id/);
  assert.match(source, /data-add-worktree/);
  assert.match(source, /data-add-session/);
  assert.match(source, /createWorkspace/);
  assert.match(source, /createSessionForWorktree/);
  assert.match(source, /Retry Binding/);
  assert.match(source, /Open Created Session/);
  assert.match(source, /Remove Worktree/);
  assert.match(source, /detached bindings/);
});

test('creates a Worktree Session immediately after creating the Worktree', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /const createdWorktree = await executeWorktreeAction/);
  assert.match(source, /await createSessionCallback\(sessionInput\)/);
  assert.match(source, /worktreeId: createdWorktree\.worktreeId/);
  assert.match(source, /cwd: createdWorktree\.absolutePath/);
  assert.match(source, /Worktree name/);
  assert.match(source, /dsh\//);
});

test('renders a Main Session action alongside the Main group label', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /createMainSession/);
  assert.match(source, /data-add-main-session/);
});
