import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { en } from '../lib/client/locales.js';

const sources = await Promise.all(['select/SearchableSingleSelect', 'branch/GitBranchSelector', 'select/WorktreeSelector']
  .map(async (name) => [name, await readFile(new URL('../src/client/' + name + '.tsx', import.meta.url), 'utf8')]));

function harness() {
  const state = [];
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useId: () => 'select-test',
    useRef: (initial) => react.useState({ current: initial })[0],
    useEffect() {}, useLayoutEffect() {},
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const modules = {};
  for (const [name, source] of sources) {
    const exports = {};
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function('require', 'exports', output)((id) => ({
      react, 'react/jsx-runtime': { jsx, jsxs: jsx },
      '@deepseek-ai/dsh-client-ui-primitives': {
        Input: (props) => jsx('input', props), MenuSurface: (props) => jsx('native-menu-surface', props),
      },
      '../dsh-icons.js': Object.fromEntries(['IconBranchOutline16', 'IconCheckOutline16', 'IconSearchOutline16', 'IconChevronDownOutline14', 'IconDownloadOutline16', 'IconLoadingOutline16']
        .map((icon) => [icon, () => jsx('svg', { icon })])),
      './single-select.css': { default: {} }, './git-branch.css': { default: {} },
      '../select/SearchableSingleSelect.js': modules['select/SearchableSingleSelect'],
      './SearchableSingleSelect.js': modules['select/SearchableSingleSelect'],
    })[id] ?? {}, exports);
    modules[name] = exports;
  }
  return { render(component, props) { cursor = 0; return modules[component[0]][component[1]](props); } };
}

function find(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
}
const options = (node) => find(node, (item) => item.props?.role === 'option');
const search = (node) => find(node, (item) => item.props?.role === 'combobox')[0];
const key = (name, composing = false) => ({ key: name, nativeEvent: { isComposing: composing }, preventDefault() {}, stopPropagation() {} });

test('branch filters intersect text search without changing the selected value', () => {
  const h = harness();
  const chosen = [];
  const props = { t: (name) => en[name], value: 'main', onChange: (value) => chosen.push(value), branches: [
    { name: 'main', isCurrent: true, checkedOut: true },
    { name: 'origin/main', kind: 'remote', remote: 'origin' },
    { name: 'upstream/dev', kind: 'remote', remote: 'upstream' },
  ] };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
  let node = render();
  find(node, (item) => item.type === 'button' && item.props.children === en['branch.remote'])[0].props.onClick();
  node = render();
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['origin/main', 'upstream/dev']);
  search(node).props.onChange({ currentTarget: { value: ' MAIN ' } });
  node = render();
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['origin/main']);
  search(node).props.onKeyDown(key('Enter', true));
  assert.deepEqual(chosen, []);
  search(node).props.onKeyDown(key('ArrowDown'));
  assert.deepEqual(chosen, []);
  search(render()).props.onKeyDown(key('Enter'));
  assert.deepEqual(chosen, ['origin/main']);
});

test('import Worktree searches branch and path and returns the exact candidate path', () => {
  const h = harness();
  const chosen = [];
  const props = { t: (name) => en[name], value: '', onChange: (value) => chosen.push(value), candidates: [
    { branch: 'feature/shared', absolutePath: '/work/alpha' },
    { branch: 'feature/shared', absolutePath: '/work/beta' },
  ] };
  const render = () => h.render(['select/WorktreeSelector', 'WorktreeSelector'], props);
  let node = render();
  find(node, (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  node = render();
  assert.equal(find(node, (item) => item.type === 'native-menu-surface').length, 1);
  search(node).props.onChange({ currentTarget: { value: 'FEATURE/SHARED' } });
  node = render();
  assert.equal(options(node).length, 2);
  search(node).props.onChange({ currentTarget: { value: 'BETA' } });
  node = render();
  assert.equal(options(node).length, 1);
  assert.equal(options(node)[0].props.title, 'feature/shared — /work/beta');
  search(node).props.onKeyDown(key('Enter'));
  assert.deepEqual(chosen, ['/work/beta']);
  assert.equal(search(render()), undefined);
});

test('fetch is available with no remote rows, deduplicates clicks, and preserves search and selection', async () => {
  const h = harness();
  let resolve;
  let calls = 0;
  const chosen = [];
  const props = { t: (name) => en[name], value: 'main', branches: [{ name: 'main' }],
    onChange: (value) => chosen.push(value), onFetch: () => {
      calls++;
      return new Promise((done) => { resolve = done; });
    } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
  const fetchButton = (node) => find(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0];
  let node = render();
  find(node, (item) => item.type === 'button' && item.props.children === en['branch.remote'])[0].props.onClick();
  search(render()).props.onChange({ currentTarget: { value: 'new' } });
  node = render();
  assert.equal(options(node).length, 0);
  assert.ok(fetchButton(node));
  fetchButton(node).props.onClick();
  fetchButton(node).props.onClick();
  node = render();
  assert.equal(calls, 1);
  assert.equal(fetchButton(node).props.disabled, true);
  assert.equal(fetchButton(node).props['aria-busy'], true);
  resolve([{ name: 'main' }, { name: 'origin/new', kind: 'remote', remote: 'origin' }]);
  await Promise.resolve();
  node = render();
  assert.equal(search(node).props.value, 'new');
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['origin/new']);
  assert.deepEqual(chosen, []);
  assert.equal(fetchButton(node).props.disabled, false);
});

test('fetch failure keeps old branch rows and exposes a retryable localized error', async () => {
  const h = harness();
  let calls = 0;
  const props = { t: (name) => en[name], value: 'origin/main', branches: [{ name: 'origin/main', kind: 'remote' }],
    onChange() {}, onFetch: async () => { if (++calls === 1) throw new Error('auth'); return props.branches; } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
  const fetchButton = (node) => find(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0];
  fetchButton(render()).props.onClick();
  await Promise.resolve();
  let node = render();
  assert.equal(find(node, (item) => item.props?.role === 'alert')[0].props.children, en['branch.fetchFailed']);
  assert.equal(options(node)[0].props['aria-selected'], true);
  fetchButton(node).props.onClick();
  await Promise.resolve();
  node = render();
  assert.equal(calls, 2);
  assert.equal(find(node, (item) => item.props?.role === 'alert').length, 0);
});

test('empty results and disabled selection cannot commit, Escape calls the owner', () => {
  const h = harness();
  const chosen = [];
  let closed = 0;
  const props = { options: [{ value: 'a', label: 'Alpha' }], value: 'a', searchLabel: 'Search', noMatchesLabel: 'Empty',
    onChange: (value) => chosen.push(value), onClose: () => closed++ };
  const render = () => h.render(['select/SearchableSingleSelect', 'SingleSelectPicker'], props);
  props.disabled = true;
  let node = render();
  options(node)[0].props.onClick();
  search(node).props.onKeyDown(key('Enter'));
  assert.deepEqual(chosen, []);
  props.disabled = false;
  search(node).props.onChange({ currentTarget: { value: 'missing' } });
  node = render();
  assert.equal(options(node).length, 0);
  assert.equal(search(node).props['aria-activedescendant'], undefined);
  search(node).props.onKeyDown(key('Enter'));
  assert.deepEqual(chosen, []);
  search(node).props.onKeyDown(key('Escape', true));
  assert.equal(closed, 0);
  search(node).props.onKeyDown(key('Escape'));
  assert.equal(closed, 1);
});
