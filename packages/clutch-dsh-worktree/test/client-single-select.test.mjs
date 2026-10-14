import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';
import { en, zh } from '../lib/client/locales.js';
import { toWorktreeViewError } from '../lib/client/view/worktree-view.js';
import { createWorktreeDiagnostics } from '../lib/client/settings/diagnostics.js';

const sources = await Promise.all(['select/SearchableSingleSelect', 'branch/GitBranchSelector', 'select/WorktreeSelector', 'surface/components/dialogs']
  .map(async (name) => [name, await readFile(new URL('../src/client/' + name + '.tsx', import.meta.url), 'utf8')]));

function harness({ deferPreparation = false, geometry } = {}) {
  const diagnostics = createWorktreeDiagnostics();
  const errorToast = (props) => {
    diagnostics.publish(props.scope, props.error === undefined ? [] : [{
      key: props.scope + ':' + props.error.code, text: props.error.message, error: props.error, actions: props.actions,
    }]);
    return jsx('error-toast', props);
  };
  const state = [];
  const frames = new Map();
  const effects = [];
  let frameId = 0;
  const listeners = new Map();
  const browserWindow = { innerWidth: 1000, innerHeight: 800,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); } };
  const browserDocument = { ...browserWindow, visibilityState: 'visible' };
  let cursor = 0;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
    },
    useId: () => 'select-test',
    useRef: (initial) => react.useState({ current: initial })[0],
    useMemo: (create) => create(),
    useEffect(callback, dependencies) {
      const index = cursor++;
      const previous = state[index];
      if (!previous || dependencies.some((value, i) => value !== previous.dependencies[i])) {
        state[index] = { dependencies, callback };
        effects.push(() => { previous?.cleanup?.(); state[index].cleanup = callback(); });
      }
    },
    useLayoutEffect(callback, dependencies) { if (geometry) react.useEffect(callback, dependencies); },
  };
  const jsx = (type, props) => {
    if (typeof type === 'function') return type(props);
    if (geometry && props.ref) {
      const listHeight = Math.min(geometry.listHeight ?? 300,
        Number.parseFloat(props.style?.['--single-select-viewport-height'] ?? '300'));
      const element = { contains: () => false, focus() {},
        getBoundingClientRect: () => geometry.trigger,
        offsetHeight: type === 'native-menu-surface' ? 90 + listHeight : listHeight,
        querySelector: (selector) => selector === 'input' ? { focus() {} } : { offsetHeight: listHeight, scrollHeight: geometry.listHeight ?? 300 },
      };
      if (typeof props.ref === 'function') props.ref(element);
      else props.ref.current = element;
    }
    return { type, props };
  };
  const modules = {};
  for (const [name, source] of sources) {
    const exports = {};
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    new Function('require', 'exports', 'requestAnimationFrame', 'cancelAnimationFrame', 'window', 'document', 'ResizeObserver', output)((id) => ({
      react, 'react/jsx-runtime': { jsx, jsxs: jsx },
      '@deepseek-ai/dsh-client-ui-primitives': {
        Input: (props) => jsx('input', props), MenuSurface: (props) => jsx('native-menu-surface', props),
        Button: (props) => jsx('button', props), Modal: (props) => jsx('native-modal', props),
      },
      '../dsh-icons.js': Object.fromEntries(['IconBranchOutline16', 'IconCheckOutline16', 'IconSearchOutline16', 'IconChevronDownOutline14', 'IconDownloadOutline16', 'IconLoadingOutline16']
        .map((icon) => [icon, () => jsx('svg', { icon })])),
      './single-select.css': { default: {} }, './git-branch.css': { default: {} },
      '../select/SearchableSingleSelect.js': modules['select/SearchableSingleSelect'],
      './SearchableSingleSelect.js': modules['select/SearchableSingleSelect'],
      '../../branch/GitBranchSelector.js': modules['branch/GitBranchSelector'],
      '../../select/WorktreeSelector.js': modules['select/WorktreeSelector'],
      '../../view/worktree-view.js': { worktreeSetupCommands: () => [] },
      './NotificationToasts.js': { ErrorToast: (props) => jsx('error-toast', props) },
      '../surface/components/NotificationToasts.js': { ErrorToast: errorToast },
      '../view/worktree-view.js': { toWorktreeViewError },
      '../../worktree.css': { default: {} },
    })[id] ?? {}, exports,
    (callback) => { frames.set(++frameId, callback); return frameId; },
    (id) => frames.delete(id), browserWindow, browserDocument,
    class { observe() {} disconnect() {} });
    modules[name] = exports;
  }
  const advanceFrame = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  };
  return { advanceFrame, diagnostics, replayEffects({ childFirst = false } = {}) {
    const mounted = state.filter((entry) => entry?.callback);
    mounted.forEach((entry) => entry.cleanup?.());
    (childFirst ? mounted.reverse() : mounted).forEach((entry) => { entry.cleanup = entry.callback(); });
  }, dispose() {
    state.splice(0).forEach((entry) => entry?.cleanup?.());
    for (const entry of diagnostics.getSnapshot()) diagnostics.deactivate(entry.source);
  }, focus: () => listeners.get('focus')?.(),
    resize: (height) => { browserWindow.innerHeight = height; listeners.get('resize')?.(); },
    render(component, props) {
    const render = () => {
      cursor = 0;
      const node = modules[component[0]][component[1]](props);
      state.splice(cursor).forEach((removed) => removed?.cleanup?.());
      return node;
    };
    const node = render();
    effects.splice(0).forEach((callback) => callback());
    if (deferPreparation) return node;
    advanceFrame(); advanceFrame();
    render();
    effects.splice(0).forEach((callback) => callback());
    return render();
  } };
}

