import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createDefaultWorktreeName,
  executeWorktreeAction,
  loadWorktreeView,
  loadWorktreeViews,
  reconcileBaseBranchSelection,
  selectDefaultBaseBranch,
  toWorktreeViewError,
  worktreeSetupCommands,
} from '../lib/client/worktree-view.js';
import * as worktreeView from '../lib/client/worktree-view.js';

test('documents persistent Worktree ordering and fixed Main behavior', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const readmeZh = await readFile(new URL('../README.zh.md', import.meta.url), 'utf8');
  const clientReadme = await readFile(
    new URL('../src/client/README.md', import.meta.url),
    'utf8',
  );

  assert.match(readme, /Worktree.*排序|Worktree.*order/i);
  assert.match(readme, /Main.*固定|Main.*fixed/i);
  assert.match(clientReadme, /persistent Worktree order|持久.*Worktree.*顺序/i);
  assert.match(clientReadme, /Main.*fixed|Main.*固定/i);
  assert.match(readme, /browser-local.*expansion|expansion.*browser-local/i);
  assert.match(readme, /Session.*overflow.*transient|Session.*five-row.*refresh/i);
  assert.match(readmeZh, /浏览器本地.*展开|展开.*浏览器本地/);
  assert.match(readmeZh, /Session.*临时|五行.*刷新/);
  assert.match(clientReadme, /browser-local.*expansion|浏览器本地.*展开/i);
  assert.ok(
    readme.includes(
      'Persist Workspace, Main, and Worktree expansion choices in browser-local storage; the five-row Session overflow state remains transient and resets after refresh or parent collapse.',
    ),
  );
  assert.ok(
    readmeZh.includes(
      '将 Workspace、Main 和 Worktree 的展开选择保存到浏览器本地存储；Session 五行溢出展开保持临时状态，并在刷新或父级折叠后重置。',
    ),
  );
  assert.ok(clientReadme.includes('clutch-dsh-worktree.expand-state'));
  assert.match(clientReadme, /Missing IDs are\s+expanded by default\./);
  assert.ok(
    /The five-row Session overflow control remains transient,/.test(clientReadme),
  );
  assert.ok(
    /and parent collapse clears its affected temporary group state\./.test(clientReadme),
  );
  assert.ok(
    /Storage failure\s+falls back to in-memory behavior and does not change DSH or sidecar data\./.test(
      clientReadme,
    ),
  );
});

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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function readSurfaceSources() {
  const [coordinator, rows, dialogs, types] = await Promise.all([
    readFile(new URL('../src/client/WorktreeSurface.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/client/worktree-surface-rows.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/client/worktree-surface-dialogs.tsx', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../src/client/worktree-surface-types.ts', import.meta.url),
      'utf8',
    ),
  ]);
  return {
    coordinator,
    rows,
    dialogs,
    types,
    combined: [coordinator, rows, dialogs, types].join('\n'),
  };
}

test('reuses the previous Workspace id array when a snapshot republishes the same ids', () => {
  const previous = ['ws1', 'ws2'];
  const next = ['ws1', 'ws2'];

  assert.equal(worktreeView.stableWorkspaceIds(previous, next), previous);
  assert.notEqual(worktreeView.stableWorkspaceIds(previous, ['ws2', 'ws1']), previous);
});

test('merges an on-demand Workspace view without dropping ready projections', () => {
  assert.equal(typeof worktreeView.mergeWorktreeView, 'function');
  const existing = {
    workspaceId: 'ws1',
    worktrees: [],
    branches: [{ name: 'main', isCurrent: true, checkedOut: true }],
    bindings: [],
    readiness: { status: 'ready' },
  };
  const imported = {
    workspaceId: 'ws2',
    worktrees: [],
    branches: [{ name: 'main', isCurrent: true, checkedOut: true }],
    bindings: [],
    readiness: { status: 'ready' },
  };

  assert.deepEqual(
    worktreeView.mergeWorktreeView([existing], imported),
    [existing, imported],
  );
  assert.deepEqual(
    worktreeView.mergeWorktreeView(
      [existing, imported],
      { ...imported, branches: [{ name: 'feature', isCurrent: true, checkedOut: true }] },
    ),
    [
      existing,
      {
        ...imported,
        branches: [{ name: 'feature', isCurrent: true, checkedOut: true }],
      },
    ],
  );
});

test('invalidates superseded Worktree refresh results', async () => {
  assert.equal(typeof worktreeView.createWorktreeRefreshGuard, 'function');
  const guard = worktreeView.createWorktreeRefreshGuard();
  const first = guard.begin();
  const second = guard.begin();

  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);

  guard.invalidate();
  assert.equal(guard.isCurrent(second), false);

  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const refreshStart = source.indexOf('const refresh = useCallback');
  const refreshEnd = source.indexOf('  useEffect(() => {', refreshStart);
  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /await refreshGuard\.current\.run\(/);
  assert.match(refreshSource, /if \(preserveCurrent\) throw error/);

  const modeEffectStart = source.indexOf('useEffect(() => {\n    if (mode === \'worktree\')');
  const modeEffectEnd = source.indexOf('  useEffect(() => {', modeEffectStart + 1);
  assert.notEqual(modeEffectStart, -1);
  assert.notEqual(modeEffectEnd, -1);
  assert.match(source.slice(modeEffectStart, modeEffectEnd), /refreshGuard\.current\.invalidate\(\)/);
});

test('drops stale asynchronous Worktree refresh success', async () => {
  const guard = worktreeView.createWorktreeRefreshGuard();
  const first = deferred();
  const second = deferred();
  const committed = [];
  const errors = [];

  const firstRun = guard.run(
    () => first.promise,
    (value) => committed.push(value),
    (error) => errors.push(error),
  );
  const secondRun = guard.run(
    () => second.promise,
    (value) => committed.push(value),
    (error) => errors.push(error),
  );
  const runs = Promise.all([firstRun, secondRun]);

  second.resolve('new');
  first.resolve('stale');
  await runs;

  assert.deepEqual(committed, ['new']);
  assert.deepEqual(errors, []);
});

