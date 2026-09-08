import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

// Execute production source without rebuilding the browser's live lib/ directory.
async function loadSource(path, dependencies = {}) {
  const source = await readFile(new URL('../src/client/' + path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  new Function('require', 'exports', outputText)((name) => dependencies[name] ?? {}, exports);
  return exports;
}

const selectors = await loadSource('surface/selectors.ts');
const jsx = (type, props) => ({ type, props });
const { SurfaceHeader } = await loadSource('surface/components/SurfaceHeader.tsx', {
  'react/jsx-runtime': { jsx, jsxs: jsx },
  '../../worktree.css': { default: {} },
  '../shared.js': { cx: () => '' },
});

function collapseButton(node) {
  if (!node || typeof node !== 'object') return undefined;
  if (node.props?.['aria-label'] === 'workspace.collapseAll') return node;
  for (const child of [node.props?.children].flat()) {
    const button = collapseButton(child);
    if (button) return button;
  }
}

for (const kind of ['main', 'active', 'archived']) {
  test('Collapse All handler suppresses ' + kind + ' reveal until Session switch', async () => {
    const state = [];
    const effects = [];
    let cursor = 0;
    let pending = [];
    const react = {
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [
          state[index],
          (value) => {
            state[index] = typeof value === 'function' ? value(state[index]) : value;
          },
        ];
      },
      useRef(initial) {
        const [ref] = react.useState({ current: initial });
        return ref;
      },
      useMemo: (calculate) => calculate(),
      useEffect() {},
      useLayoutEffect(effect, dependencies) {
        const index = cursor++;
        if (!effects[index] || dependencies.some((value, i) => value !== effects[index][i])) {
          effects[index] = dependencies;
          pending.push(effect);
        }
      },
    };
    const { useSessionExpansion } = await loadSource('surface/state/useSessionExpansion.tsx', {
      react,
      '../selectors.js': selectors,
    });
    const worktrees =
      kind === 'main'
        ? []
        : [
            {
              workspaceId: 'repo',
              worktreeId: 'wt',
              status: kind === 'active' ? 'active' : 'removed',
            },
          ];
    const views = [
      {
        workspaceId: 'repo',
        worktrees,
        bindings:
          kind === 'main'
            ? []
            : ['current', 'next'].map((sessionId) => ({
                workspaceId: 'repo',
                worktreeId: 'wt',
                sessionId,
                status: 'active',
              })),
      },
    ];
    const source = {
      currentSessionId: 'current',
      mode: 'worktree',
      workspaceIds: ['repo', 'other'],
      workspaces: { items: [{ workspaceId: 'repo', sessionIds: ['current', 'next'] }] },
      ref: { current: null },
      expandSnapshot: {},
    };
    const read = { readState: { status: 'ready', views }, viewByWorkspace: new Map() };
    const calls = [];
    const props = {
      t: (key) => key,
      expandState: { actions: { collapseAll: (...args) => calls.push(args) } },
    };
    function render() {
      cursor = 0;
      pending = [];
      return useSessionExpansion({ source, read, props });
    }
    // Run the real Session-change effect; leave the unrelated DOM positioning effect idle.
    render();
    pending[0]();
    let expansion = render();
    const keys = [...expansion.currentRevealKeys];
    assert.ok(keys.length >= 3);
    assert.ok(keys.every(expansion.isCurrentSessionReveal));
    expansion.setExpandedArchivedWorkspaces({ repo: true });
    expansion.setExpandedSessionGroups({ [expansion.currentSessionLocation.groupKey]: true });
    expansion = render();
    const button = collapseButton(SurfaceHeader({ expansion, props, source, read, mutation: {} }));
    assert.ok(button, 'find the actual Collapse All button');
    button.props.onClick();
    expansion = render();
    assert.deepEqual(calls, [[['repo', 'other'], kind === 'main' ? [] : ['wt']]]);
    assert.ok(keys.every((key) => !expansion.isCurrentSessionReveal(key)));
    assert.deepEqual(expansion.expandedArchivedWorkspaces, {});
    assert.deepEqual(expansion.expandedSessionGroups, {});
    // A refreshed snapshot of the same Session must not undo the explicit collapse.
    read.readState = { ...read.readState, views: [...views] };
    expansion = render();
    assert.ok(keys.every((key) => !expansion.isCurrentSessionReveal(key)));
    source.currentSessionId = 'next';
    render();
    pending[0]();
    expansion = render();
    assert.ok(keys.every(expansion.isCurrentSessionReveal));
  });
}