function find(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => find(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
}
const options = (node) => find(node, (item) => item.props?.role === 'option');
const search = (node) => find(node, (item) => item.props?.role === 'combobox')[0];
const key = (name, composing = false) => ({ key: name, nativeEvent: { isComposing: composing }, preventDefault() {}, stopPropagation() {} });

test('dropdown stays below a middle trigger by limiting its scrolling viewport through loading and ready states', () => {
  const h = harness({ geometry: { trigger: { left: 340, top: 424, bottom: 460, width: 400 } } });
  const props = { label: 'Branch', searchLabel: 'Search', noMatchesLabel: 'Empty', value: '',
    options: Array.from({ length: 200 }, (_, i) => ({ value: String(i), label: String(i) })), onChange() {} };
  const render = () => h.render(['select/SearchableSingleSelect', 'SearchableSingleSelect'], props);
  find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  let popup = find(render(), (item) => item.type === 'native-menu-surface')[0];
  assert.equal(popup.props.style.top, 464);
  assert.equal(Number.parseFloat(popup.props.style['--single-select-viewport-height']), 220);
  // Less space should shrink the roster in place rather than flip above the trigger.
  h.resize(720);
  popup = find(render(), (item) => item.type === 'native-menu-surface')[0];
  assert.equal(popup.props.style.top, 464);
  assert.equal(Number.parseFloat(popup.props.style['--single-select-viewport-height']), 154);
  props.loading = true;
  assert.equal(find(render(), (item) => item.type === 'native-menu-surface')[0].props.style.top, 464);
  props.loading = false;
  assert.equal(find(render(), (item) => item.type === 'native-menu-surface')[0].props.style.top, 464);
  // Near the bottom edge, there is no useful roster space below: use bounded space above.
  h.resize(580);
  popup = find(render(), (item) => item.type === 'native-menu-surface')[0];
  assert.ok(popup.props.style.top >= 12 && popup.props.style.top < 424);
  assert.ok(popup.props.style.top + 90 + 220 <= 420);
});

test('opening a large already-loaded list paints its loading shell before constructing option rows', () => {
  const h = harness({ deferPreparation: true });
  const props = { label: 'Branch', searchLabel: 'Search', noMatchesLabel: 'Empty', value: 'branch-0',
    options: Array.from({ length: 1000 }, (_, index) => ({ value: 'branch-' + index, label: 'Branch ' + index })),
    onChange() {} };
  const render = () => h.render(['select/SearchableSingleSelect', 'SearchableSingleSelect'], props);
  find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  const node = render();
  assert.ok(search(node));
  assert.equal(find(node, (item) => item.props?.['data-single-select-loading'] !== undefined).length, 1);
  assert.equal(options(node).length, 0);
  h.advanceFrame();
  assert.equal(options(render()).length, 0);
  h.advanceFrame();
  const ready = render();
  assert.equal(find(ready, (item) => item.props?.['data-single-select-loading'] !== undefined).length, 0);
  assert.ok(options(ready).length > 0 && options(ready).length < 30);
});

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

test('reopening a branch dropdown rereads local refs after terminal changes without fetching remotes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  let reads = 0;
  let fetches = 0;
  let resolve;
  const props = { t: (name) => en[name], label: 'Branch', value: 'main',
    branches: [{ name: 'main', isCurrent: true }], onChange() {},
    onLoad: () => { reads++; return new Promise((done) => { resolve = done; }); },
    onFetch: async () => { fetches++; return []; } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchSelector'], props);
  const trigger = () => find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0];
  render();
  assert.equal(reads, 0);
  trigger().props.onClick();
  let node = render();
  assert.equal(reads, 1);
  assert.equal(find(node, (item) => item.props?.['data-single-select-loading'] !== undefined).length, 1);
  resolve([{ name: 'main' }, { name: 'terminal/new', isCurrent: true }]);
  await Promise.resolve(); await Promise.resolve();
  node = render();
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['main', 'terminal/new']);
  assert.ok(find(options(node)[1], (item) => item.props?.children === en['branch.current']).length > 0);
  search(node).props.onKeyDown(key('Escape'));
  trigger().props.onClick();
  render();
  assert.equal(reads, 2);
  resolve([{ name: 'main', isCurrent: true }]);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(options(render()).map((item) => item.props['data-single-select-option']), ['main']);
  assert.equal(fetches, 0);
  h.focus(); h.focus();
  t.mock.timers.tick(200);
  assert.equal(reads, 2);
  assert.deepEqual(options(render()).map((item) => item.props['data-single-select-option']), ['main']);
  search(render()).props.onKeyDown(key('Escape'));
  render(); h.focus();
  assert.equal(reads, 2);
});

