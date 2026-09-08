import { readSurfaceSource } from './client-surface-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';
import { hasOngoingSession } from '../lib/client/session/session-view.js';
import { bindingIdsFor } from '../lib/client/surface/selectors.js';
import { filterArchivedSessionIds } from '../lib/client/view/worktree-view.js';
import { createWorktreeRefreshGuard } from '../lib/client/view/worktree-view-read.js';

// Execute the actual surface JSX and its event handler without mounting DSH's
// browser-only shell. React elements retain the production onClick callback.
const source = await readSurfaceSource([
  'components/ArchivedWorktrees.tsx',
  'components/SurfaceContent.tsx',
  'actions/useLifecycleActions.tsx',
]);
const ast = ts.createSourceFile(
  'surface.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function find(predicate, root = ast) {
  if (predicate(root)) return root;
  return ts.forEachChild(root, (node) => find(predicate, node));
}
function evaluate(code, context) {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(context), js)(...Object.values(context));
}
function elements(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...React.Children.toArray(node.props?.children).flatMap(elements)];
}

test('Archived group ignores native archived activity but retains hidden live activity', () => {
  const row = find(
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.attributes.properties.some(
        (attr) =>
          ts.isJsxAttribute(attr) &&
          attr.name.text === 'kind' &&
          attr.initializer?.text === 'archived-group',
      ),
  );
  const expression = row.attributes.properties.find(
    (attr) => attr.name?.text === 'hasOngoingSession',
  ).initializer.expression;
  const context = {
    hasOngoingSession,
    bindingIdsFor,
    filterArchivedSessionIds,
    archivedWorktrees: [{ worktreeId: 'wt' }],
    bindings: [{ worktreeId: 'wt', sessionId: 's', status: 'active' }],
    sessions: { ids: ['s'] },
    archivedSessionIds: ['s'],
    sessionPresentations: { s: { ongoing: true } },
  };
  assert.equal(evaluate(`return ${expression.getText(ast)};`, context), false);
  context.archivedSessionIds = [];
  assert.equal(evaluate(`return ${expression.getText(ast)};`, context), true);
});

function permissionFixture(normalize) {
  const notice = {
    workspaceId: 'ws',
    worktreeId: 'wt',
    result: { status: 'unverified', retryable: true },
  };
  const record = {
    workspaceId: 'ws',
    worktreeId: 'wt',
    status: 'removed',
    diskCleanup: 'completed',
  };
  const published = [];
  const context = {
    React,
    styles: {},
    t: (key) => key,
    formatWorktreePermissionNotice: (result) => result.status,
    permissionNoticeSnapshot: notice,
    permissionNotice: { getSnapshot: () => notice },
    permission: { normalizeDetachedWorktreePermissions: normalize },
    onPermissionNotice: (target, result) => published.push({ target, result }),
    mode: 'worktree',
    actionPending: false,
    setActionPending: (value) => {
      context.actionPending = value;
    },
    cleanupGuard: { current: createWorktreeRefreshGuard() },
    permissionRetryPending: { current: false },
    readStateRef: { current: { views: [{ workspaceId: 'ws', worktrees: [record] }] } },
    viewByWorkspace: new Map([['ws', { worktrees: [record] }]]),
  };
  const declaration = (name) =>
    find((node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === name);
  const noticeJsx = find(
    (node) =>
      ts.isJsxExpression(node) &&
      ts.isBinaryExpression(node.expression ?? {}) &&
      node.expression.left.getText(ast) === 'permissionNoticeSnapshot !== undefined',
  );
  const render = () =>
    evaluate(
      [
        ...['permissionRetryTarget', 'retryCleanupPermissions'].flatMap((name) => {
          const node = declaration(name);
          return node ? [`const ${node.getText(ast)};`] : [];
        }),
        `return ${noticeJsx.expression.getText(ast)};`,
      ].join('\n'),
      context,
    );
  const button = () => elements(render()).find((element) => element.type === 'button');
  return { context, published, button };
}

test('permission notice retry invokes only normalization and publishes its result', async () => {
  const calls = [];
  const fixture = permissionFixture(async (input) => {
    calls.push(input);
    return { status: 'normalized-workspace-write', retryable: false };
  });
  const button = fixture.button();
  assert.ok(button, 'cleanup permission notice must expose a retry button');
  await button.props.onClick();
  assert.deepEqual(calls, [{ workspaceId: 'ws', worktreeId: 'wt' }]);
  assert.equal(fixture.published[0].result.status, 'normalized-workspace-write');
  assert.equal(fixture.context.actionPending, false);
});

test('permission retry rejection remains retryable without repeating disk cleanup', async () => {
  const fixture = permissionFixture(async () => {
    throw new Error('offline');
  });
  assert.ok(fixture.button(), 'retry button is present');
  await fixture.button().props.onClick();
  assert.deepEqual(fixture.published[0].result, { status: 'unverified', retryable: true });
});

test('permission retry preserves business failures and only offers cleanup retry for cleaned targets', async () => {
  const failure = { status: 'unverified', retryable: true, sessionIds: ['s'] };
  const fixture = permissionFixture(async () => failure);
  assert.ok(fixture.button());
  await fixture.button().props.onClick();
  assert.deepEqual(fixture.published[0].result, failure);
  fixture.context.permissionNoticeSnapshot.result.retryable = false;
  assert.equal(fixture.button(), undefined);
  fixture.context.permissionNoticeSnapshot.result.retryable = true;
  delete fixture.context.viewByWorkspace.get('ws').worktrees[0].diskCleanup;
  assert.equal(fixture.button(), undefined);
});

test('permission retry drops late results after forget or disposal and coalesces repeated clicks', async () => {
  for (const invalidate of [
    (context) => {
      context.readStateRef.current.views[0].worktrees = [];
    },
    (context) => {
      context.cleanupGuard.current.invalidate();
    },
    (context) => {
      context.permissionNotice.getSnapshot = () => undefined;
    },
  ]) {
    let resolve;
    let calls = 0;
    const fixture = permissionFixture(() => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const button = fixture.button();
    assert.ok(button, 'retry button is present');
    const first = button.props.onClick();
    await button.props.onClick();
    assert.equal(calls, 1);
    invalidate(fixture.context);
    resolve({ status: 'normalized-workspace-write', retryable: false });
    await first;
    assert.deepEqual(fixture.published, []);
  }
});
