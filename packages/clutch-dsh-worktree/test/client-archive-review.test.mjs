import { readSurfaceSource } from './client-surface-source.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { aggregateSessionStatus } from '../lib/client/session/session-view.js';
import { bindingIdsFor } from '../lib/client/surface/selectors.js';
import { filterArchivedSessionIds } from '../lib/client/view/worktree-view.js';

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
    (attr) => attr.name?.text === 'groupActivityStatus',
  ).initializer.expression;
  const context = {
    aggregateSessionStatus,
    bindingIdsFor,
    filterArchivedSessionIds,
    archivedWorktrees: [{ worktreeId: 'wt' }],
    bindings: [{ worktreeId: 'wt', sessionId: 's', status: 'active' }],
    sessions: { ids: ['s'] },
    archivedSessionIds: ['s'],
    sessionPresentations: {
      s: {
        status: { state: 'ongoing', labelKey: 'running', runningSubagentCount: 0 },
        ongoing: true,
        completed: false,
      },
    },
  };
  assert.equal(evaluate(`return ${expression.getText(ast)};`, context), undefined);
  context.archivedSessionIds = [];
  assert.deepEqual(evaluate(`return ${expression.getText(ast)};`, context), {
    state: 'ongoing',
    labelKey: 'running',
    runningSubagentCount: 0,
  });
});