test('returning from DevTools never reads branches and the first Fetch click fetches', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  let reads = 0;
  let fetches = 0;
  let finishFetch;
  const props = { t: (name) => en[name], value: 'origin/main', branches: [{ name: 'origin/main', kind: 'remote' }],
    onChange() {}, onLoad: async () => { reads++; return props.branches; },
    onFetch: () => { fetches++; return new Promise((resolve) => { finishFetch = resolve; }); } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
  render(); await Promise.resolve(); await Promise.resolve();
  render();
  assert.equal(reads, 1);
  // Clicking back into the page first focuses the window, before pointerdown and click.
  h.focus();
  let node = render();
  const fetchButton = find(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0];
  assert.equal(fetchButton.props.disabled, false);
  find(node, (item) => item.props?.['data-single-select-picker'] !== undefined)[0]
    .props.onPointerDownCapture?.({ target: { closest: () => ({}) } });
  fetchButton.props.onClick();
  t.mock.timers.tick(200);
  node = render();
  assert.equal(reads, 1);
  assert.equal(fetches, 1);
  assert.equal(find(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0].props['data-fetch-status'], 'pending');
  finishFetch(props.branches);
  await Promise.resolve();
  render();
});

test('opening a branch picker while Workspace readiness is loading still starts its one candidate read', async () => {
  const h = harness();
  let reads = 0;
  const props = { t: (name) => en[name], label: 'Branch', value: 'HEAD', branches: [], loading: true,
    onChange() {}, onLoad: async () => { reads++; return [{ name: 'main', isCurrent: true }]; } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchSelector'], props);
  find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  render();
  assert.equal(reads, 1);
  await Promise.resolve(); await Promise.resolve();
  props.loading = false;
  const node = render();
  assert.equal(reads, 1);
  assert.deepEqual(options(node).map((option) => option.props['data-single-select-option']), ['main']);
});

for (const outcome of ['success', 'failure']) {
  for (const order of ['old first', 'latest first']) {
    for (const childFirst of [false, true]) {
      test(`StrictMode replay replaces delayed branch reads and releases loading after ${outcome} (${order}, child first: ${childFirst})`, async (t) => {
        const h = harness();
        t.after(() => h.dispose());
        const requests = [];
        const chosen = [];
        let fetches = 0;
        const props = { t: (name) => en[name], value: 'main', branches: [{ name: 'main' }],
          onChange: (value) => chosen.push(value),
          onLoad: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
          onFetch: async () => { fetches++; return [{ name: 'recovered' }]; } };
        const render = () => h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
        render();
        assert.equal(requests.length, 1);
        h.replayEffects({ childFirst });
        assert.equal(requests.length, 2);
        if (order === 'old first') requests[0].resolve([{ name: 'obsolete' }]);
        await Promise.resolve(); await Promise.resolve();
        let node = render();
        assert.equal(find(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0].props.disabled, true);
        assert.equal(options(node).some((item) => item.props['data-single-select-option'] === 'obsolete'), false);
        if (outcome === 'success') requests[1].resolve([{ name: 'latest' }]);
        else requests[1].reject(new Error('latest failed'));
        await Promise.resolve(); await Promise.resolve();
        if (order === 'latest first') {
          requests[0].resolve([{ name: 'obsolete' }]);
          await Promise.resolve(); await Promise.resolve();
        }
        node = render();
        const expected = outcome === 'success' ? 'latest' : 'main';
        const option = options(node).find((item) => item.props['data-single-select-option'] === expected);
        assert.ok(option);
        assert.equal(option.props.disabled, false);
        option.props.onClick();
        assert.deepEqual(chosen, [expected]);
        const fetch = find(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0];
        assert.equal(fetch.props.disabled, false);
        fetch.props.onClick();
        await Promise.resolve(); await Promise.resolve();
        assert.equal(fetches, 1);
        assert.deepEqual(options(render()).map((item) => item.props['data-single-select-option']), ['recovered']);
      });
    }
  }
}

test('large lists keep all candidates searchable and make offscreen keyboard selections available', () => {
  const h = harness();
  const chosen = [];
  const props = { searchLabel: 'Search', noMatchesLabel: 'Empty', value: 'branch-0',
    options: Array.from({ length: 1000 }, (_, index) => ({ value: 'branch-' + index, label: 'Branch ' + index,
      description: '/repo/worktree-' + index })), onChange: (value) => chosen.push(value) };
  const render = () => h.render(['select/SearchableSingleSelect', 'SingleSelectPicker'], props);
  let node = render();
  assert.ok(options(node).length < 30);
  assert.equal(options(node).some((option) => option.props['data-single-select-option'] === 'branch-999'), false);
  search(node).props.onKeyDown(key('ArrowUp'));
  node = render();
  const last = options(node).find((option) => option.props['data-single-select-option'] === 'branch-999');
  assert.ok(last);
  assert.equal(last.props['aria-posinset'], 1000);
  assert.equal(last.props['aria-setsize'], 1000);
  assert.equal(search(node).props['aria-activedescendant'], last.props.id);
  search(node).props.onKeyDown(key('Enter'));
  assert.deepEqual(chosen, ['branch-999']);
  search(node).props.onChange({ currentTarget: { value: 'worktree-973' } });
  node = render();
  assert.deepEqual(options(node).map((option) => option.props['data-single-select-option']), ['branch-973']);
  options(node)[0].props.onClick();
  assert.deepEqual(chosen, ['branch-999', 'branch-973']);
});

test('branch reread failures retain candidates and expose a retry without resetting search', async () => {
  const h = harness();
  let attempts = 0;
  const props = { t: (name) => en[name], label: 'Branch', value: 'main', branches: [{ name: 'main' }],
    onChange() {}, onLoad: async () => {
      if (++attempts === 1) throw new Error('offline');
      return [{ name: 'main' }, { name: 'main/new' }];
    } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchSelector'], props);
  find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  render(); await Promise.resolve(); await Promise.resolve();
  let node = render();
  search(node).props.onChange({ currentTarget: { value: 'main' } });
  node = render();
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['main']);
  const notice = find(node, (item) => item.type === 'error-toast' && item.props.error)[0];
  assert.equal(notice.props.error.message, 'offline');
  notice.props.actions[0].onClick();
  await Promise.resolve(); await Promise.resolve();
  node = render();
  assert.equal(search(node).props.value, 'main');
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['main', 'main/new']);
});