test('drops stale asynchronous Worktree refresh rejection', async () => {
  const guard = worktreeView.createWorktreeRefreshGuard();
  const first = deferred();
  const second = deferred();
  const committed = [];
  const errors = [];

  const firstRun = guard.run(
    () => first.promise,
    (value) => committed.push(value),
    (error) => errors.push(error),
  );
  const secondRun = guard.run(
    () => second.promise,
    (value) => committed.push(value),
    (error) => errors.push(error),
  );
  const runs = Promise.all([firstRun, secondRun]);

  second.resolve('new');
  first.reject(new Error('stale'));
  await runs;

  assert.deepEqual(committed, ['new']);
  assert.deepEqual(errors, []);
});

test('loads and invalidates modal target projections independently', async () => {
  assert.equal(typeof worktreeView.createWorktreeModalViewLoader, 'function');
  const loader = worktreeView.createWorktreeModalViewLoader();
  const firstWorktrees = deferred();
  let listWorktrees = () => firstWorktrees.promise;
  const views = [];
  const errors = [];

  const staleLoad = loader.load(
    manager({ listWorktrees: (...args) => listWorktrees(...args) }),
    'ws-imported',
    (view) => views.push(view),
    (error) => errors.push(error),
  );
  loader.invalidate();
  firstWorktrees.resolve([]);
  await staleLoad;

  assert.deepEqual(views, []);
  assert.deepEqual(errors, []);

  const failedWorktrees = deferred();
  listWorktrees = () => failedWorktrees.promise;
  const failedLoad = loader.load(
    manager({ listWorktrees: (...args) => listWorktrees(...args) }),
    'ws-imported',
    (view) => views.push(view),
    (error) => errors.push(error),
  );
  failedWorktrees.reject({
    code: 'CONNECTION_CALL_FAILED',
    message: 'connection unavailable',
    retryable: true,
  });
  await failedLoad;

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'CONNECTION_CALL_FAILED');

  listWorktrees = async () => [];
  await loader.load(
    manager({ listWorktrees: (...args) => listWorktrees(...args) }),
    'ws-imported',
    (view) => views.push(view),
    (error) => errors.push(error),
  );

  assert.equal(views.length, 1);
  assert.equal(views[0].workspaceId, 'ws-imported');
  assert.equal(views[0].readiness.status, 'ready');
  assert.equal(errors.length, 1);

  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /const refreshGuard = useRef\(createWorktreeRefreshGuard\(\)\);/);
  assert.match(source, /const modalReadLoader = useRef\(createWorktreeModalViewLoader\(\)\);/);
  assert.match(source, /modalReadLoader\.current\.load/);
});

test('preserves other Workspace projections when modal and full refresh complete out of order', async () => {
  const modalWorktrees = deferred();
  const modalRecord = {
    worktreeId: 'modal-wt',
    workspaceId: 'ws2',
    absolutePath: '/tmp/modal-wt',
    branch: 'modal-branch',
    status: 'active',
  };
  const fullRecord = {
    worktreeId: 'full-wt',
    workspaceId: 'ws2',
    absolutePath: '/tmp/full-wt',
    branch: 'full-branch',
    status: 'active',
  };
  let ws2ReadCount = 0;
  const readManager = manager({
    async listWorktrees({ workspaceId }) {
      if (workspaceId === 'ws1') return [];
      ws2ReadCount += 1;
      return ws2ReadCount === 1 ? modalWorktrees.promise : [fullRecord];
    },
    async listBindings() {
      return [];
    },
  });
  const modalLoader = worktreeView.createWorktreeModalViewLoader();
  const refreshGuard = worktreeView.createWorktreeRefreshGuard();
  let modalView;
  let state = {
    status: 'ready',
    views: [{
      workspaceId: 'ws1',
      worktrees: [],
      branches: [{ name: 'main', isCurrent: true, checkedOut: true }],
      bindings: [],
      readiness: { status: 'ready' },
    }],
  };

  const modalRun = modalLoader.load(
    readManager,
    'ws2',
    (view) => {
      modalView = view;
      state = { ...state, views: worktreeView.mergeWorktreeView(state.views, view) };
    },
    (error) => {
      throw error;
    },
  );
  const refreshRun = refreshGuard.run(
    () => worktreeView.loadWorktreeViews(readManager, ['ws1', 'ws2'], { invalidateContext: false }),
    (views) => {
      state = {
        status: 'ready',
        views: modalView === undefined
          ? views
          : worktreeView.mergeWorktreeView(views, modalView),
      };
    },
    (error) => {
      throw error;
    },
  );

  await refreshRun;
  modalWorktrees.resolve([modalRecord]);
  await modalRun;

  assert.equal(state.status, 'ready');
  assert.deepEqual(state.views.map((view) => view.workspaceId), ['ws1', 'ws2']);
  assert.equal(state.views[1].worktrees[0].worktreeId, 'modal-wt');
});

test('preserves a ready Worktree projection during automatic refreshes', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /const readStateRef = useRef\(readState\)/);

  const effectStart = source.indexOf('useEffect(() => {\n    if (mode === \'worktree\')');
  const effectEnd = source.indexOf('  useEffect(() => {', effectStart + 1);
  assert.notEqual(effectStart, -1);
  assert.notEqual(effectEnd, -1);
  const effectSource = source.slice(effectStart, effectEnd);
  assert.match(
    effectSource,
    /void refresh\(\{ preserveCurrent: readStateRef\.current\.status === 'ready' \}\);/,
  );
});

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

  assert.deepEqual(data, {
    worktrees: [],
    branches: [],
    bindings: [],
    readiness: { status: 'noLocalBranch' },
  });
  assert.deepEqual(calls, [
    ['listWorktrees', { workspaceId: 'ws1' }],
    ['listBranches', { workspaceId: 'ws1' }],
    ['listBindings', { workspaceId: 'ws1' }],
  ]);
});

