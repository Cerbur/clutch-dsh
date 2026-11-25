import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import * as notifications from '../lib/client/surface/notification-center.js';
import * as viewHelpers from '../lib/client/view/worktree-view.js';
import { createWorktreeSessionConnector } from '../lib/client/session/worktree-session.js';

async function harness({ onRefresh, onActionError, onModalRead, getMode } = {}) {
  const branchHelpersSource = await readFile(new URL('../src/client/view/worktree-view-read.ts', import.meta.url), 'utf8');
  const branchHelpers = {};
  new Function('require', 'exports', ts.transpileModule(branchHelpersSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText)(() => viewHelpers, branchHelpers);
  const state = [];
  const effects = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state)) state[i] = initial;
      return [state[i], (next) => { state[i] = typeof next === 'function' ? next(state[i]) : next; }];
    },
    useRef(initial) { return react.useState({ current: initial })[0]; },
    useCallback(fn) { return fn; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!state[i] || deps.some((dep, j) => dep !== state[i].deps[j])) state[i] = { deps, value: fn() };
      return state[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!state[i] || deps.some((dep, j) => dep !== state[i][j])) {
        const previous = state[i];
        state[i] = deps;
        state[i].setup = fn;
        effects.push(() => { previous?.cleanup?.(); state[i].cleanup = fn(); });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const modules = {};
  for (const file of ['state/useRegistrationState', 'actions/useWorktreeRegistration', 'components/RegistrationDialog']) {
    const source = await readFile(new URL('../src/client/surface/' + file + '.tsx', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    new Function('require', 'exports', output)((name) => ({
      react, 'react/jsx-runtime': { jsx, jsxs: jsx },
      '../notification-center.js': notifications,
      '../../view/worktree-view.js': { ...viewHelpers, ...branchHelpers },
      '../shared.js': {}, './dialogs.js': { WorktreeCreateDialog: 'dialog' },
    })[name] ?? {}, exports);
    Object.assign(modules, exports);
  }
  const workspace = { workspaceId: 'ws', title: 'Repo', path: '/repo' };
  const projection = { workspaceId: 'ws', branches: [], worktrees: [], bindings: [],
    mainInstructions: '', currentBranch: 'main', readiness: { status: 'ready' } };
  let reads = 0;
  let fetches = 0;
  let refreshes = 0;
  const branches = [{ name: 'main', isCurrent: true }, { name: 'origin/main', kind: 'remote' }];
  const props = { viewReader: { read: async () => projection },
    t: (key) => key,
    manager: {
      listBranches: async () => { reads++; return branches; },
      fetchRemoteBranches: async () => { fetches++; return [...branches, { name: 'origin/new', kind: 'remote' }]; },
      listImportCandidates: async () => [],
    } };
  const render = () => {
    cursor = 0;
    const registrationState = modules.useRegistrationState({ props });
    const read = { viewByWorkspace: new Map([['ws', projection]]), refresh: async (options) => { refreshes++; await onRefresh?.(options); },
      loadModalWorktreeView: (id, options) => { registrationState.modalReadViewRef.current = onModalRead?.(id, options) ?? projection; } };
    const mutation = { actionPending: false, clearActionError() {}, reportActionError: error => { onActionError?.(error); return error; }, setActionPending() {} };
    const registration = modules.useWorktreeRegistration({
      source: {
        ...(getMode ? { mode: getMode() } : {}),
        workspaces: { items: [workspace] },
      },
      registrationState, read, props, mutation, session: { setPendingSessionBinding() {} },
    });
    const dialog = modules.RegistrationDialog({ props, registration, registrationState, read, mutation });
    effects.splice(0).forEach((fn) => fn());
    return { registration, registrationState, dialog: dialog.props.children.props,
      dialogKey: dialog.props.children.key ?? dialog.props.children.props.key };
  };
  return { render, workspace, props, projection, counts: () => ({ reads, fetches, refreshes }),
    replayEffects() { state.filter((entry) => entry?.setup).forEach((entry) => {
      entry.cleanup?.();
      entry.cleanup = entry.setup();
    }); } };
}

test('a registered checkout stays visible for a Session retry when Forge rejects the first creation', async () => {
  const registered = [];
  const refreshed = [];
  const errors = [];
  const { render, workspace, props, projection } = await harness({
    onActionError: error => errors.push(error),
    onRefresh(options) {
      refreshed.push(options);
      projection.worktrees = [...registered];
    },
  });
  const record = { workspaceId: 'ws', worktreeId: 'created', absolutePath: '/created', branch: 'feature', status: 'active' };
  props.manager.createWorktree = async () => { registered.push(record); return record; };
  props.manager.listWorktrees = async () => registered;
  props.manager.listBindings = async () => [];
  let available = false;
  const created = [];
  const opened = [];
  const requests = [];
  const connector = createWorktreeSessionConnector({
    manager: props.manager, sessions: { getSnapshot: () => ({ phase: 'ready', ids: [], byId: {} }) },
    archivedSessionIds: () => [], openSession: id => opened.push(id),
    async createBoundSession(input) {
      requests.push(input.requestId);
      if (!available) throw Object.assign(new Error('Forge panel is disabled'), {
        code: 'WORKTREE_FORGE_UNAVAILABLE', details: { reason: 'disabled' },
      });
      created.push(input.worktreeId);
      return { bound: true, sessionId: 'first-session' };
    },
  });
  props.createSessionForWorktree = connector.create;
  render().registration.openWorktreeCreator(workspace);
  render();
  await render().registration.submitWorktree();
  assert.deepEqual(refreshed, [{ scope: { kind: 'workspace', workspaceId: 'ws' }, preserveCurrent: true }]);
  assert.deepEqual(projection.worktrees, [record]);
  assert.deepEqual(errors.at(-1), {
    code: 'WORKTREE_FORGE_UNAVAILABLE', message: 'Forge panel is disabled', retryable: true,
    details: { reason: 'disabled', workspaceId: 'ws' },
  });
  assert.deepEqual(created, []);
  available = true;
  const [row] = projection.worktrees;
  const plus = () => props.createSessionForWorktree({ workspaceId: row.workspaceId, worktreeId: row.worktreeId, cwd: row.absolutePath });
  await Promise.all([plus(), plus()]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1], requests[0]);
  assert.deepEqual(registered, [record]);
  assert.deepEqual(created, ['created']);
  assert.deepEqual(opened, ['first-session']);
});

test('a Workspace removed after opening Create is revalidated in the same dialog', async () => {
  const failure = { code: 'WORKSPACE_ROOT_MISSING', message: 'missing', details: { rootPath: '/repo' }, retryable: true };
  const errors = [], reads = [];
  const { render, workspace, props, projection } = await harness({
    onActionError: error => errors.push(error),
    onModalRead(id, options) {
      reads.push([id, options]);
      if (options?.revalidate) return { ...projection, readiness: { status: 'workspaceMissing', error: failure } };
    },
  });
  props.manager.createWorktree = async () => { throw failure; };
  render().registration.openWorktreeCreator(workspace);
  render();
  await render().registration.submitWorktree();
  assert.deepEqual(reads, [['ws', undefined], ['ws', { revalidate: true }]]);
  assert.deepEqual(errors.at(-1), failure);
  assert.equal(render().dialog.setupStatus, 'workspaceMissing');
  assert.equal(render().dialog.canCreate, false);
});

test('HEAD creation carries the observed commit from the modal projection', async () => {
  const { render, workspace, props, projection } = await harness();
  projection.checkout = { currentHead: { kind: 'tag', name: 'v1.0.0', commit: 'a'.repeat(40) } };
  const requests = [];
  props.manager.createWorktree = async (input) => {
    requests.push(input);
    return { workspaceId: 'ws', worktreeId: 'created', absolutePath: '/created' };
  };
  render().registration.openWorktreeCreator(workspace);
  render();
  let current = render();
  current.registrationState.setSelectedBranch('HEAD');
  current = render();
  await current.registration.submitWorktree();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].fromHead, true);
  assert.equal(requests[0].expectedHeadCommit, projection.checkout.currentHead.commit);
});