test('closing during preparation cancels the pending frame and reopening keeps a fresh shell', () => {
  const h = harness({ deferPreparation: true });
  const props = { label: 'Branch', searchLabel: 'Search', noMatchesLabel: 'Empty', value: 'main',
    options: [{ value: 'main', label: 'Main' }], onChange() {} };
  const render = () => h.render(['select/SearchableSingleSelect', 'SearchableSingleSelect'], props);
  const trigger = () => find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0];
  trigger().props.onClick();
  render(); h.advanceFrame();
  trigger().props.onClick();
  assert.equal(search(render()), undefined);
  h.advanceFrame(); h.advanceFrame();
  trigger().props.onClick();
  let node = render();
  assert.equal(options(node).length, 0);
  search(node).props.onChange({ currentTarget: { value: 'MAIN' } });
  h.advanceFrame(); h.advanceFrame();
  node = render();
  assert.equal(search(node).props.value, 'MAIN');
  assert.equal(options(node)[0].props['data-single-select-option'], 'main');
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

test('dropdown stays open when internal non-focusable content takes focus and closes after selection or Escape', () => {
  const h = harness();
  const chosen = [];
  const props = { label: 'Branch', searchLabel: 'Search', noMatchesLabel: 'Empty', value: 'main',
    options: [{ value: 'main', label: 'Main' }, { value: 'develop', label: 'Develop' }],
    onChange: (value) => chosen.push(value) };
  const render = () => h.render(['select/SearchableSingleSelect', 'SearchableSingleSelect'], props);
  const open = () => find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  open();
  let node = render();
  // Clicking an unfocusable heading or empty space blurs the search input with no related target.
  node.props.onBlur?.({ currentTarget: { contains: () => false }, relatedTarget: null });
  node = render();
  assert.ok(search(node));
  assert.deepEqual(chosen, []);
  options(node)[1].props.onClick();
  assert.deepEqual(chosen, ['develop']);
  assert.equal(search(render()), undefined);
  open();
  search(render()).props.onKeyDown(key('Escape'));
  assert.equal(search(render()), undefined);
});

test('loading does not block opening, hide retained rows, reset search or allow premature selection', () => {
  const h = harness();
  const chosen = [];
  const props = { label: 'Branch', searchLabel: 'Search', noMatchesLabel: 'Empty', loadingLabel: 'Loading branches',
    loading: true, value: 'main', options: [{ value: 'main', label: 'Main' }], onChange: (value) => chosen.push(value) };
  const render = () => h.render(['select/SearchableSingleSelect', 'SearchableSingleSelect'], props);
  find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  let node = render();
  assert.equal(find(node, (item) => item.props?.['data-single-select-loading'] !== undefined).length, 1);
  assert.equal(options(node).length, 1);
  options(node)[0].props.onClick();
  search(node).props.onKeyDown(key('Enter'));
  assert.deepEqual(chosen, []);
  search(node).props.onChange({ currentTarget: { value: 'remote' } });
  node = render();
  assert.equal(find(node, (item) => item.props?.['data-single-select-empty'] !== undefined).length, 0);
  props.loading = false;
  props.options = [{ value: 'origin/remote', label: 'Origin remote' }];
  node = render();
  assert.equal(search(node).props.value, 'remote');
  assert.equal(options(node)[0].props['data-single-select-option'], 'origin/remote');
  search(node).props.onKeyDown(key('Enter'));
  assert.deepEqual(chosen, ['origin/remote']);
  assert.equal(search(render()), undefined);
});

function registrationProps() {
  return { t: (name) => en[name], workspace: { workspaceId: 'ws', title: 'Repo', path: '/repo' },
    view: undefined, canCreate: false, branchesLoading: true, mode: 'create',
    importCandidates: { status: 'idle', candidates: [] }, selectedBranch: '', newBranch: '',
    actionPending: false, onClose() {}, onModeChange() {}, onRetryImportCandidates() {},
    onSelectedBranchChange() {}, onSelectedImportPathChange() {}, onNewBranchChange() {}, onSubmit() {} };
}

test('HEAD choices show localized branch, Tag and Commit labels while retaining HEAD identity', () => {
  for (const locale of [en, zh]) {
    for (const head of [
      { kind: 'branch', name: 'main' }, { kind: 'tag', name: 'v1.0.0' }, { kind: 'commit', name: 'abcdef0' },
    ]) {
      const h = harness();
      const chosen = [];
      const props = { ...registrationProps(), branchesLoading: false, canCreate: true,
        selectedBranch: 'HEAD', onSelectedBranchChange: (value) => chosen.push(value),
        t: (key, values = {}) => locale[key]?.replace(/\{(\w+)\}/gu, (_, name) => String(values[name])),
        view: { checkout: { currentHead: { ...head, commit: 'a'.repeat(40) } }, branches: [] },
      };
      const render = () => h.render(['surface/components/dialogs', 'WorktreeCreateDialog'], props);
      find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
      const option = options(render())[0];
      assert.equal(option.props['data-single-select-option'], 'HEAD');
      assert.ok(JSON.stringify(option).includes(props.t('worktree.headOption', { name: head.name })));
      option.props.onClick();
      assert.deepEqual(chosen, ['HEAD']);
      h.dispose();
    }
  }
});

test('creation branch picker opens before the Workspace callback and refreshes without losing search', () => {
  const h = harness();
  const chosen = [];
  const props = registrationProps();
  props.onSelectedBranchChange = (branch) => chosen.push(branch);
  const render = () => h.render(['surface/components/dialogs', 'WorktreeCreateDialog'], props);
  find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  let node = render();
  assert.equal(find(node, (item) => item.props?.['data-single-select-loading'] !== undefined).length, 1);
  search(node).props.onChange({ currentTarget: { value: 'origin' } });
  props.view = { readiness: { status: 'ready' }, branches: [{ name: 'main' }, { name: 'origin/main', kind: 'remote' }] };
  props.canCreate = true;
  props.branchesLoading = false;
  node = render();
  assert.equal(search(node).props.value, 'origin');
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['origin/main']);
  options(node)[0].props.onClick();
  assert.deepEqual(chosen, ['origin/main']);
});