test('filters archived Session ids without changing order or inputs', () => {
  assert.equal(typeof worktreeView.filterArchivedSessionIds, 'function');
  const sessionIds = ['main', 'archived', 'bound'];
  const archivedSessionIds = ['archived', 'unknown'];
  assert.deepEqual(
    worktreeView.filterArchivedSessionIds(sessionIds, archivedSessionIds),
    ['main', 'bound'],
  );
  assert.deepEqual(sessionIds, ['main', 'archived', 'bound']);
  assert.deepEqual(archivedSessionIds, ['archived', 'unknown']);
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

test('maps a non-Git branch-list failure to Workspace-local readiness', async () => {
  const data = await loadWorktreeView(
    manager({
      async listWorktrees() {
        return [{
          worktreeId: 'wt1',
          workspaceId: 'ws1',
          absolutePath: '/tmp/wt1',
          branch: 'main',
          status: 'active',
        }];
      },
      async listBranches() {
        throw {
          code: 'WORKSPACE_NOT_GIT_REPOSITORY',
          message: 'Workspace is not a Git repository.',
          details: {},
        };
      },
      async listBindings() {
        return [{ workspaceId: 'ws1', worktreeId: 'wt1', sessionId: 's1', status: 'active' }];
      },
    }),
    'ws1',
  );

  assert.equal(data.readiness.status, 'noRepository');
  assert.equal(data.worktrees.length, 1);
  assert.equal(data.bindings.length, 1);
});

test('maps a missing Git executable to Workspace-local readiness without setup commands', async () => {
  const data = await loadWorktreeView(
    manager({
      async listBranches() {
        throw {
          code: 'GIT_NOT_INSTALLED',
          message: 'Git is not installed or is not available on PATH.',
          details: { gitExitCode: 'ENOENT' },
        };
      },
    }),
    'ws1',
  );

  assert.equal(data.readiness.status, 'gitNotInstalled');
  assert.equal(data.worktrees.length, 1);
  assert.equal(data.bindings.length, 1);
  assert.deepEqual(worktreeSetupCommands('gitNotInstalled'), []);
});

test('maps a no-initial-commit branch-list failure to setup readiness', async () => {
  const data = await loadWorktreeView(
    manager({
      async listBranches() {
        throw {
          code: 'WORKTREE_REQUIRES_INITIAL_COMMIT',
          message: 'Workspace has no initial commit.',
          details: {},
        };
      },
    }),
    'ws1',
  );

  assert.equal(data.readiness.status, 'noInitialCommit');
  assert.deepEqual(data.branches, []);
});

test('does not hide unknown branch-list failures as an empty branch state', async () => {
  await assert.rejects(
    loadWorktreeView(
      manager({
        async listBranches() {
          throw { code: 'CONNECTION_CALL_FAILED', message: 'connection lost', details: {} };
        },
      }),
      'ws1',
    ),
    (error) => error?.message === 'connection lost',
  );
});

test('selects the current branch and preserves a valid user selection', () => {
  const branches = [
    { name: 'feature/other', isCurrent: false, checkedOut: false },
    { name: 'main', isCurrent: true, checkedOut: true },
  ];

  assert.equal(reconcileBaseBranchSelection('', branches), 'main');
  assert.equal(reconcileBaseBranchSelection('feature/other', branches), 'feature/other');
  assert.equal(reconcileBaseBranchSelection('removed', branches), 'main');
  assert.equal(reconcileBaseBranchSelection('', []), '');
});

test('returns setup commands for each Git readiness state', () => {
  assert.deepEqual(worktreeSetupCommands('noRepository'), [
    'git init',
    'printf "# README\\n" > README.md',
    'git add README.md',
    'git commit -m "Initial commit"',
  ]);
  assert.deepEqual(worktreeSetupCommands('noInitialCommit'), [
    'printf "# README\\n" > README.md',
    'git add README.md',
    'git commit -m "Initial commit"',
  ]);
  assert.deepEqual(worktreeSetupCommands('noLocalBranch'), ['git switch -c main']);
  assert.deepEqual(worktreeSetupCommands('gitNotInstalled'), []);
  assert.deepEqual(worktreeSetupCommands('ready'), []);
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
    {
      workspaceId: 'ws1',
      worktrees: [],
      branches: [],
      bindings: [],
      readiness: { status: 'noLocalBranch' },
    },
    {
      workspaceId: 'ws2',
      worktrees: [],
      branches: [],
      bindings: [],
      readiness: { status: 'noLocalBranch' },
    },
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
    details: failure.details,
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
  assert.match(source, /t\('action\.retry'\)/);
  assert.match(source, /status === 'error'/);
  assert.match(source, /executeWorktreeAction/);
});

test('declares the Worktree locale seat and routes visible copy through t', async () => {
  const actionSource = await readFile(
    new URL('../src/client/WorktreeModeAction.tsx', import.meta.url),
    'utf8',
  );
  const surfaceSource = (await readSurfaceSources()).combined;

  assert.match(actionSource, /PropsLocale/);
  assert.match(surfaceSource, /PropsLocale/);
  assert.match(surfaceSource, /WORKTREE_NS/);
  assert.match(surfaceSource, /formatWorktreeViewError/);
  assert.match(surfaceSource, /t\('workspace\.search'\)/);
  assert.match(surfaceSource, /t\('session\.expandMore'/);
  assert.match(surfaceSource, /t\('dialog\.closeWorkspaceDelete'\)/);
  assert.doesNotMatch(surfaceSource, /Search Workspaces and Sessions/);
  assert.doesNotMatch(surfaceSource, /Retry Binding/);
  assert.doesNotMatch(surfaceSource, /No matching Workspaces/);
  assert.match(surfaceSource, /sidebar-overlay-geometry/);
});

test('formats Worktree view errors at render time and leaves plugin literals out of state', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /import \{ formatWorktreeViewError \}/);
  assert.match(source, /\{formatWorktreeViewError\(actionError, t\)\}/);
  assert.match(source, /\{formatWorktreeViewError\(readState\.error, t\)\}/);
  assert.match(source, /code: 'WORKTREE_CREATED_SESSION_UNAVAILABLE'/);
  assert.match(source, /code: 'WORKTREE_RECORD_MISSING'/);
  assert.doesNotMatch(source, /message: t\('error\.workspaceOrderingUnavailable'\)/);
  assert.doesNotMatch(source, /message: t\('error\.sessionOrderingUnavailable'\)/);
  assert.doesNotMatch(source, /message: t\('error\.worktreeCreatedSessionUnavailable'\)/);
  assert.doesNotMatch(source, /message: t\('error\.sessionCreationUnavailable'\)/);
  assert.doesNotMatch(source, /throw new Error\(t\('error\.worktreeRecordMissing'\)\)/);
  assert.match(source, /code: 'WORKSPACE_RENAME_UNAVAILABLE'/);
  assert.match(source, /code: 'WORKSPACE_DELETE_UNAVAILABLE'/);
  assert.match(source, /code: 'SESSION_RENAME_UNAVAILABLE'/);
  assert.match(source, /formatWorktreeViewError\(error, t\)/);
  assert.match(source, /WorktreeWorkspaceRenameDialog/);
  assert.match(source, /WorktreeWorkspaceDeleteDialog/);
  assert.match(source, /WorktreeSessionRenameDialog/);
});

test('renders the Worktree hierarchy with search and nested creation affordances', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.doesNotMatch(source, /Bind current Session/);
  assert.match(source, /t\('workspace\.search'\)/);
  assert.match(source, /data-workspace-id/);
  assert.match(source, /data-add-worktree/);
  assert.match(source, /data-add-session/);
  assert.match(source, /createWorkspace/);
  assert.match(source, /createSessionForWorktree/);
  assert.match(source, /t\('action\.retryBinding'\)/);
  assert.match(source, /t\('action\.openCreatedSession'\)/);
  assert.match(source, /t\('worktree\.remove'\)/);
  assert.match(source, /t\('worktree\.detached'\)/);
});