test('creation defers branch reads until its picker opens and keeps candidates through lightweight refresh', async () => {
  const { render, workspace, counts } = await harness();
  render().registration.openWorktreeCreator(workspace);
  render();
  let current = render();
  assert.equal(counts().reads, 0);
  assert.equal(current.registration.modalCanCreate, true);
  assert.equal(current.registrationState.selectedBranch, 'main');
  assert.ok(current.registrationState.newBranch.length > 0);
  await current.dialog.onLoadBranches();
  current = render();
  assert.equal(counts().reads, 1);
  assert.deepEqual(current.dialog.view.branches.map((branch) => branch.name), ['main', 'origin/main']);
  const fetched = await current.dialog.onFetchBranches();
  current = render();
  assert.deepEqual(counts(), { reads: 1, fetches: 1, refreshes: 1 });
  assert.deepEqual(current.dialog.view.branches, fetched);
  // A refreshed Workspace still omits refs; the modal keeps its independent catalog.
  current.registrationState.modalReadViewRef.current = { ...current.dialog.view, branches: [] };
  assert.deepEqual(render().dialog.view.branches, fetched);
  current.registration.closeWorktreeCreator();
  render();
  render().registration.openWorktreeCreator(workspace);
  render();
  assert.equal(render().dialog.view.branches.length, 0);
  assert.equal(counts().reads, 1);
});