test('import picker opens before candidate callback and updates in place', () => {
  const h = harness();
  const chosen = [];
  const props = { ...registrationProps(), mode: 'import', onSelectedImportPathChange: (path) => chosen.push(path) };
  const render = () => h.render(['surface/components/dialogs', 'WorktreeCreateDialog'], props);
  find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0].props.onClick();
  assert.equal(find(render(), (item) => item.props?.['data-single-select-loading'] !== undefined).length, 1);
  search(render()).props.onChange({ currentTarget: { value: 'checkout' } });
  props.importCandidates = { status: 'ready', candidates: [{ branch: 'feature', absolutePath: '/repo/checkout' }] };
  const node = render();
  assert.equal(search(node).props.value, 'checkout');
  options(node)[0].props.onClick();
  assert.deepEqual(chosen, ['/repo/checkout']);
});

test('fetch is available with no remote rows, preserves selection, and restores its icon after two seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
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
  assert.equal(fetchButton(node).props.children.props.icon, 'IconLoadingOutline16');
  resolve([{ name: 'main' }, { name: 'origin/new', kind: 'remote', remote: 'origin' }]);
  await Promise.resolve();
  node = render();
  assert.equal(search(node).props.value, 'new');
  assert.deepEqual(options(node).map((item) => item.props['data-single-select-option']), ['origin/new']);
  assert.deepEqual(chosen, []);
  assert.equal(fetchButton(node).props.children, en['branch.fetched']);
  assert.equal(fetchButton(node).props.disabled, true);
  assert.equal(find(node, (item) => item.props?.role === 'status').length, 0);
  t.mock.timers.tick(1999);
  assert.equal(fetchButton(render()).props.children, en['branch.fetched']);
  t.mock.timers.tick(1);
  node = render();
  assert.equal(fetchButton(node).props.children.props.icon, 'IconDownloadOutline16');
  assert.equal(fetchButton(node).props.disabled, false);
  assert.equal(search(node).props.value, 'new');
});