test('bounds the surface to live native sidebar anchors', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const geometrySource = await readFile(
    new URL('../src/client/sidebar-overlay-geometry.ts', import.meta.url),
    'utf8',
  );
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /useSidebarOverlayGeometry/);
  assert.match(geometrySource, /ResizeObserver/);
  assert.match(geometrySource, /MutationObserver/);
  assert.match(geometrySource, /requestAnimationFrame/);
  assert.match(geometrySource, /cancelAnimationFrame/);
  assert.doesNotMatch(styleSource, /\.surface \{[\s\S]*inset: 0 auto 0 0;/);
  assert.match(styleSource, /\.surface \{[\s\S]*top: 0;/);
  assert.match(
    styleSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.surface[\s\S]*transition: none;/,
  );
});

test('creates a Worktree Session immediately after creating the Worktree', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /const createdWorktree = await executeWorktreeAction/);
  assert.match(source, /await createSessionCallback\(sessionInput\)/);
  assert.match(source, /worktreeId: createdWorktree\.worktreeId/);
  assert.match(source, /cwd: createdWorktree\.absolutePath/);
  assert.match(source, /t\('worktree\.name'\)/);
  assert.match(source, /dsh\//);
});

test('renders a Main Session action alongside the Main group label', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /createMainSession/);
  assert.match(source, /data-add-main-session/);
});

test('uses native DSH menus for Session and Workspace row actions', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /from ['"]@deepseek-ai\/dsh-client-ui-primitives['"]/);
  assert.match(source, /\bMenu\b/);
  assert.match(source, /\bModal\b/);
  assert.match(source, /\bButton\b/);
  assert.match(source, /\bInput\b/);
  assert.match(source, /t\('session\.rename'\)/);
  assert.match(source, /t\('session\.fork'\)/);
  assert.match(source, /t\('session\.archive'\)/);
  assert.match(source, /t\('worktree\.remove'\)/);
  assert.match(source, /portal/);
  assert.match(source, /closeOnPointerLeave/);
  assert.match(source, /data-session-menu/);
  assert.match(source, /data-worktree-menu/);
  assert.doesNotMatch(
    source,
    /className=\{styles\.inlineButton\}[\s\S]*?>\s*Remove\s*</,
  );
});

test('matches native Workspace row actions and drag behavior', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /renameWorkspace/);
  assert.match(source, /deleteWorkspace/);
  assert.match(source, /insertWorkspaceBefore/);
  assert.match(source, /draggable/);
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /t\('workspace\.rename'\)/);
  assert.match(source, /t\('workspace\.delete'\)/);
  assert.match(source, /data-workspace-drag/);
});

test('matches native Session grouping, drag, and expand-more behavior', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /insertSessionBefore/);
  assert.match(source, /draggable/);
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /t\('session\.expandMore'/);
  assert.match(source, /t\('session\.collapse'\)/);
  assert.match(source, /expandedSessionGroups/);
  assert.match(source, /slice\(0, 5\)/);
  assert.doesNotMatch(
    source,
    /status=\{record\.status === 'active' \? 'bound' : 'detached'\}/,
  );
});

test('matches native Worktree drag ordering while keeping Main fixed', async () => {
  const source = (await readSurfaceSources()).combined;
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /insertWorktreeBefore/);
  assert.match(source, /resolveWorktreeMove/);
  assert.match(source, /interface WorktreeDragState/);
  assert.match(source, /data-worktree-drag/);
  assert.match(source, /onDragStart/);
  assert.match(source, /onDragOver/);
  assert.match(source, /onDrop/);
  assert.match(source, /onDragEnd/);
  assert.match(source, /worktreeDropCommitted/);
  assert.match(source, /worktreeDrag/);

  const mainCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="main"'));
  const mainCallEnd = source.indexOf('\n                          />', mainCallStart);
  const mainCallSource = source.slice(mainCallStart, mainCallEnd);
  assert.doesNotMatch(mainCallSource, /\bdrag=/);

  const worktreeCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="worktree"'));
  const worktreeCallEnd = source.indexOf('\n                                />', worktreeCallStart);
  const worktreeCallSource = source.slice(worktreeCallStart, worktreeCallEnd);
  assert.match(worktreeCallSource, /\bdrag=/);
  assert.match(styles, /\.worktreeRow\.dropBefore::before/);
  assert.match(styles, /\.worktreeRow\.dropAfter::after/);
});

