import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import React from 'react';
import ts from 'typescript';
import { createWorktreeRefreshGuard, createWorktreeViewReader, mergeWorktreeView } from '../lib/client/worktree-view-read.js';

const source = await readFile(
  new URL('../src/client/WorktreeSurface.tsx', import.meta.url),
  'utf8',
);
const ast = ts.createSourceFile(
  'surface.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function find(predicate, node = ast) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(predicate, child));
}
function evaluate(code, context) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(context), js)(...Object.values(context));
}
const declaration = (name) =>
  `const ${find((n) => ts.isVariableDeclaration(n) && n.name.getText(ast) === name).getText(ast)};`;
const record = {
  workspaceId: 'ws1',
  worktreeId: 'wt1',
  branch: 'feature/foo',
  currentBranch: 'merge/foo',
  health: 'branch-drift',
  mutationToken: 'token',
};

test('sibling creation follows the live branch and excludes detached HEAD', () => {
  const property = find((n) => ts.isPropertyAssignment(n) &&
    n.name.getText(ast) === 'onCreateWorktree' &&
    n.initializer.getText(ast).includes('record.status'));
  for (const [currentBranch, expected] of [['merge/foo', 'merge/foo'], [undefined, 'feature/foo'], [null, undefined]]) {
    let options;
    const context = {
      record: { ...record, status: 'active', currentBranch },
      workspace: { workspaceId: 'ws1' },
      workspaceWorktreeNames: [],
      createNumberedWorktreeName: (branch) => `${branch}-2`,
      openWorktreeCreator: (_workspace, value) => { options = value; },
    };
    const action = evaluate(`return (${property.initializer.getText(ast)});`, context);
    const showCreate = property.parent.properties.find((node) => node.name?.getText(ast) === 'showCreate');
    assert.equal(evaluate(`return (${showCreate.initializer.getText(ast)});`, context), currentBranch !== null);
    action?.();
    assert.equal(options?.baseBranch, expected);
    assert.equal(action !== undefined, currentBranch !== null);
    if (expected) assert.equal(options.newBranch, `${expected}-2`);
  }
});

test('active and archived menu opens share the owning Workspace read', async () => {
  const properties = [];
  function collect(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'onOpenChange' &&
      node.initializer.getText(ast).includes('setOpenWorktreeMenuId')) properties.push(node);
    ts.forEachChild(node, collect);
  }
  collect(ast);
  const calls = { worktrees: 0, branches: 0, bindings: 0 };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const reader = createWorktreeViewReader({
    listWorktrees: async () => { calls.worktrees++; await gate; return []; },
    listBranches: async () => { calls.branches++; await gate; return []; },
    listBindings: async () => { calls.bindings++; await gate; return []; },
  });
  const pending = [];
  for (const property of properties) {
    const onOpenChange = evaluate(`return (${property.initializer.getText(ast)});`, {
      record, setOpenWorktreeMenuId() {}, refresh: (options) => {
        assert.deepEqual(options.scope, { kind: 'workspace', workspaceId: 'ws1' });
        assert.equal(options.preserveCurrent, true);
        assert.equal(options.invalidateContext, false);
        reader.invalidate('ws1', { reuseInFlight: options.reuseInFlight });
        const result = reader.read('ws1');
        pending.push(result);
        return result;
      },
    });
    onOpenChange(false);
    onOpenChange(true);
    onOpenChange(true);
  }
  assert.equal(pending.length, 4);
  assert.deepEqual(calls, { worktrees: 1, branches: 1, bindings: 1 });
  release();
  await Promise.all(pending);
});

