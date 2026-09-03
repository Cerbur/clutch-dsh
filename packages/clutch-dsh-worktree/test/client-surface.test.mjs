import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

import {
  createNumberedWorktreeName,
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
  assert.match(
    readme,
    /Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list/i,
  );
  assert.match(
    clientReadme,
    /Newly created or imported Worktrees are inserted at the head of their Workspace's Worktree list/i,
  );
  assert.match(
    readmeZh,
    /新创建或新导入的 Worktree 会插入所属 Workspace 的 Worktree 列表队头/,
  );
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
  assert.match(readme, /current Session.*highlight|highlight.*current Session/i);
  assert.match(readme, /temporar(y|ily).*reveal|temporary.*expand/i);
  assert.match(readme, /does not change.*persisted.*expansion|persisted.*expansion.*unchanged/i);
  assert.match(readmeZh, /当前 Session.*高亮|高亮.*当前 Session/);
  assert.match(readmeZh, /临时.*展开|临时.*定位/);
  assert.match(readmeZh, /不改变.*展开选择|展开选择.*不改变/);
  assert.match(clientReadme, /current Session.*browser-local|当前 Session.*浏览器本地/i);
  assert.match(clientReadme, /scrollIntoView|nearest visible area|最近可见区域/i);
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
          source: 'plugin',
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
        source: 'plugin',
        status: 'active',
      };
    },
    async listImportCandidates() {
      return [];
    },
    async importWorktree(input) {
      return {
        worktreeId: 'imported',
        workspaceId: input.workspaceId,
        branch: 'feature/external',
        absolutePath: input.absolutePath,
        source: 'external',
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

test('merges targeted Workspace views while preserving order and references', () => {
  assert.equal(typeof worktreeView.mergeWorktreeViews, 'function');
  const ws1 = {
    workspaceId: 'ws1',
    worktrees: [],
    branches: [],
    bindings: [],
    readiness: { status: 'ready' },
  };
  const ws2 = {
    workspaceId: 'ws2',
    worktrees: [],
    branches: [],
    bindings: [],
    readiness: { status: 'ready' },
  };
  const updatedWs2 = { ...ws2, bindings: [{ workspaceId: 'ws2', worktreeId: 'wt2', sessionId: 's2', status: 'active' }] };

  const updated = worktreeView.mergeWorktreeViews([ws1, ws2], ['ws1', 'ws2'], [updatedWs2]);
  assert.equal(updated[0], ws1);
  assert.equal(updated[1], updatedWs2);
  assert.deepEqual(
    worktreeView.mergeWorktreeViews(updated, ['ws2', 'ws1'], []),
    [updatedWs2, ws1],
  );
  assert.deepEqual(
    worktreeView.mergeWorktreeViews(updated, ['ws1'], []),
    [ws1],
  );
});

test('routes Surface reads through explicit shared-reader scopes', async () => {
  const { coordinator, types } = await readSurfaceSources();
  const refreshStart = coordinator.indexOf('const refresh = useCallback');
  const refreshEnd = coordinator.indexOf('  useEffect(() => {', refreshStart);
  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);
  const refreshSource = coordinator.slice(refreshStart, refreshEnd);

  assert.match(types, /type WorktreeRefreshScope/);
  assert.match(types, /TargetedWorktreeReadError/);
  assert.match(types, /targetError\?: TargetedWorktreeReadError/);
  assert.match(coordinator, /viewReader/);
  assert.match(refreshSource, /viewReader\.readMany\(/);
  assert.match(refreshSource, /viewReader\.read\(/);
  assert.match(refreshSource, /targetRefreshGuards/);
  assert.doesNotMatch(refreshSource, /loadWorktreeViews\(/);
  assert.match(coordinator, /previousWorkspaceIdsRef/);
  assert.match(coordinator, /addedWorkspaceIds/);
  assert.match(coordinator, /mergeWorktreeViews\(current\.views, workspaceIds, \[\]\)/);
  assert.match(coordinator, /data-worktree-target-error/);
});

test('records the minimum-scope refresh invariant in package instructions', async () => {
  const agents = await readFile(new URL('../AGENTS.md', import.meta.url), 'utf8');
  const invariant = `Refresh scope is determined by the smallest affected identity.

- A Worktree mutation or binding change updates only the affected Worktree
  projection and refreshes at most its owning Workspace.
- A Workspace-scoped change refreshes only the affected Workspace.
- Context projection is invalidated only when the current Session/Workspace is affected.
- Global refresh is reserved for initial Worktree entry, reconnect/baseline recovery,
  explicit global retry, or a deliberately diagnosed unknown scope.
- Targeted refreshes merge into the existing ready projection and never clear unrelated
  Workspaces.
- Stale-result guards are not request deduplication; equivalent in-flight targeted reads
  must be shared.
- The \`listBindings\` interface is Workspace-scoped; Worktree-level updates use a targeted
  Workspace read plus a local Worktree merge.`;

  assert.ok(agents.includes(invariant));
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
  const firstWorktrees = deferred();
  let listWorktrees = () => firstWorktrees.promise;
  const readManager = manager({ listWorktrees: (...args) => listWorktrees(...args) });
  const reader = worktreeView.createWorktreeViewReader(readManager);
  const loader = worktreeView.createWorktreeModalViewLoader(reader);
  const views = [];
  const errors = [];

  const staleLoad = loader.load(
    'ws-imported',
    (view) => views.push(view),
    (error) => errors.push(error),
  );
  loader.invalidate();
  firstWorktrees.resolve([]);
  await staleLoad;

  assert.deepEqual(views, []);
  assert.deepEqual(errors, []);

  reader.invalidate('ws-imported');
  const failedWorktrees = deferred();
  listWorktrees = () => failedWorktrees.promise;
  const failedLoad = loader.load(
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

  reader.invalidate('ws-imported');
  listWorktrees = async () => [];
  await loader.load(
    'ws-imported',
    (view) => views.push(view),
    (error) => errors.push(error),
  );

  assert.equal(views.length, 1);
  assert.equal(views[0].workspaceId, 'ws-imported');
  assert.equal(views[0].readiness.status, 'ready');
  assert.equal(errors.length, 1);
  reader.dispose();
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
  const modalReader = worktreeView.createWorktreeViewReader(readManager);
  const modalLoader = worktreeView.createWorktreeModalViewLoader(modalReader);
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
    () => worktreeView.loadWorktreeViews(readManager, ['ws1', 'ws2']),
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
  modalReader.dispose();
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

test('generates the next available numbered name from a selected Worktree', () => {
  assert.equal(
    createNumberedWorktreeName('feature', ['feature', 'feature-2', 'feature-4']),
    'feature-3',
  );
  assert.equal(
    createNumberedWorktreeName('feature-3', ['feature', 'feature-2', 'feature-3', 'feature-4']),
    'feature-5',
  );
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

test('executes create, import, and remove actions through the Manager contract', async () => {
  const calls = [];
  const worktreeManager = manager({
    async createWorktree(input) {
      calls.push(['createWorktree', input]);
      return manager().createWorktree(input);
    },
    async removeWorktree(input) {
      calls.push(['removeWorktree', input]);
    },
    async importWorktree(input) {
      calls.push(['importWorktree', input]);
      return manager().importWorktree(input);
    },
  });

  const created = await executeWorktreeAction(worktreeManager, {
    type: 'createWorktree',
    input: { workspaceId: 'ws1', branch: 'main', newBranch: 'dsh/12345678' },
  });
  await executeWorktreeAction(worktreeManager, {
    type: 'removeWorktree',
    input: { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token-example' },
  });
  const imported = await executeWorktreeAction(worktreeManager, {
    type: 'importWorktree',
    input: { workspaceId: 'ws1', absolutePath: '/tmp/external' },
  });
  assert.deepEqual(calls, [
    ['createWorktree', { workspaceId: 'ws1', branch: 'main', newBranch: 'dsh/12345678' }],
    ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token-example' }],
    ['importWorktree', { workspaceId: 'ws1', absolutePath: '/tmp/external' }],
  ]);
  assert.deepEqual(created, {
    worktreeId: 'created',
    workspaceId: 'ws1',
    branch: 'dsh/12345678',
    absolutePath: '/tmp/created',
    source: 'plugin',
    status: 'active',
  });
  assert.deepEqual(imported, {
    worktreeId: 'imported',
    workspaceId: 'ws1',
    branch: 'feature/external',
    absolutePath: '/tmp/external',
    source: 'external',
    status: 'active',
  });
});

test('normalizes detached Worktree Session permissions after removal', async () => {
  const calls = [];
  const notices = [];
  const worktreeManager = manager({
    async removeWorktree(input) {
      calls.push(['removeWorktree', input]);
    },
  });
  const permission = {
    async normalizeDetachedWorktreePermissions(input) {
      calls.push(['normalizeDetachedWorktreePermissions', input]);
      return {
        status: 'normalized-workspace-write',
        sessionIds: ['session-one'],
        retryable: false,
      };
    },
  };

  await executeWorktreeAction(worktreeManager, {
    type: 'removeWorktree',
    input: { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token-example' },
  }, permission, (input, result) => {
    notices.push({ input, result });
  });

  assert.deepEqual(calls, [
    ['removeWorktree', { workspaceId: 'ws1', worktreeId: 'wt1', mutationToken: 'token-example' }],
    ['normalizeDetachedWorktreePermissions', { workspaceId: 'ws1', worktreeId: 'wt1' }],
  ]);
  assert.deepEqual(notices, [{
    input: { workspaceId: 'ws1', worktreeId: 'wt1' },
    result: {
      status: 'normalized-workspace-write',
      sessionIds: ['session-one'],
      retryable: false,
    },
  }]);
});

test('adds a Create/Import dialog that retains the existing shared Session registration flow', async () => {
  const { coordinator, dialogs, types } = await readSurfaceSources();

  assert.match(types, /export type WorktreeRegistrationMode = 'create' \| 'import';/);
  assert.match(types, /export type ImportCandidatesState =/);
  assert.match(types, /WorktreeImportCandidate/);
  assert.match(dialogs, /role="tablist"/);
  assert.match(dialogs, /role="tab"/);
  assert.match(dialogs, /aria-selected=\{mode === 'create'\}/);
  assert.match(dialogs, /aria-selected=\{mode === 'import'\}/);
  assert.match(dialogs, /candidate\.branch/);
  assert.match(dialogs, /candidate\.absolutePath/);
  assert.match(dialogs, /t\('worktree\.import'\)/);
  assert.match(dialogs, /t\('worktree\.importDescription'/);
  assert.match(dialogs, /t\('worktree\.importEmpty'\)/);
  assert.match(dialogs, /t\('worktree\.importLoading'\)/);
  assert.match(dialogs, /t\('worktree\.importPlaceholder'\)/);
  assert.match(dialogs, /t\('action\.retry'\)/);

  assert.match(coordinator, /const \[worktreeModalMode, setWorktreeModalMode\] =\s*useState<WorktreeRegistrationMode>\('create'\)/);
  assert.match(coordinator, /const \[importCandidates, setImportCandidates\] =\s*useState<ImportCandidatesState>/);
  assert.match(coordinator, /const \[selectedImportPath, setSelectedImportPath\] =\s*useState<string \| undefined>\(\)/);
  assert.match(coordinator, /manager\.listImportCandidates\(\{ workspaceId \}\)/);
  assert.match(coordinator, /type: 'importWorktree'/);
  assert.match(coordinator, /absolutePath: selectedImportCandidate!\.absolutePath/);
  assert.match(coordinator, /const continueWorktreeRegistration = async/);
  assert.match(coordinator, /await continueWorktreeRegistration\(registeredWorktree\)/);
  assert.match(coordinator, /code: 'WORKTREE_REGISTRATION_SESSION_UNAVAILABLE'/);
  assert.match(
    coordinator,
    /scope: \{ kind: 'workspace', workspaceId: registeredWorktree\.workspaceId \}/,
  );
});

test('renders import candidates in a native dropdown instead of a flat candidate list', async () => {
  const { dialogs } = await readSurfaceSources();

  assert.match(dialogs, /<select[\s\S]*className=\{styles\.worktreeImportSelect\}/);
  assert.match(dialogs, /value=\{selectedImportPath \?\? ''\}/);
  assert.match(
    dialogs,
    /onSelectedImportPathChange\(event\.currentTarget\.value\)/,
  );
  assert.match(dialogs, /<option value="" disabled>/);
  assert.match(dialogs, /<option key=\{candidate\.absolutePath\} value=\{candidate\.absolutePath\}>/);
  assert.match(dialogs, /candidate\.branch/);
  assert.match(dialogs, /candidate\.absolutePath/);
  assert.doesNotMatch(dialogs, /data-worktree-import-candidate/);
});

test('keeps modal candidate state current without blanking ready Worktrees', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const loadStart = source.indexOf('const loadImportCandidates =');
  const loadEnd = source.indexOf('const continueWorktreeRegistration =', loadStart);

  assert.notEqual(loadStart, -1);
  assert.notEqual(loadEnd, -1);
  const loadSource = source.slice(loadStart, loadEnd);
  assert.match(loadSource, /candidates: current\.candidates/);
  assert.match(loadSource, /importCandidatesGuard\.current/);
  assert.match(loadSource, /worktreeModalWorkspaceId/);
  assert.match(loadSource, /setImportCandidates\(\(current\) => \(\{\s*status: 'error',\s*candidates: current\.candidates/);
  assert.match(source, /setWorktreeModalMode\('create'\)/);
  assert.match(source, /setImportCandidates\(\{ status: 'idle', candidates: \[\] \}\)/);
  assert.match(source, /setSelectedImportPath\(undefined\)/);
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
  assert.match(source, /code: 'WORKTREE_REGISTRATION_SESSION_UNAVAILABLE'/);
  assert.match(source, /code: 'WORKTREE_RECORD_MISSING'/);
  assert.doesNotMatch(source, /message: t\('error\.workspaceOrderingUnavailable'\)/);
  assert.doesNotMatch(source, /message: t\('error\.sessionOrderingUnavailable'\)/);
  assert.doesNotMatch(source, /message: t\('error\.worktreeRegistrationSessionUnavailable'\)/);
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

  assert.match(source, /const\s+registeredWorktree\s*=\s*worktreeModalMode\s*===\s*'create'/);
  assert.match(source, /await continueWorktreeRegistration\(registeredWorktree\)/);
  assert.match(source, /await createSessionCallback\(sessionInput\)/);
  assert.match(source, /worktreeId: registeredWorktree\.worktreeId/);
  assert.match(source, /cwd: registeredWorktree\.absolutePath/);
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

test('adds Copy session ID to the Worktree Session menu', async () => {
  const { rows } = await readSurfaceSources();
  const locales = await readFile(
    new URL('../src/client/locales.ts', import.meta.url),
    'utf8',
  );
  const sessionRowStart = rows.indexOf('/** Worktree-mode Session row');
  assert.notEqual(sessionRowStart, -1);
  const sessionRow = rows.slice(sessionRowStart);

  assert.match(sessionRow, /IconCopyOutline16/);
  assert.match(sessionRow, /id: 'copy-session-id'/);
  assert.match(sessionRow, /label: t\('session\.copyId'\)/);
  assert.match(sessionRow, /void writeClipboard\(sessionId\)/);
  assert.match(locales, /'session\.copyId': '复制 Session ID'/);
  assert.match(locales, /'session\.copyId': 'Copy session ID'/);
});

test('refreshes the ready Worktree projection after fork binding and exposes recovery retry', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /forkRecovery/);
  assert.match(source, /retryForkSession/);
  assert.match(source, /data-fork-recovery/);
  assert.match(source, /refresh\(\{[\s\S]*preserveCurrent: true/);
  assert.match(source, /forkRecoverySnapshot\.affectedWorkspaceIds\.length === 0\) return/);
  assert.match(source, /scope: \{[\s\S]*kind: 'workspaces',[\s\S]*affectedWorkspaceIds/);
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
    /\.then\(\(\) => refresh\(\{[\s\S]*?kind: 'workspace',[\s\S]*?workspaceId \},[\s\S]*?invalidateContext: false[\s\S]*?\}\)\)[\s\S]*?setActionError\(toRetryableWorktreeOrderError\(error\)\)/,
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
  assert.match(runMutationSource, /refreshOptions/);

  const registrationSource = section(
    'const continueWorktreeRegistration = async',
    '  const submitWorktree = async',
  );
  assert.equal(
    (registrationSource.match(/kind: 'workspace', workspaceId: registeredWorktree\.workspaceId/g) ?? []).length,
    2,
  );

  const createSessionSource = section(
    'const createSession = async',
    '  const retrySessionBinding = async',
  );
  assert.match(createSessionSource, /kind: 'workspace', workspaceId: input\.workspaceId/);

  const retryBindingSource = section(
    'const retrySessionBinding = async',
    '  return (',
  );
  assert.match(retryBindingSource, /kind: 'workspace', workspaceId: pending\.workspaceId/);

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
  assert.match(source.slice(actionRetryStart, actionRetryEnd), /kind: 'global'/);

  const readErrorStart = source.indexOf(
    "{readState.status === 'error' && readState.error !== undefined ?",
  );
  const readErrorEnd = source.indexOf(") : readState.status === 'ready' ?", readErrorStart);
  assert.notEqual(readErrorStart, -1);
  assert.notEqual(readErrorEnd, -1);
  assert.match(source.slice(readErrorStart, readErrorEnd), /kind: 'global'/);
});

test('keeps targeted refresh errors local and retryable', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const refreshStart = source.indexOf('const refresh = useCallback');
  const refreshEnd = source.indexOf('  useEffect(() => {', refreshStart);
  const refreshSource = source.slice(refreshStart, refreshEnd);
  const targetErrorStart = source.indexOf('{readState.targetError !== undefined && (');
  const targetErrorEnd = source.indexOf('{readState.status === \'loading\'', targetErrorStart);

  assert.match(refreshSource, /views: mergeWorktreeViews\(current\.views, workspaceIdsRef\.current, \[\]\)/);
  assert.match(refreshSource, /status: 'ready',\s*views: mergeWorktreeViews/);
  assert.match(refreshSource, /retryable: true/);
  assert.match(refreshSource, /if \(!workspaceIdsRef\.current\.includes\(workspaceId\)\) return/);
  assert.notEqual(targetErrorStart, -1);
  assert.notEqual(targetErrorEnd, -1);
  assert.match(source.slice(targetErrorStart, targetErrorEnd), /data-worktree-target-error/);
  assert.match(source.slice(targetErrorStart, targetErrorEnd), /kind: 'workspaces'/);
  assert.match(source.slice(targetErrorStart, targetErrorEnd), /preserveCurrent: true/);
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

  assert.match(surfaceSource, /role="tablist"/);
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
  assert.match(coordinator, /modalReadViewRef\.current === undefined[\s\S]*mergeWorktreeView\(merged, modalReadViewRef\.current\)/);
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

test('keeps low-level Worktree reads free of implicit Context invalidation', async () => {
  let invalidations = 0;
  const invalidateWorktreeContext = async () => {
    invalidations += 1;
  };

  await loadWorktreeViews(manager(), ['ws1'], {
    invalidateWorktreeContext,
  });
  assert.equal(invalidations, 0);
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

test('reduces the left offset before the nested tree line', async () => {
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  const ruleStart = styles.indexOf('.treeChildren {');
  const ruleEnd = styles.indexOf('}', ruleStart);
  assert.notEqual(ruleStart, -1);
  assert.notEqual(ruleEnd, -1);

  assert.match(styles.slice(ruleStart, ruleEnd + 1), /margin-left: 16px;/);
});

test('indents Session tabs by the Worktree icon width', async () => {
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  const ruleStart = styles.indexOf('.treeSessionRow {');
  const ruleEnd = styles.indexOf('}', ruleStart);
  assert.notEqual(ruleStart, -1);
  assert.notEqual(ruleEnd, -1);

  const sessionRule = styles.slice(ruleStart, ruleEnd + 1);
  assert.match(sessionRule, /margin-left: 22px;/);
  assert.match(sessionRule, /width: calc\(100% - 22px\);/);
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
  assert.match(mainCallSource, /\bmenu=/);
  assert.match(mainCallSource, /showRemove: false/);
  const worktreeCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="worktree"'));
  const worktreeCallEnd = source.indexOf('\n                                />', worktreeCallStart);
  const worktreeCallSource = source.slice(worktreeCallStart, worktreeCallEnd);
  assert.match(worktreeCallSource, /\bmenu=\{\{/);
  assert.match(worktreeCallSource, /showRemove: record\.status === 'active'/);
  assert.doesNotMatch(styles, /\.mainRow|\.mainLabel|\.mainDisclosure/);
  assert.match(source, /mainExpanded && \(\s*<WorktreeSessionGroup/);
});

test('copies Main and Worktree paths while gating removal through menu visibility', async () => {
  const source = (await readSurfaceSources()).combined;
  const locales = await readFile(
    new URL('../src/client/locales.ts', import.meta.url),
    'utf8',
  );
  const groupRowStart = source.indexOf('function WorktreeGroupRow');
  const groupRowEnd = source.indexOf('/** Worktree-mode Session row', groupRowStart);
  assert.notEqual(groupRowStart, -1);
  assert.notEqual(groupRowEnd, -1);
  const groupRowSource = source.slice(groupRowStart, groupRowEnd);

  assert.match(groupRowSource, /IconCopyOutline16/);
  assert.match(groupRowSource, /writeClipboard/);
  assert.match(groupRowSource, /id: 'copy-path'/);
  assert.match(groupRowSource, /void writeClipboard\(menu\.copyPath\)/);
  assert.match(groupRowSource, /menu\.showRemove\s*\?\s*\[/);
  assert.match(source, /readonly copyPath: string;/);
  assert.match(source, /readonly showRemove: boolean;/);

  const mainCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="main"'));
  const mainCallEnd = source.indexOf('\n                          />', mainCallStart);
  const mainCallSource = source.slice(mainCallStart, mainCallEnd);
  assert.match(mainCallSource, /menu=\{\{[\s\S]*copyPath: workspace\.path/);
  assert.match(mainCallSource, /showRemove: false/);

  const worktreeCallStart = source.lastIndexOf('<WorktreeGroupRow', source.indexOf('kind="worktree"'));
  const worktreeCallEnd = source.indexOf('\n                                />', worktreeCallStart);
  const worktreeCallSource = source.slice(worktreeCallStart, worktreeCallEnd);
  assert.match(worktreeCallSource, /menu=\{\{/);
  assert.match(worktreeCallSource, /copyPath: record\.absolutePath/);
  assert.match(worktreeCallSource, /showRemove: record\.status === 'active'/);
  assert.doesNotMatch(worktreeCallSource, /menu=\{\s*record\.status === 'active'/);

  assert.match(locales, /'worktree\.copyPath': '复制路径'/);
  assert.match(locales, /'worktree\.copyPath': 'Copy path'/);
});

test('offers Local and Worktree creation through shared menu parameters', async () => {
  const { coordinator, rows, types } = await readSurfaceSources();

  assert.match(rows, /id: 'create'/);
  assert.match(rows, /label: t\('worktree\.createNew'\)/);
  assert.match(rows, /icon: <IconPlusOutline16 \/>/);
  assert.match(rows, /menu\.showCreate/);
  assert.match(rows, /if \(id === 'create' && menu\.showCreate\) menu\.onCreateWorktree\?\.\(\)/);
  assert.match(types, /readonly showCreate: boolean;/);
  assert.match(types, /readonly onCreateWorktree\?: \(\) => void;/);
  assert.match(coordinator, /createNumberedWorktreeName/);
  assert.match(
    coordinator,
    /onCreateWorktree: record\.status === 'active'[\s\S]*openWorktreeCreator\(workspace, \{[\s\S]*baseBranch: record\.branch[\s\S]*newBranch: createNumberedWorktreeName\(\s*record\.branch/,
  );

  const mainCallStart = coordinator.lastIndexOf('<WorktreeGroupRow', coordinator.indexOf('kind="main"'));
  const mainCallEnd = coordinator.indexOf('\n                          />', mainCallStart);
  const mainCallSource = coordinator.slice(mainCallStart, mainCallEnd);
  assert.match(mainCallSource, /showCreate: currentBranch !== undefined/);
  assert.match(mainCallSource, /onCreateWorktree:/);
  assert.match(mainCallSource, /baseBranch: currentBranch/);
  assert.match(mainCallSource, /newBranch: createNumberedWorktreeName\(\s*currentBranch/);

  const worktreeCallStart = coordinator.lastIndexOf('<WorktreeGroupRow', coordinator.indexOf('kind="worktree"'));
  const worktreeCallEnd = coordinator.indexOf('\n                                />', worktreeCallStart);
  const worktreeCallSource = coordinator.slice(worktreeCallStart, worktreeCallEnd);
  assert.match(worktreeCallSource, /showCreate: record\.status === 'active'/);
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

test('keeps the native Session hover detail card on Worktree rows', async () => {
  const source = (await readSurfaceSources()).combined;
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );

  const rowStart = source.indexOf('export function WorktreeSessionRow');
  const rowEnd = source.indexOf('export function WorktreeSessionGroup', rowStart);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);
  const rowSource = source.slice(rowStart, rowEnd);

  assert.match(source, /function WorktreeSessionHoverContent/);
  assert.match(source, /session\.time\.ago/);
  assert.match(rowSource, /return \(\s*<HoverCard/);
  assert.match(rowSource, /content=\{[\s\S]*WorktreeSessionHoverContent/);
  assert.match(rowSource, /disabled=\{menuOpen \|\| drag\.active\}/);
  assert.match(rowSource, /copyText=\{blank \? undefined : label\}/);
  assert.match(rowSource, /copyLabel=\{t\('copy'\)\}/);
  assert.match(rowSource, /copiedLabel=\{t\('hover\.copied'\)\}/);
  assert.match(source, /value\.unit === 'now'/);
  assert.match(
    styles,
    /\.sessionHoverContent\s*\{[\s\S]*display: flex;[\s\S]*gap: 8px;/,
  );
  assert.match(styles, /\.sessionHoverTitle\s*\{[\s\S]*font-size: 14px;/);
  assert.match(styles, /\.sessionHoverStatus\s*\{[\s\S]*display: flex;/);
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
    /const\s+mainLabel\s*=\s*currentBranch\s*===\s*undefined\s*\?\s*t\('worktree\.main'\)\s*:\s*t\('worktree\.mainWithBranch',\s*\{\s*branch:\s*currentBranch\s*\}\);/,
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

test('marks only the DSH current Session row without changing row controls', async () => {
  const { rows, types } = await readSurfaceSources();
  assert.match(types, /readonly current: boolean/);
  assert.match(types, /readonly currentSessionId\?: string/);
  assert.match(rows, /data-session-current=\{current \? 'true' : undefined\}/);
  assert.match(rows, /aria-current=\{current \? 'true' : undefined\}/);
  assert.match(rows, /current=\{sessionId === currentSessionId\}/);
  assert.match(await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  ), /\.treeSessionRow\[data-session-current='true'\]/);
});

test('removes the unnecessary Session tree guide glyph', async () => {
  const { rows } = await readSurfaceSources();
  assert.doesNotMatch(rows, /styles\.treeGuide/);
  assert.doesNotMatch(rows, /└/);
});

test('keeps current Session highlight without a leading inset frame', async () => {
  const styles = await readFile(
    new URL('../src/client/worktree.css', import.meta.url),
    'utf8',
  );
  const ruleStart = styles.indexOf(".treeSessionRow[data-session-current='true'] {");
  const ruleEnd = styles.indexOf('}', ruleStart);
  assert.notEqual(ruleStart, -1);
  assert.notEqual(ruleEnd, -1);

  const currentRule = styles.slice(ruleStart, ruleEnd + 1);
  assert.match(currentRule, /background: var\(--dsw-alias-interactive-bg-hover\)/);
  assert.doesNotMatch(currentRule, /box-shadow/);
  assert.match(
    styles,
    /\.treeSessionRow\[data-session-current='true'\] \.treeSessionContent\s*\{[\s\S]*font-weight: 600;/,
  );
});

test('temporarily reveals the current Session path without persisting it', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /const currentSessionId = sessions\.current/);
  assert.match(source, /resolveCurrentSessionLocation/);
  assert.match(source, /currentSessionReveal/);
  assert.match(source, /currentSessionRevealKeys/);
  assert.match(source, /setSearchQuery\(''\)/);
  assert.match(source, /isWorkspaceExpanded\(expandSnapshot,[\s\S]*\|\|/);
  assert.match(source, /isMainExpanded\(expandSnapshot,[\s\S]*\|\|/);
  assert.match(source, /isWorktreeExpanded\([\s\S]*\|\|/);
  assert.match(
    source,
    /isSessionGroupAutoExpanded\(\s*sessionIds,\s*currentSessionId,/,
  );
  assert.match(source, /suppressedKeys/);
  assert.match(source, /expandState\.actions\.toggleWorkspace/);
  assert.match(source, /expandState\.actions\.toggleMain/);
  assert.match(source, /expandState\.actions\.toggleWorktree/);
  assert.doesNotMatch(source, /currentSessionReveal.*localStorage/);
});

test('positions the current Worktree Session after commit and cancels stale work', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );
  const positionSource = await readFile(
    new URL('../src/client/worktree-session-position.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /useLayoutEffect/);
  assert.match(source, /locateGenerationRef/);
  assert.match(source, /positionedLocateGenerationRef/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /cancelAnimationFrame/);
  assert.match(source, /scrollCurrentSessionIntoView/);
  assert.match(source, /generation !== locateGenerationRef\.current/);
  assert.match(positionSource, /querySelectorAll<HTMLElement>\('\[data-session-id\]'\)/);
  assert.match(positionSource, /scrollIntoView\(\{ block: 'nearest' \}\)/);
  assert.doesNotMatch(source, /document\.querySelector/);
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

test('does not expose Worktree plus for removed, repair, or recovery-needed Worktrees', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /record\.status === 'active' && record\.health !== 'repair'/);
  assert.match(source, /record\.health !== 'recovery-needed'/);
});

test('uses the native Project-add icon for the Add Workspace button', async () => {
  const source = await readFile(
    new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /IconProjectAddOutline16/);
  assert.match(
    source,
    /aria-label=\{t\('workspace\.add'\)\}[\s\S]*?<IconProjectAddOutline16 \/>/,
  );
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