test('commits Worktree ordering only from valid same-Workspace drop targets', async () => {
  const source = (await readSurfaceSources()).combined;
  const groupRowStart = source.indexOf('function WorktreeGroupRow');
  const groupRowEnd = source.indexOf('/** Worktree-mode Session row', groupRowStart);
  const groupRowSource = source.slice(groupRowStart, groupRowEnd);
  assert.match(
    groupRowSource,
    /onDrop: \(event: ReactDragEvent<HTMLElement>\) => \{\s*if \(!drag\.active\) return;\s*event\.preventDefault\(\);\s*drag\.drop\(rowHalf\(event\)\);/,
  );

  const worktreeCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="worktree"'));
  const worktreeCallEnd = source.indexOf('\n                                />', worktreeCallStart);
  const worktreeCallSource = source.slice(worktreeCallStart, worktreeCallEnd);
  assert.match(worktreeCallSource, /active: sameWorkspaceWorktreeDrag/);
  assert.match(worktreeCallSource, /drop: \(half\) => \{[\s\S]*?commitWorktreeDrag\(/);
  assert.equal((worktreeCallSource.match(/commitWorktreeDrag\(/g) ?? []).length, 1);
  assert.match(
    worktreeCallSource,
    /end: \(\) => \{\s*setWorktreeDrag\(undefined\);\s*worktreeDropCommitted\.current = false;\s*\}/,
  );

  const commitStart = source.indexOf('const commitWorktreeDrag =');
  const commitEnd = source.indexOf('const openSessionRename =', commitStart);
  const commitSource = source.slice(commitStart, commitEnd);
  const refreshStart = source.indexOf('const refresh = useCallback');
  const refreshEnd = source.indexOf('  useEffect(() => {', refreshStart);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  assert.match(refreshSource, /preserveCurrent/);
  assert.match(
    refreshSource,
    /if \(!preserveCurrent\) \{[\s\S]*?setReadState\(\{ status: 'loading', views: \[\] \}\)/,
  );
  assert.match(refreshSource, /if \(preserveCurrent\) throw error/);
  assert.match(
    commitSource,
    /if \(activeDrag\.workspaceId !== workspaceId\) return;[\s\S]*?insertWorktreeBefore\(/,
  );
  assert.match(
    commitSource,
    /\.then\(\(\) => refresh\(\{ preserveCurrent: true, invalidateContext: false \}\)\)[\s\S]*?setActionError\(toRetryableWorktreeOrderError\(error\)\)/,
  );
  assert.doesNotMatch(commitSource, /\.then\(\(\) => refresh\(\)\)/);
  assert.match(source, /\{actionError\.retryable && \(/);
});

test('preserves the Worktree projection for action refreshes', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  const section = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
    return source.slice(start, end);
  };

  const runMutationSource = section(
    'const runMutation = async',
    '  const workspaceRenameTrimmed',
  );
  assert.match(runMutationSource, /await refresh\(\{ preserveCurrent: true \}\)/);

  const submitWorktreeSource = section(
    'const submitWorktree = async',
    '  const createSession = async',
  );
  assert.equal(
    (submitWorktreeSource.match(/await refresh\(\{ preserveCurrent: true \}\)/g) ?? []).length,
    2,
  );

  const createSessionSource = section(
    'const createSession = async',
    '  const retrySessionBinding = async',
  );
  assert.match(createSessionSource, /await refresh\(\{ preserveCurrent: true \}\)/);

  const retryBindingSource = section(
    'const retrySessionBinding = async',
    '  return (',
  );
  assert.match(retryBindingSource, /await refresh\(\{ preserveCurrent: true \}\)/);

  const initialReadSource = section(
    "useEffect(() => {\n    if (mode === 'worktree')",
    '  useEffect(() => {\n    if (readState.status',
  );
  assert.match(
    initialReadSource,
    /void refresh\(\{ preserveCurrent: readStateRef\.current\.status === 'ready' \}\);/,
  );

  const actionRetryStart = source.indexOf('{actionError.retryable && (');
  const actionRetryEnd = source.indexOf("          {readState.status === 'loading'", actionRetryStart);
  assert.notEqual(actionRetryStart, -1);
  assert.notEqual(actionRetryEnd, -1);
  assert.match(source.slice(actionRetryStart, actionRetryEnd), /void refresh\(\);/);

  const readErrorStart = source.indexOf(
    "{readState.status === 'error' && readState.error !== undefined ?",
  );
  const readErrorEnd = source.indexOf(") : readState.status === 'ready' ?", readErrorStart);
  assert.notEqual(readErrorStart, -1);
  assert.notEqual(readErrorEnd, -1);
  assert.match(source.slice(readErrorStart, readErrorEnd), /void refresh\(\);/);
});

test('renders transient Worktree health with the public StateDot primitive', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /StateDot/);
  assert.match(source, /health/);
  assert.match(source, /['"]warning['"]/);
  assert.match(source, /['"]error['"]/);
  assert.doesNotMatch(source, /worktreeStatus\(record\)/);
});

test('keeps the final surface bounded, scrollable, and action-aligned', async () => {
  const surfaceSource = (await readSurfaceSources()).combined;
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(surfaceSource, /role="tablist"|role='tablist'/);
  assert.doesNotMatch(surfaceSource, /Workspace<\/button>[\s\S]*Worktree<\/button>/);
  assert.match(surfaceSource, /data-worktree-surface/);
  assert.match(styleSource, /overflow: auto/);
  assert.match(styleSource, /min-height: 0/);
  assert.match(styleSource, /treeActionSlot|workspaceActions/);
  assert.match(surfaceSource, /StateDot/);
  assert.doesNotMatch(surfaceSource, /\bactive\b.*\bstatus\b/);
  assert.doesNotMatch(surfaceSource, /\bbound\b/);
});

test('uses the DSH Modal primitives for Worktree create and removal dialogs', async () => {
  const source = (await readSurfaceSources()).combined;

  assert.match(source, /<WorktreeCreateDialog/);
  assert.match(source, /<WorktreeRemovalDialog/);
  assert.match(source, /t\('dialog\.closeWorktreeRemove'\)/);
  assert.match(source, /t\('worktree\.removeDescription'/);
  assert.doesNotMatch(source, /styles\.modalBackdrop/);
});

test('loads a missing Workspace projection before enabling Worktree creation', async () => {
  const { coordinator, dialogs, types } = await readSurfaceSources();

  assert.match(coordinator, /loadModalWorktreeView/);
  assert.match(coordinator, /createWorktreeModalViewLoader/);
  assert.match(coordinator, /modalReadLoader\.current\.load/);
  assert.match(coordinator, /setModalReadLoading\(true\)/);
  assert.match(coordinator, /!modalReadLoading/);
  assert.match(coordinator, /mergeWorktreeView\(current\.views/);
  assert.match(coordinator, /\.\.\.current,[\s\S]*views: mergeWorktreeView\(current\.views, view\)/);
  assert.match(coordinator, /modalReadViewRef\.current === undefined[\s\S]*mergeWorktreeView\(views, modalReadViewRef\.current\)/);
  assert.match(coordinator, /modalReadLoader\.current\.invalidate\(\);[\s\S]*setWorktreeModalWorkspaceId\(undefined\)/);
  assert.match(coordinator, /readError=\{modalReadError\}/);
  assert.match(coordinator, /onRetry=\{\(\) =>/);
  assert.match(dialogs, /!canCreate/);
  assert.match(dialogs, /formatWorktreeViewError\(readError, t\)/);
  assert.match(dialogs, /t\('action\.retry'\)/);
  assert.match(types, /readonly readError\?: WorktreeViewError/);
});

test('renders the Worktree footer action like the native Settings row', async () => {
  const actionSource = await readFile(
    new URL('../src/client/WorktreeModeAction.tsx', import.meta.url),
    'utf8',
  );
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(actionSource, /IconBranchOutline16/);
  assert.match(actionSource, /<IconBranchOutline16 size=\{wide \? 16 : 18\} \/>/);
  assert.match(
    actionSource,
    /wide && <span className=\{styles\.actionLabel\}>\{t\('mode\.label'\)\}<\/span>/,
  );
  assert.doesNotMatch(actionSource, /wide \? 'Worktree' : 'WT'/);
  assert.match(
    styleSource,
    /\.action \{[\s\S]*justify-content: flex-start;[\s\S]*height: 42px;/,
  );
  assert.match(
    styleSource,
    /\.action\[data-collapsed='true'\] \{[\s\S]*width: 36px;[\s\S]*height: 36px;[\s\S]*border-radius: 50%;/,
  );
  const footerLabelStart = styleSource.indexOf('.actionLabel {');
  const footerLabelEnd = styleSource.indexOf('\n}', footerLabelStart);
  assert.notEqual(footerLabelStart, -1);
  assert.notEqual(footerLabelEnd, -1);
  assert.equal((styleSource.match(/\.actionLabel\s*\{/g) ?? []).length, 1);
  assert.match(
    styleSource.slice(footerLabelStart, footerLabelEnd),
    /display: inline-flex;[\s\S]*min-width: 0;[\s\S]*align-items: center;[\s\S]*height: 22px;[\s\S]*font-weight: 400;[\s\S]*line-height: 22px;/,
  );
});

test('does not render a plugin WT rail control when the sidebar collapses', async () => {
  const surfaceSource = (await readSurfaceSources()).combined;
  const styleSource = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(surfaceSource, /railContent|railButton/);
  assert.doesNotMatch(styleSource, /railContent|railButton/);
});

test('matches native Workspace interaction, typography, and action rail', async () => {
  const source = (await readSurfaceSources()).combined;
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  const rowStart = source.indexOf('className={`${styles.workspaceRow} ${markerClass}`}');
  const rowEnd = source.indexOf('</div>\n  );\n}', rowStart);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);
  const rowSource = source.slice(rowStart, rowEnd);

  assert.match(rowSource, /onClick=\{\(\) => \{\s*onToggle\(\);/);
  assert.match(
    rowSource,
    /className=\{`\$\{styles\.disclosureButton\} \$\{styles\.workspaceDisclosure\}`\}/,
  );
  assert.match(rowSource, /IconChevronDownOutline14 size=\{18\}/);
  assert.match(rowSource, /IconChevronRightOutline14 size=\{18\}/);
  assert.match(
    rowSource,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);[\s\S]*onCreateWorktree\(\);/,
  );
  assert.match(
    rowSource,
    /onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);[\s\S]*onMenuOpenChange/,
  );
  assert.match(styles, /\.workspaceRow \.workspaceDisclosure\s*\{[\s\S]*display: none;/);
  assert.match(
    styles,
    /\.workspaceRow:hover \.workspaceDisclosure\s*,[\s\S]*display: inline-flex;/,
  );
  assert.match(styles, /\.workspaceRow:hover \.workspaceIcon\s*,[\s\S]*display: none;/);

  assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*font-size: 14px;/);
  assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*font-weight: 400;/);
  assert.match(styles, /\.workspaceTitle,[\s\S]*\.worktreeLabel[\s\S]*line-height: 20px;/);
  assert.match(
    styles,
    /\.treeSessionContent\s*\{[\s\S]*font-size: 14px;[\s\S]*line-height: 20px;/,
  );
  assert.match(styles, /\.sessionOverflowButton\s*\{[\s\S]*font-size: 12px;/);
  assert.match(styles, /\.searchInput\s*\{[\s\S]*font-size: 13px;/);

  assert.match(
    styles,
    /\.treeActionSlot\s*,[\s\S]*\.workspaceActions\s*\{[\s\S]*flex: 0 0 64px;/,
  );
  assert.match(
    styles,
    /\.treeActionSlot\s*,[\s\S]*\.workspaceActions\s*\{[\s\S]*width: 64px;/,
  );
  assert.match(styles, /\.treeActionSlot > \.iconButton:last-child\s*\{[\s\S]*right: 0;/);
  assert.match(styles, /\.treeActionSlot > \.menuAction\s*\{[\s\S]*right: 32px;/);
  assert.match(styles, /\.groupHeader\s*\{[\s\S]*padding-right: 4px;/);
});

test('invalidates the active Session context after Worktree reads but not pure reorder refreshes', async () => {
  let invalidations = 0;
  const invalidateWorktreeContext = async () => {
    invalidations += 1;
  };

  await loadWorktreeViews(manager(), ['ws1'], { invalidateWorktreeContext });
  assert.equal(invalidations, 1);

  await loadWorktreeViews(manager(), ['ws1'], {
    invalidateContext: false,
    invalidateWorktreeContext,
  });
  assert.equal(invalidations, 1);

  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /invalidateWorktreeContext/);
  assert.match(source, /refresh\(\{ preserveCurrent: true, invalidateContext: false \}\)/);
});

test('matches shared Worktree row disclosure and aligned action geometry', async () => {
  const source = (await readSurfaceSources()).combined;
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  const rowStart = source.indexOf('function WorktreeGroupRow');
  const rowEnd = source.indexOf('/** Worktree-mode Session row', rowStart);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);
  const rowSource = source.slice(rowStart, rowEnd);

  assert.match(rowSource, /className=\{`\$\{styles\.worktreeRow\} \$\{markerClass\}`\}/);
  assert.match(
    rowSource,
    /className=\{`\$\{styles\.disclosureButton\} \$\{styles\.worktreeDisclosure\}`\}/,
  );
  assert.match(rowSource, /IconChevronDownOutline14 size=\{18\}/);
  assert.match(rowSource, /IconChevronRightOutline14 size=\{18\}/);
  assert.match(
    rowSource,
    /data-add-session=\{main \? undefined : 'true'\}[\s\S]*onClick=\{\(event\) => \{\s*event\.stopPropagation\(\);/,
  );
  assert.match(source, /interface WorktreeGroupMenuProps[\s\S]*menu\?: WorktreeGroupMenuProps/);
  assert.match(rowSource, /menu,/);
  assert.match(rowSource, /data-worktree-menu/);

  assert.match(
    styles,
    /\.disclosureButton\s*\{[\s\S]*display: inline-flex;[\s\S]*align-items: center;[\s\S]*justify-content: center;/,
  );
  assert.match(styles, /\.disclosureButton > svg\s*\{[\s\S]*display: block;/);
  assert.match(
    styles,
    /\.worktreeRow \.worktreeDisclosure\s*\{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.worktreeRow:hover \.worktreeDisclosure\s*,[\s\S]*\.worktreeRow\[data-menu-open='true'\] \.worktreeDisclosure[\s\S]*display: inline-flex;/,
  );
  assert.match(
    styles,
    /\.worktreeRow:hover \.worktreeIcon\s*,[\s\S]*\.worktreeRow\[data-menu-open='true'\] \.worktreeIcon[\s\S]*display: none;/,
  );
  assert.match(styles, /\.treeChildren\s*\{[\s\S]*padding: 2px 0 5px 12px;/);
});

test('shares one parameterized group row while gating removal UI by row configuration', async () => {
  const source = (await readSurfaceSources()).combined;
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  assert.equal((source.match(/function WorktreeGroupRow/g) ?? []).length, 1);
  assert.match(source, /function WorktreeGroupRow/);
  assert.doesNotMatch(source, /MainSessionGroupRow/);
  assert.match(source, /kind="main"/);
  assert.match(source, /kind="worktree"/);
  assert.match(source, /kind="main"[\s\S]*icon=\{<IconBranchOutline16 \/>\}/);
  assert.match(source, /kind="worktree"[\s\S]*icon=\{<IconBranchOutline16 \/>\}/);
  assert.match(source, /data-add-main-session/);
  assert.match(source, /data-add-session/);
  assert.match(source, /isMainExpanded/);
  assert.match(source, /isWorktreeExpanded/);
  assert.match(source, /interface WorktreeGroupMenuProps/);
  assert.match(source, /menu\?: WorktreeGroupMenuProps/);
  assert.match(source, /worktreeRemoval/);
  assert.match(source, /openWorktreeMenuId/);
  assert.match(source, /data-worktree-menu/);
  assert.match(source, /t\('worktree\.remove'\)/);
  const mainCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="main"'));
  const mainCallEnd = source.indexOf('\n                          />', mainCallStart);
  const mainCallSource = source.slice(mainCallStart, mainCallEnd);
  assert.doesNotMatch(mainCallSource, /\bmenu=/);
  const worktreeCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="worktree"'));
  const worktreeCallEnd = source.indexOf('\n                                />', worktreeCallStart);
  const worktreeCallSource = source.slice(worktreeCallStart, worktreeCallEnd);
  assert.match(worktreeCallSource, /\bmenu=\{\s*record\.status === 'active'/);
  assert.doesNotMatch(styles, /\.mainRow|\.mainLabel|\.mainDisclosure/);
  assert.match(source, /mainExpanded && \(\s*<WorktreeSessionGroup/);
});

test('polishes Main and Worktree row hover presentation', async () => {
  const source = (await readSurfaceSources()).combined;
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /\bHoverCard\b/);
  assert.match(source, /<HoverCard[\s\S]*openDelayMs=\{500\}/);
  assert.match(
    source,
    /content=\{<div className=\{styles\.worktreeHoverTitle\}>\{label\}<\/div>\}/,
  );
  assert.match(source, /disabled=\{menu\?\.open === true\}/);

  assert.match(
    styles,
    /\.worktreeRow \.worktreeIcon,[\s\S]*\.worktreeRow \.disclosureButton\s*\{[\s\S]*width: 22px;/,
  );
  assert.match(
    styles,
    /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*font-weight: 600;/,
  );
  assert.doesNotMatch(
    styles,
    /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*text-transform: uppercase;/,
  );
  assert.match(
    styles,
    /\.worktreeState\s*\{[\s\S]*width: 12px;[\s\S]*margin-right: 0;/,
  );
  assert.match(
    styles,
    /\.worktreeHoverTitle\s*\{[\s\S]*color: var\(--dsw-static-neutral-bluish-00\);/,
  );
});

test('renders a localized Main label with the current branch and a fallback', async () => {
  const source = (await readSurfaceSources()).combined;
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(
    source,
    /const currentBranch = view\?\.branches\.find\(\s*\(branch\) => branch\.isCurrent,?\s*\)\?\.name;/,
  );
  assert.match(
    source,
    /const mainLabel = currentBranch === undefined\s+\? t\('worktree\.main'\)\s+: t\('worktree\.mainWithBranch', \{ branch: currentBranch \}\);/,
  );
  assert.match(source, /kind="main"[\s\S]*label=\{mainLabel\}/);
  assert.doesNotMatch(source, /label=\{t\('worktree\.main'\)\}/);
  assert.match(
    styles,
    /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*font-weight: 600;/,
  );
  assert.doesNotMatch(
    styles,
    /\.worktreeRow\[data-main-group='true'\] \.worktreeLabel\s*\{[^}]*text-transform: uppercase;/,
  );
});

test('reconciles the selected branch after the modal view becomes ready', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /reconcileBaseBranchSelection/);
  assert.match(source, /modalView\?\.readiness/);
  assert.match(source, /setSelectedBranch\(\(current\) =>/);
});

test('renders setup instructions instead of a fake base-branch option', async () => {
  const source = (await readSurfaceSources()).combined;
  const localeSource = await readFile(
    new URL('../src/client/locales.ts', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  assert.match(source, /data-worktree-readiness/);
  assert.match(source, /worktreeSetupCommands/);
  assert.match(source, /<pre[\s\S]*className=\{styles\.commandBlock\}[\s\S]*>/);
  assert.match(source, /setupCommands\.length > 0/);
  assert.match(source, /\{setupCommands\.join\('\\n'\)\}/);
  assert.match(source, /view\?\.branches\.map/);
  assert.doesNotMatch(source, /<option value="">\{t\('worktree\.noLocalBranch'\)\}<\/option>/);
  assert.match(localeSource, /worktree\.setup\.noRepository/);
  assert.match(localeSource, /worktree\.setup\.noInitialCommit/);
  assert.match(localeSource, /worktree\.setup\.noLocalBranch/);
  assert.match(localeSource, /worktree\.setup\.gitNotInstalled/);
  assert.match(styles, /\.commandBlock\s*\{/);
});

test('wires native blank Session visibility and menu parity into both tree groups', async () => {
  const source = (await readSurfaceSources()).combined;
  const localeSource = await readFile(
    new URL('../src/client/locales.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /session-view\.js/);
  assert.match(source, /filterVisibleSessionIds/);
  assert.match(source, /isBlankSession/);
  assert.match(source, /sessionMatchesQuery/);
  assert.match(source, /blank=\{isBlankSession\(sessionId, sessions\)\}/);
  assert.match(localeSource, /'session\.new': '新会话'/);
  assert.match(localeSource, /'session\.new': 'New Session'/);

  const rowStart = source.indexOf('function WorktreeSessionRow');
  const rowEnd = source.indexOf('interface WorktreeSessionGroupProps', rowStart);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);
  const rowSource = source.slice(rowStart, rowEnd);
  assert.match(source, /interface WorktreeSessionRowProps \{[\s\S]*readonly blank: boolean/);
  assert.match(rowSource, /data-session-blank/);
  assert.match(rowSource, /\{!blank && \(/);
});

test('routes pending Worktree Session Retry through the browser recovery helper', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /retryWorktreeSessionBinding/);
  assert.match(source, /archivedSessionIds\.includes\(pendingSessionBinding\.sessionId\)/);
  assert.doesNotMatch(source, /await manager\.bindSession\(\{[\s\S]*pendingSessionBinding/);
});

test('does not expose Worktree plus for removed or repair Worktrees', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /record\.status === 'active' && record\.health !== 'repair'/);
});

test('uses the injected expand-state store for structural rows', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const types = await readFile(
    new URL('../src/client/worktree-surface-types.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /useSyncExternalStore/);
  assert.match(source, /expandState\.actions\.toggleWorkspace/);
  assert.match(source, /expandState\.actions\.toggleMain/);
  assert.match(source, /expandState\.actions\.toggleWorktree/);
  assert.match(source, /isWorkspaceExpanded/);
  assert.match(source, /isMainExpanded/);
  assert.match(source, /isWorktreeExpanded/);
  assert.doesNotMatch(source, /useState<Record<string, boolean>>/);
  assert.match(types, /WorktreeExpandStateStore/);
  assert.match(types, /readonly expandState:/);
});

test('clears transient groups on parent collapse and prunes only ready snapshots', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /clearSessionGroupExpansion/);
  assert.match(source, /readState\.status !== 'ready'/);
  assert.match(source, /isCompleteWorktreeWorkspaceSnapshot/);
  assert.match(source, /expandState\.actions\.retain\(/);
  assert.match(source, /main:/);
  assert.match(source, /worktree:/);
  assert.doesNotMatch(source, /expandedSessionGroups.*localStorage/);
});