test('fetch failure keeps old branch rows and exposes an inline retryable localized error', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  let calls = 0;
  const props = { t: (name) => en[name], value: 'origin/main', branches: [{ name: 'origin/main', kind: 'remote' }],
    onChange() {}, onFetch: async () => { if (++calls === 1) throw new Error('auth'); return props.branches; } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
  const fetchButton = (node) => find(node, (item) => item.props?.['data-branch-fetch'] !== undefined)[0];
  fetchButton(render()).props.onClick();
  await Promise.resolve();
  let node = render();
  assert.equal(find(fetchButton(node), (item) => item.props?.role === 'alert')[0].props.children, en['branch.fetchRetry']);
  assert.ok(fetchButton(node).props.title.includes(en['branch.fetchFailed']));
  assert.equal(options(node)[0].props['aria-selected'], true);
  fetchButton(node).props.onClick();
  await Promise.resolve();
  node = render();
  assert.equal(calls, 2);
  assert.equal(find(node, (item) => item.props?.role === 'alert').length, 0);
});

test('Fetch retains diagnostic details and retry history until recovery without a status row', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const failure = { code: 'GIT_OPERATION_FAILED', message: 'remote authentication failed', retryable: true,
    details: { gitStderr: 'Permission denied (publickey)', gitExitCode: 128, remote: 'origin' } };
  let finish;
  let calls = 0;
  const props = { t: (name) => en[name], value: 'main', branches: [{ name: 'main' }], onChange() {},
    onFetch: () => { calls++; return new Promise((resolve, reject) => { finish = { resolve, reject }; }); } };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
  const button = () => find(render(), (item) => item.props?.['data-branch-fetch'] !== undefined)[0];
  button().props.onClick();
  finish.reject(failure);
  await Promise.resolve();
  const failed = button();
  assert.ok(failed.props.title.includes(failure.code));
  assert.ok(failed.props.title.includes(failure.message));
  assert.ok(failed.props.title.includes(failure.details.gitStderr));
  assert.equal(h.diagnostics.getSnapshot().length, 1);
  assert.deepEqual(h.diagnostics.getSnapshot()[0].error, failure);
  assert.equal(h.diagnostics.getSnapshot()[0].status, 'active');
  const retry = h.diagnostics.getSnapshot()[0].actions[0].onClick;
  retry(); retry();
  assert.equal(calls, 2);
  assert.equal(button().props['data-fetch-status'], 'pending');
  assert.equal(h.diagnostics.getSnapshot()[0].status, 'active');
  assert.equal(h.diagnostics.getSnapshot()[0].actions[0].disabled, true);
  finish.resolve([{ name: 'main' }, { name: 'origin/new', kind: 'remote' }]);
  await Promise.resolve();
  assert.equal(button().props['data-fetch-status'], 'success');
  assert.equal(h.diagnostics.getSnapshot()[0].status, 'resolved');
  assert.deepEqual(h.diagnostics.getSnapshot()[0].actions, []);
  retry();
  assert.equal(calls, 2);
  assert.equal(find(render(), (item) => item.props?.role === 'status').length, 0);
  t.mock.timers.tick(2000);
  button().props.onClick();
  finish.reject(failure);
  await Promise.resolve();
  render();
  const staleRetry = h.diagnostics.getSnapshot()[0].actions[0].onClick;
  h.dispose();
  staleRetry();
  assert.equal(calls, 3);
  assert.equal(h.diagnostics.getSnapshot()[0].status, 'inactive');
});