test('adoption failures are visible inside the dialog with a refresh action', async () => {
  const text = await readFile(new URL('../src/client/worktree-surface-dialogs.tsx', import.meta.url), 'utf8');
  const file = ts.createSourceFile('dialogs.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'WorktreeAdoptBranchDialog', file);
  const render = evaluate(`${fn.getText(file).replace('export ', '')}; return WorktreeAdoptBranchDialog;`, {
    React, Modal: 'modal', Button: 'button', styles: {}, formatWorktreeViewError: (error) => error.message,
  });
  let refreshed = false;
  const element = render({ t: (key) => key, worktree: record, actionPending: false,
    error: { code: 'WORKTREE_STATE_CONFLICT', message: 'Branch changed' },
    onClose() {}, onSubmit() {}, onRetry: () => { refreshed = true; },
  });
  const nodes = [];
  function walk(value) {
    if (!React.isValidElement(value)) return;
    nodes.push(value);
    React.Children.forEach(value.props.children, walk);
  }
  walk(element);
  const alert = nodes.find((node) => node.props.role === 'alert');
  assert.ok(alert, 'error must be rendered in the modal');
  const retry = nodes.find((node) => node.props.onClick && node.props.children === 'action.retry');
  assert.ok(retry, 'failed confirmation must offer refresh before reconfirmation');
  assert.equal(React.Children.toArray(element.props.footer.props.children).at(-1).props.disabled, true);
  retry.props.onClick();
  assert.equal(refreshed, true);
});

for (const outcome of ['changed', 'detached', 'missing', 'offline', 'disposed', 'workspace-removed']) {
  test(`adoption retry handles ${outcome} without discarding unrelated ready content`, async () => {
    const guard = createWorktreeRefreshGuard();
    const otherView = { workspaceId: 'ws2', worktrees: [] };
    const latest = { ...record, currentBranch: 'merge/bar', mutationToken: 'fresh',
      ...(outcome === 'detached' ? { currentBranch: null } : {}),
    };
    const view = { workspaceId: 'ws1', worktrees: outcome === 'missing' ? [] : [latest] };
    let state = { status: 'ready', views: [{ workspaceId: 'ws1', worktrees: [record] }, otherView] };
    const before = state;
    let target = record;
    let error = { message: 'Stale confirmation' };
    let pending;
    const retry = evaluate(`${declaration('refreshBranchAdoption')} return refreshBranchAdoption;`, {
      worktreeBranchAdoption: target, manager: {},
      branchAdoptionGuard: { current: guard },
      workspaceIdsRef: { current: outcome === 'workspace-removed' ? ['ws2'] : ['ws1', 'ws2'] },
      setActionPending: (value) => { pending = value; },
      refresh: async (options) => {
        assert.deepEqual(options, { scope: { kind: 'workspace', workspaceId: 'ws1' }, preserveCurrent: true });
        if (outcome === 'disposed') guard.invalidate();
      },
      viewReader: { read: async (workspaceId) => {
        assert.equal(workspaceId, 'ws1');
        if (outcome === 'offline') throw new Error('offline');
        return view;
      } },
      setReadState: (update) => { state = update(state); },
      mergeWorktreeView,
      setWorktreeBranchAdoption: (value) => { target = value; },
      setActionError: (value) => { error = value; }, toWorktreeViewError: (value) => value,
    });
    await retry();
    assert.equal(state.status, 'ready');
    assert.equal(state.views[1], otherView);
    if (outcome === 'workspace-removed') {
      assert.equal(state, before);
      assert.equal(target, undefined);
    } else if (outcome === 'offline' || outcome === 'disposed') {
      assert.equal(state, before);
      assert.equal(target, record);
      assert.equal(error.message, outcome === 'offline' ? 'offline' : 'Stale confirmation');
    } else {
      assert.equal(error, undefined);
      assert.equal(target, outcome === 'changed' ? latest : undefined);
      assert.equal(state.views[0], view);
    }
    if (outcome !== 'disposed') assert.equal(pending, false);
  });
}

test('production branch menu selects confirmation, displays detached HEAD, and targets recovery', async () => {
  let selected;
  let recovery;
  let refreshOptions;
  const { branchActions, branchLabel } = evaluate(
    `${declaration('branchActions')} ${declaration('branchLabel')} return { branchActions, branchLabel };`,
    {
      t: (key) => key,
      setWorktreeBranchAdoption: (r) => {
        selected = r;
      },
      setActionError: () => {},
      manager: {
        recoverWorktrees: async (input) => {
          recovery = input;
        },
      },
      runMutation: async (operation, options) => {
        refreshOptions = options;
        await operation();
      },
    },
  );
  branchActions(record).onAdoptBranch();
  assert.equal(selected, record);
  assert.equal(branchLabel(record), 'feature/foo → merge/foo');
  assert.equal(branchActions({ ...record, currentBranch: null }).onAdoptBranch, undefined);
  assert.equal(
    branchLabel({ ...record, currentBranch: null }),
    'feature/foo → worktree.detachedHead',
  );
  assert.equal(branchActions({ ...record, health: 'ready' }).onAdoptBranch, undefined);
  branchActions({ ...record, health: 'recovery-needed' }).onRecover();
  await Promise.resolve();
  assert.deepEqual(recovery, { workspaceId: 'ws1' });
  assert.deepEqual(refreshOptions, {
    scope: { kind: 'workspace', workspaceId: 'ws1' },
    preserveCurrent: true,
  });
});

test('production adoption handler carries confirmed branch/token and preserves ready content on refresh failure', async () => {
  const node = find(
    (n) => ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'WorktreeAdoptBranchDialog',
  );
  const calls = [];
  let error;
  let target = record;
  const element = evaluate(`${declaration('runMutation')} return (${node.getText(ast)});`, {
    React,
    WorktreeAdoptBranchDialog: 'dialog',
    t: (key) => key,
    worktreeBranchAdoption: target,
    actionPending: false,
    actionError: undefined,
    setActionPending: (value) => {
      calls.push(['pending', value]);
    },
    setActionError: (value) => {
      error = value;
    },
    toWorktreeViewError: (value) => value,
    manager: {
      adoptWorktreeBranch: async (input) => {
        calls.push(['adopt', input]);
      },
    },
    setWorktreeBranchAdoption: (value) => {
      target = value;
    },
    refresh: async (options) => {
      calls.push(['refresh', options]);
      throw new Error('offline');
    },
  });
  element.props.onSubmit();
  // The handler intentionally starts a void promise; flush its asynchronous steps.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(target, undefined);
  assert.deepEqual(calls.find(([kind]) => kind === 'adopt')[1], {
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    mutationToken: 'token',
    expectedBranch: 'merge/foo',
  });
  assert.deepEqual(calls.find(([kind]) => kind === 'refresh')[1], {
    scope: { kind: 'workspace', workspaceId: 'ws1' },
    preserveCurrent: true,
  });
  assert.equal(error.message, 'offline');
  assert.deepEqual(calls.at(-1), ['pending', false]);
});

test('production adoption dialog names the accepted and current branches before confirmation', async () => {
  const text = await readFile(
    new URL('../src/client/worktree-surface-dialogs.tsx', import.meta.url),
    'utf8',
  );
  const file = ts.createSourceFile(
    'dialogs.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const fn = find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'WorktreeAdoptBranchDialog',
    file,
  );
  const render = evaluate(
    `${fn.getText(file).replace('export ', '')}; return WorktreeAdoptBranchDialog;`,
    { React, Modal: 'modal', Button: 'button' },
  );
  const element = render({
    t: (key, values) => ({ key, values }),
    worktree: record,
    actionPending: false,
    onClose() {},
    onSubmit() {},
  });
  assert.deepEqual(element.props.description.values, {
    previous: 'feature/foo',
    current: 'merge/foo',
  });
  assert.equal(render({ worktree: { ...record, currentBranch: null } }), null);
});