test('Registration callbacks remain usable after development effect replay', async () => {
  const { render, workspace, replayEffects } = await harness();
  render().registration.openWorktreeCreator(workspace);
  render();
  const current = render();
  replayEffects();
  await current.dialog.onLoadBranches();
  assert.deepEqual(render().dialog.view.branches.map((branch) => branch.name), ['main', 'origin/main']);
});

test('switching registration tabs retains the dialog shell and retires prior branch callbacks', async () => {
  const { render, workspace, props, counts } = await harness();
  props.manager.listImportCandidates = async () => [];
  let settle;
  props.manager.listBranches = () => new Promise((resolve) => { settle = resolve; });
  render().registration.openWorktreeCreator(workspace);
  render();
  const initial = render();
  const delayed = initial.dialog.onLoadBranches();
  initial.dialog.onModeChange('import');
  let current = render();
  assert.equal(current.dialog.mode, 'import');
  assert.equal(current.dialogKey, initial.dialogKey, 'tab changes must not remount the Modal');
  await Promise.resolve();
  current.dialog.onModeChange('create');
  current = render();
  assert.equal(current.dialogKey, initial.dialogKey);
  settle([{ name: 'old-result' }]);
  await delayed;
  assert.equal(render().dialog.view.branches.length, 0);
  await initial.dialog.onFetchBranches();
  assert.equal(counts().fetches, 0, 'stale tab callbacks must remain inactive');
  current.dialog.onClose();
  current.registration.openWorktreeCreator(workspace);
  assert.notEqual(render().dialogKey, initial.dialogKey, 'batched close/reopen starts a new dialog lifetime');
});

for (const operation of ['onLoadBranches', 'onFetchBranches']) {
  for (const outcome of ['success', 'failure']) {
    for (const replacement of ['reopen', 'owner-reopen', 'manager', 'tab']) {
      test(`${operation} late ${outcome} cannot update a ${replacement} dialog for the same Workspace`, async () => {
        const { render, workspace, props, counts } = await harness();
        let settle;
        const delayed = new Promise((resolve, reject) => { settle = outcome === 'success' ? resolve : reject; });
        props.manager[operation === 'onLoadBranches' ? 'listBranches' : 'fetchRemoteBranches'] = () => delayed;
        render().registration.openWorktreeCreator(workspace);
        render();
        const old = render();
        const request = old.dialog[operation]().catch(() => undefined);
        if (replacement === 'reopen' || replacement === 'owner-reopen') {
          // Close/reopen before a render as well as after one: Workspace equality is insufficient.
          if (replacement === 'owner-reopen') old.registration.closeWorktreeCreator();
          else old.dialog.onClose();
          old.registration.openWorktreeCreator(workspace);
        } else if (replacement === 'tab') {
          old.dialog.onModeChange('import');
          render().dialog.onModeChange('create');
        } else {
          props.manager = { ...props.manager };
        }
        let current = render();
        const fresh = [{ name: 'main' }, { name: 'origin/fresh', kind: 'remote' }];
        current.registrationState.setModalBranches(fresh);
        current.registrationState.setSelectedBranch('origin/fresh');
        current.registrationState.setNewBranch('my-branch');
        render();
        const failure = Object.assign(new Error('old auth failure'), { code: 'GIT_OPERATION_FAILED', details: { gitStderr: 'old auth' } });
        settle(outcome === 'success' ? [{ name: 'origin/obsolete', kind: 'remote' }] : failure);
        await request;
        current = render();
        assert.deepEqual(current.dialog.view.branches, fresh);
        assert.equal(current.dialog.selectedBranch, 'origin/fresh');
        assert.equal(current.dialog.newBranch, 'my-branch');
        assert.equal(current.dialog.readError, undefined);
        assert.equal(counts().refreshes, 0);
      });
    }
  }
}

