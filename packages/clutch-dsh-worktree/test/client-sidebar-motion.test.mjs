import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/client/surface/components/AnimatedTree.tsx', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;
const exports = {};
const jsx = (type, props) => ({ type, props });
new Function('require', 'exports', output)(
  (name) =>
    ({
      react: {
        Component: class {
          constructor(props) {
            this.props = props;
          }
        },
        createRef: () => ({ current: null }),
      },
      'react/jsx-runtime': { jsx, jsxs: jsx },
      '../../worktree.css': { default: {} },
    })[name],
  exports,
);

test('Workspace reveal and Session insertion use native fades and keyed movement, with cancellation', (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  let reduced = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { matchMedia: () => ({ matches: reduced }) },
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({ opacity: '1' }),
  });
  t.after(() => {
    for (const [name, descriptor] of [
      ['window', previousWindow],
      ['getComputedStyle', previousStyle],
    ]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  const calls = [];
  function row(key, top) {
    return {
      dataset: { worktreeMotionKey: key },
      top,
      style: {},
      closest: () => ({ dataset: { workspaceId: 'repo' } }),
      getBoundingClientRect() {
        return { top: this.top, bottom: this.top + 32, left: 10, width: 250, height: 32 };
      },
      animate(frames, options) {
        const animation = {
          cancelled: false,
          cancel() {
            this.cancelled = true;
          },
          onfinish: null,
        };
        calls.push({ key, frames, options, animation });
        return animation;
      },
      cloneNode() {
        return {
          ...this,
          style: {},
          removeAttribute() {},
          remove() {
            this.removed = true;
          },
        };
      },
    };
  }
  const workspace = row('workspace:repo', 0);
  const tail = row('session:tail', 40);
  const list = {
    rows: [workspace, tail],
    animate() {},
    querySelectorAll() {
      return this.rows;
    },
    closest: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 200 }) }),
  };
  const overlay = {
    clones: [],
    append(element) {
      this.clones.push(element);
    },
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
  };
  const props = { className: 'list', ready: true, resetKey: '', children: [] };
  const tree = new exports.AnimatedTree(props);
  tree.list.current = list;
  tree.exits.current = overlay;
  assert.equal(tree.getSnapshotBeforeUpdate(props), null, 'no initial-load motion');
  tree.render().props.onPointerDownCapture();
  const snapshot = tree.getSnapshotBeforeUpdate(props);
  const added = row('session:new', 40);
  tail.top = 80;
  list.rows = [workspace, added, tail];
  tree.componentDidUpdate(props, undefined, snapshot);
  assert.deepEqual(
    calls.map(({ key, options }) => [key, options.duration]),
    [
      ['session:new', 100],
      ['session:tail', 200],
    ],
  );
  assert.equal(calls[1].frames[0].transform, 'translate(0px, -40px)');
  const metadata = tree.getSnapshotBeforeUpdate(props);
  tree.componentDidUpdate(props, undefined, metadata);
  assert.equal(calls.length, 2, 'metadata changes do not restart movement');
  const collapse = tree.getSnapshotBeforeUpdate(props);
  list.rows = [workspace];
  tree.componentDidUpdate(props, undefined, collapse);
  assert.equal(overlay.clones.length, 2, 'collapse retains inert fading copies');
  assert.ok(overlay.clones.every((element) => element.inert));
  assert.ok(calls.slice(0, 2).every(({ animation }) => animation.cancelled));
  // Search reset, pending data, drag, and accessibility modes settle immediately.
  tree.props = { ...props, resetKey: 'search' };
  assert.equal(tree.getSnapshotBeforeUpdate(props), null);
  tree.componentDidUpdate(props, undefined, null);
  assert.ok(overlay.clones.every((element) => element.removed));
  tree.props = { ...props, ready: false };
  assert.equal(tree.getSnapshotBeforeUpdate(props), null);
  tree.props = props;
  reduced = true;
  assert.equal(tree.getSnapshotBeforeUpdate(props), null);
  reduced = false;
  const insertion = tree.getSnapshotBeforeUpdate(props);
  list.rows = [workspace, row('session:last', 40)];
  tree.componentDidUpdate(props, undefined, insertion);
  tree.componentWillUnmount();
  assert.ok(calls.every(({ animation }) => animation.cancelled));
});
