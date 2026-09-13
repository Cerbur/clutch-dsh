import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { en } from '../lib/client/locales.js';

const compiled = ts.transpileModule(
  await readFile(
    new URL('../src/client/dashboard/WorktreeInstructions.tsx', import.meta.url),
    'utf8',
  ),
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  },
).outputText;

function harness(onSave) {
  const state = [],
    effects = [];
  let cursor = 0,
    pending = [],
    writes = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [
        state[index],
        (value) => {
          writes++;
          state[index] = value;
        },
      ];
    },
    useRef(initial) {
      return react.useState({ current: initial })[0];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!effects[index] || deps.some((value, i) => value !== effects[index].deps[i])) {
        pending.push(() => {
          effects[index]?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  new Function('require', 'exports', compiled)(
    (name) =>
      ({
        react,
        'react/jsx-runtime': { jsx, jsxs: jsx },
        './dashboard.css': { default: {} },
      })[name],
    exports,
  );
  let props = { value: 'original', onSave, disabled: false, t: (key) => en[key] };
  return {
    render(next = {}) {
      props = { ...props, ...next };
      cursor = 0;
      pending = [];
      const node = exports.WorktreeInstructions(props);
      pending.forEach((effect) => effect());
      return node;
    },
    dispose() {
      effects.forEach((effect) => effect?.cleanup?.());
    },
    get writes() {
      return writes;
    },
  };
}
function nodes(node) {
  if (!node || typeof node !== 'object') return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function button(node, label) {
  return nodes(node).find((item) => item.type === 'button' && item.props.children === label).props;
}
function edit(h, text) {
  button(h.render(), 'Edit').onClick();
  nodes(h.render())
    .find((item) => item.type === 'textarea')
    .props.onChange({ target: { value: text } });
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('instruction editor retains failed drafts, retries with its original witness, and can clear', async () => {
  let fail = true;
  const calls = [];
  const h = harness(async (...input) => {
    calls.push(input);
    if (fail) throw new Error('offline');
    return input[0];
  });
  edit(h, 'changed');
  button(h.render(), 'Save').onClick();
  await settle();
  assert.equal(nodes(h.render()).find((item) => item.type === 'textarea').props.value, 'changed');
  assert.ok(nodes(h.render()).some((item) => item.props?.role === 'alert'));
  fail = false;
  button(h.render(), 'Save').onClick();
  await settle();
  assert.deepEqual(calls, [
    ['changed', 'original'],
    ['changed', 'original'],
  ]);
  assert.equal(
    nodes(h.render()).some((item) => item.type === 'textarea'),
    false,
  );
  edit(h, '');
  button(h.render(), 'Save').onClick();
  await settle();
  assert.deepEqual(calls.at(-1), ['', 'changed']);
  h.dispose();
});

test('instruction editor coalesces saves and drops late completion after unmount', async () => {
  let finish,
    calls = 0;
  const h = harness(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  edit(h, 'changed');
  const save = button(h.render(), 'Save');
  save.onClick();
  save.onClick();
  assert.equal(calls, 1);
  assert.equal(button(h.render(), 'Saving…').disabled, true);
  h.dispose();
  const writes = h.writes;
  finish('changed');
  await settle();
  assert.equal(h.writes, writes);
});