test('Registration preserves full-ref choices through list and Fetch and resolves only unique legacy names', async () => {
  const { render, workspace, props } = await harness();
  const branches = [
    { name: 'main', ref: 'refs/heads/main', isCurrent: true },
    { name: 'origin/main', ref: 'refs/heads/origin/main' },
    { name: 'origin/main', ref: 'refs/remotes/origin/main', kind: 'remote' },
    { name: 'origin/unique', ref: 'refs/remotes/origin/unique', kind: 'remote' },
  ];
  props.manager.listBranches = async () => branches;
  props.manager.fetchRemoteBranches = async () => [...branches];
  render().registration.openWorktreeCreator(workspace);
  render();
  await render().dialog.onLoadBranches();
  render();
  assert.equal(render().dialog.selectedBranch, 'main');
  for (const ref of ['refs/heads/origin/main', 'refs/remotes/origin/main']) {
    render().dialog.onSelectedBranchChange(ref);
    await render().dialog.onFetchBranches();
    render();
    assert.equal(render().dialog.selectedBranch, ref);
    await render().dialog.onLoadBranches();
    render();
    assert.equal(render().dialog.selectedBranch, ref);
  }
  render().dialog.onSelectedBranchChange('origin/unique');
  await render().dialog.onLoadBranches();
  render();
  assert.equal(render().dialog.selectedBranch, 'origin/unique');
  render().dialog.onSelectedBranchChange('origin/main');
  await render().dialog.onLoadBranches();
  render();
  assert.equal(render().dialog.selectedBranch, 'origin/main');
});

test('opening Create revalidates workspaceMissing, stale branch conflict retires quietly, and import retry resolves', async () => {
  const { worktreeDiagnostics } = await import('../lib/client/settings/diagnostics.js');
  notifications.worktreeNotifications.dispose();
  const reads = [];
  const actionErrors = [];
  const { render, workspace, props, projection } = await harness({
    onActionError: (error) => actionErrors.push(error),
    onModalRead: (id, options) => {
      reads.push([id, options]);
      return { ...projection };
    },
  });
  projection.readiness = { status: 'workspaceMissing', error: { code: 'WORKSPACE_ROOT_MISSING', message: 'gone', retryable: false } };
  render().registration.openWorktreeCreator(workspace);
  render();
  assert.deepEqual(reads, [['ws', { revalidate: true }]]);

  projection.readiness = { status: 'ready' };
  let rejectCreate;
  props.manager.createWorktree = () => new Promise((_, reject) => { rejectCreate = reject; });
  render().registration.openWorktreeCreator(workspace);
  render();
  const submitted = render().registration.submitWorktree();
  render().registration.closeWorktreeCreator(true);
  rejectCreate({ code: 'WORKTREE_BRANCH_CONFLICT', message: 'branch exists', retryable: false });
  await submitted;
  await Promise.resolve();
  assert.deepEqual(actionErrors, [], 'stale WORKTREE_BRANCH_CONFLICT must not trigger reportActionError');
  const conflictEntry = worktreeDiagnostics.getSnapshot().find((entry) => entry.error?.code === 'WORKTREE_BRANCH_CONFLICT');
  assert.equal(conflictEntry.status, 'inactive');
  assert.equal(notifications.worktreeNotifications.getSnapshot(), undefined);

  let failImports = true;
  props.manager.listImportCandidates = async () => {
    if (failImports) throw { code: 'GIT_OPERATION_FAILED', message: 'import failed', retryable: true };
    return [];
  };
  render().registration.openWorktreeCreator(workspace);
  render();
  await render().registration.loadImportCandidates('ws');
  await Promise.resolve();
  const importEntry = worktreeDiagnostics.getSnapshot().find((entry) => entry.error?.code === 'GIT_OPERATION_FAILED');
  assert.equal(importEntry.status, 'reported');
  failImports = false;
  await render().registration.loadImportCandidates('ws');
  await Promise.resolve();
  assert.equal(worktreeDiagnostics.getSnapshot().find((entry) => entry.reportId === importEntry.reportId).status, 'resolved');
  notifications.worktreeNotifications.dispose();
});

