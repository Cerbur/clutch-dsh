import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import * as viewHelpers from '../lib/client/view/worktree-view.js';

async function harness() {
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
  const jsx = (type, props) => ({ type, props });
  const modules = {};
  for (const file of ['state/useRegistrationState', 'actions/useWorktreeRegistration', 'components/RegistrationDialog']) {
    const source = await readFile(new URL('../src/client/surface/' + file + '.tsx', import.meta.url), 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    new Function('require', 'exports', output)((name) => ({
      react, 'react/jsx-runtime': { jsx, jsxs: jsx },
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
    } };
  const render = () => {
    cursor = 0;
    const registrationState = modules.useRegistrationState({ props });
    const read = { viewByWorkspace: new Map([['ws', projection]]), refresh: async () => { refreshes++; },
      loadModalWorktreeView: () => { registrationState.modalReadViewRef.current = projection; } };
    const mutation = { actionPending: false, setActionError() {}, setActionPending() {} };
    const registration = modules.useWorktreeRegistration({ source: { workspaces: { items: [workspace] } },
      registrationState, read, props, mutation, session: { setPendingSessionBinding() {} } });
    const dialog = modules.RegistrationDialog({ props, registration, registrationState, read, mutation });
    effects.splice(0).forEach((fn) => fn());
    return { registration, registrationState, dialog: dialog.props.children.props };
  };
  return { render, workspace, props, counts: () => ({ reads, fetches, refreshes }),
    replayEffects() { state.filter((entry) => entry?.setup).forEach((entry) => {
      entry.cleanup?.();
      entry.cleanup = entry.setup();
    }); } };
}

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

for (const operation of ['onLoadBranches', 'onFetchBranches']) {
  for (const outcome of ['success', 'failure']) {
    for (const replacement of ['reopen', 'owner-reopen', 'manager']) {
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