test('branch option identity uses full refs while labels remain short and legacy adapters keep names', () => {
  const h = harness();
  const chosen = [];
  const props = { t: (name) => en[name], value: 'refs/heads/origin/main', onChange: (value) => chosen.push(value), branches: [
    { name: 'origin/main', ref: 'refs/heads/origin/main' },
    { name: 'origin/main', kind: 'remote', ref: 'refs/remotes/origin/main' },
    { name: 'legacy' },
  ] };
  const node = h.render(['branch/GitBranchSelector', 'GitBranchPicker'], props);
  const rows = options(node);
  assert.deepEqual(rows.map((row) => row.props['data-single-select-option']), ['refs/heads/origin/main', 'legacy', 'refs/remotes/origin/main']);
  assert.equal(rows[0].props['aria-selected'], true);
  assert.equal(rows[2].props['aria-selected'], false);
  rows[2].props.onClick();
  assert.deepEqual(chosen, ['refs/remotes/origin/main']);
  assert.equal(find(node, (item) => item.props?.title === 'origin/main').length, 2);
});

test('legacy picker values highlight only unique short-name or remote-alias matches without changing caller state', () => {
  const h = harness();
  const chosen = [];
  const props = { t: (name) => en[name], label: 'Branch', value: 'main', onChange: (value) => chosen.push(value), branches: [
    { name: 'main', ref: 'refs/heads/main' },
    { name: 'origin/main', ref: 'refs/remotes/origin/main', kind: 'remote' },
  ] };
  const render = () => h.render(['branch/GitBranchSelector', 'GitBranchSelector'], props);
  const trigger = () => find(render(), (item) => item.props?.['aria-haspopup'] === 'dialog')[0];
  assert.ok(find(trigger(), (item) => item.type === 'span' && item.props?.children === 'main').length > 0);
  trigger().props.onClick();
  assert.deepEqual(options(render()).filter((row) => row.props['aria-selected']).map((row) => row.props['data-single-select-option']), ['refs/heads/main']);
  for (const legacy of ['origin/main', 'remotes/origin/main']) {
    props.value = legacy;
    assert.deepEqual(options(render()).filter((row) => row.props['aria-selected']).map((row) => row.props['data-single-select-option']), ['refs/remotes/origin/main']);
    assert.equal(props.value, legacy);
  }
  props.branches = [...props.branches, { name: 'origin/main', ref: 'refs/heads/origin/main' }];
  props.value = 'origin/main';
  assert.equal(options(render()).filter((row) => row.props['aria-selected']).length, 0);
  assert.deepEqual(chosen, []);
  const remote = options(render()).find((row) => row.props['data-single-select-option'] === 'refs/remotes/origin/main');
  remote.props.onClick();
  assert.deepEqual(chosen, ['refs/remotes/origin/main']);
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
