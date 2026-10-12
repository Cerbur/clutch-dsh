import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import * as viewHelpers from '../lib/client/view/worktree-view.js';

test('creation defers branch reads until its picker opens and keeps candidates through lightweight refresh', async () => {
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
        state[i] = deps;
        effects.push(fn);
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
      '../../view/worktree-view.js': viewHelpers,
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
  render().registration.openWorktreeCreator(workspace);
  render();
  let current = render();
  assert.equal(reads, 0);
  assert.equal(current.registration.modalCanCreate, true);
  assert.equal(current.registrationState.selectedBranch, 'main');
  assert.ok(current.registrationState.newBranch.length > 0);
  await current.dialog.onLoadBranches();
  current = render();
  assert.equal(reads, 1);
  assert.deepEqual(current.dialog.view.branches, branches);
  const fetched = await current.dialog.onFetchBranches();
  current = render();
  assert.equal(reads, 1);
  assert.equal(fetches, 1);
  assert.equal(refreshes, 1);
  assert.deepEqual(current.dialog.view.branches, fetched);
  // A refreshed Workspace still omits refs; the modal keeps its independent catalog.
  current.registrationState.modalReadViewRef.current = { ...projection, branches: [] };
  assert.deepEqual(render().dialog.view.branches, fetched);
  current.registration.closeWorktreeCreator();
  render();
  render().registration.openWorktreeCreator(workspace);
  render();
  assert.equal(render().dialog.view.branches.length, 0);
  assert.equal(reads, 1);
});