test('leaving Worktree mode retires in-flight submitWorktree errors and repeated retries resolve all prior reports', async () => {
  const { worktreeDiagnostics } = await import('../lib/client/settings/diagnostics.js');
  notifications.worktreeNotifications.dispose();
  let mode = 'worktree';
  const modalReads = [];
  const actionErrors = [];
  const { render, workspace, props, projection } = await harness({
    getMode: () => mode,
    onActionError: (error) => actionErrors.push(error),
    onModalRead: (id, options) => {
      modalReads.push([id, options]);
      return { ...projection };
    },
  });

  // 1. Mode switch to Native while WORKSPACE_ROOT_MISSING is in-flight must not revalidate modal or report active error.
  let rejectCreate;
  props.manager.createWorktree = () => new Promise((_, reject) => { rejectCreate = reject; });
  render().registration.openWorktreeCreator(workspace);
  render();
  modalReads.length = 0;
  const missingSubmit = render().registration.submitWorktree();
  mode = 'native';
  render();
  rejectCreate({ code: 'WORKSPACE_ROOT_MISSING', message: 'gone', details: { rootPath: '/repo' }, retryable: false });
  await missingSubmit;
  await Promise.resolve();
  assert.deepEqual(modalReads, [], 'stale modal after mode switch must not trigger loadModalWorktreeView');
  assert.deepEqual(actionErrors, []);
  assert.deepEqual(
    worktreeDiagnostics.getSnapshot().map((entry) => [entry.error?.code, entry.status]),
    [['WORKSPACE_ROOT_MISSING', 'inactive']],
  );
  assert.equal(notifications.worktreeNotifications.getSnapshot(), undefined);

  // 2. Mode switch to Native while WORKTREE_BRANCH_CONFLICT is in-flight must retire quietly without setting branchConflict.
  notifications.worktreeNotifications.dispose();
  mode = 'worktree';
  render().registration.openWorktreeCreator(workspace);
  render();
  const conflictSubmit = render().registration.submitWorktree();
  mode = 'native';
  render();
  rejectCreate({ code: 'WORKTREE_BRANCH_CONFLICT', message: 'exists', retryable: false });
  await conflictSubmit;
  await Promise.resolve();
  assert.equal(render().registrationState.branchConflict, undefined);
  assert.deepEqual(actionErrors, []);
  assert.deepEqual(
    worktreeDiagnostics.getSnapshot().map((entry) => [entry.error?.code, entry.status]),
    [['WORKTREE_BRANCH_CONFLICT', 'inactive']],
  );
  assert.equal(notifications.worktreeNotifications.getSnapshot(), undefined);

  // 3. Repeated WORKTREE_BRANCH_CONFLICT failures all resolve once createWorktree succeeds.
  notifications.worktreeNotifications.dispose();
  mode = 'worktree';
  let conflictFailures = 2;
  props.manager.createWorktree = async () => {
    if (conflictFailures > 0) {
      conflictFailures -= 1;
      throw { code: 'WORKTREE_BRANCH_CONFLICT', message: 'branch exists', retryable: false };
    }
    return { workspaceId: 'ws', worktreeId: 'created', absolutePath: '/created', branch: 'feat', status: 'active' };
  };
  render().registration.openWorktreeCreator(workspace);
  render();
  await render().registration.submitWorktree();
  await render().registration.submitWorktree();
  await Promise.resolve();
  assert.equal(worktreeDiagnostics.getSnapshot().length, 2);
  await render().registration.submitWorktree();
  await Promise.resolve();
  assert.deepEqual(worktreeDiagnostics.getSnapshot().map((entry) => entry.status), ['resolved', 'resolved']);

  // 4. Repeated listImportCandidates failures all resolve once a later read succeeds.
  notifications.worktreeNotifications.dispose();
  let importFailures = 2;
  props.manager.listImportCandidates = async () => {
    if (importFailures > 0) {
      importFailures -= 1;
      throw { code: 'GIT_OPERATION_FAILED', message: 'import failed', retryable: true };
    }
    return [];
  };
  render().registration.openWorktreeCreator(workspace);
  render();
  await render().registration.loadImportCandidates('ws');
  await render().registration.loadImportCandidates('ws');
  await Promise.resolve();
  assert.equal(worktreeDiagnostics.getSnapshot().length, 2);
  await render().registration.loadImportCandidates('ws');
  await Promise.resolve();
  assert.deepEqual(worktreeDiagnostics.getSnapshot().map((entry) => entry.status), ['resolved', 'resolved']);
  notifications.worktreeNotifications.dispose();
});
