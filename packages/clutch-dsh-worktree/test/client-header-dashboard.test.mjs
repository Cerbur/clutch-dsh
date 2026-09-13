import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/client/dashboard/DashboardHeaderAction.tsx', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
const exports = {};
new Function('require', 'exports', output)(
  (name) =>
    ({
      'react/jsx-runtime': { jsx, jsxs: jsx },
      '@deepseek-ai/dsh-client-ui-primitives': {
        Tooltip: ({ children }) => children,
      },
      './dashboard-icon.js': {
        IconDashboard: ({ size }) => jsx('svg', { size }),
      },
      './dashboard-header-action.css': {
        default: { headerDashboardButton: 'headerDashboardButton' },
      },
    })[name] ?? {},
  exports,
);

const worktreeState = {
  status: 'ready',
  sessionId: 'session-current',
  workspaceId: 'workspace-current',
  value: {
    kind: 'worktree',
    workspaceId: 'workspace-current',
    worktreeId: 'worktree-one',
    label: 'feature/dashboard',
    source: 'active-binding',
  },
};

function render(state = worktreeState, sessionId = 'session-current') {
  const opened = [];
  const node = exports.DashboardHeaderAction({
    sessionId,
    useWorktreeContext: (select) => select(state),
    openDashboard: (id) => opened.push(id),
    t: (key) => key,
  });
  return { node, opened };
}

test('renders an accessible Dashboard icon for the current Worktree Session', () => {
  const { node, opened } = render();
  assert.equal(node.type, 'button');
  assert.equal(node.props.type, 'button');
  assert.equal(node.props.className, 'headerDashboardButton');
  assert.equal(node.props['aria-label'], 'dashboard.open');
  assert.equal(node.props.children.type, 'svg');

  node.props.onClick();
  assert.deepEqual(opened, ['session-current']);
});

test('renders the icon for Main and hides it without a ready matching context', () => {
  assert.notEqual(
    render({
      ...worktreeState,
      value: {
        kind: 'main',
        workspaceId: 'workspace-current',
        label: 'main',
        source: 'current-branch',
      },
    }).node,
    null,
  );
  assert.equal(render({ ...worktreeState, status: 'error' }).node, null);
  assert.equal(render({ ...worktreeState, value: { kind: 'none', reason: 'unbound' } }).node, null);
  assert.equal(render(worktreeState, 'different-session').node, null);
});
