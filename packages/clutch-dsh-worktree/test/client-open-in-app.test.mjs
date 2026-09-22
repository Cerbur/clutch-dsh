import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers';
import ts from 'typescript';
import { vscodeFolderUrl } from '../lib/client/dashboard/vscode-url.js';
import { OpenInAppController } from '../lib/client/dashboard/open-in-app-controller.js';

const source = await readFile(
  new URL('../src/client/dashboard/OpenInAppButton.tsx', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function createButtonHarness(controller, path) {
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
        (next) => {
          state[index] = typeof next === 'function' ? next(state[index]) : next;
        },
      ];
    },
    useRef(initial) {
      return react.useState({ current: initial })[0];
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = effects[index];
      const changed =
        previous === undefined ||
        deps.length !== previous.deps.length ||
        deps.some((value, dependencyIndex) => value !== previous.deps[dependencyIndex]);
      if (changed) {
        pending.push(() => {
          previous?.cleanup?.();
          effects[index] = { deps, cleanup: effect() };
        });
      }
    },
  };
  const jsx = (type, props) => (typeof type === 'function' ? type(props) : { type, props });
  const css = new Proxy({}, { get: (_target, key) => String(key) });
  const exports = {};
  new Function('require', 'exports', output)(
    (name) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === '@deepseek-ai/dsh-client-ui-primitives') {
        return {
          IconChevronDownOutline14: () => jsx('svg', { 'data-icon': 'chevron' }),
          Menu: ({ anchor }) => anchor,
        };
      }
      if (name.endsWith('/vscode-url.js')) return { vscodeFolderUrl };
      if (name.endsWith('/open-in-app-controller.js')) {
        return { defaultOpenInAppController: undefined };
      }
      if (name.endsWith('/open-in-app.css')) return { __esModule: true, default: css };
      return {};
    },
    exports,
  );

  const button = exports.OpenInAppButton;
  const t = (key, values) => (values === undefined ? key : key + ':' + values.app);
  return {
    render() {
      cursor = 0;
      pending = [];
      const node = button({ path, t, controller });
      for (const effect of pending) effect();
      return node;
    },
    dispose() {
      for (const effect of effects) effect?.cleanup?.();
    },
  };
}

function findAll(node, predicate) {
  if (!node || typeof node !== 'object') return [];
  const children = node.props?.children;
  const nested = Array.isArray(children)
    ? children.flatMap((child) => findAll(child, predicate))
    : findAll(children, predicate);
  return [...(predicate(node) ? [node] : []), ...nested];
}

const recordedPath = '/tmp/repo with spaces/支付';

test('OpenInAppButton uses the VS Code fallback when no host application is available', async () => {
  const controller = new OpenInAppController(async (url) => {
    assert.equal(url, '/open-in-app/apps');
    return { ok: true, json: async () => ({ apps: [] }) };
  });
  const harness = createButtonHarness(controller, recordedPath);

  let node;
  assert.doesNotThrow(() => {
    node = harness.render();
  });
  await controller.load();
  node = harness.render();

  assert.equal(node.type, 'a');
  assert.equal(node.props.href, vscodeFolderUrl(recordedPath));
  assert.equal(node.props['data-dashboard-action'], 'open-editor');
  harness.dispose();
});

test('OpenInAppButton keeps Dashboard rendering safe when an open-in-app endpoint fails', async () => {
  const controller = new OpenInAppController(async (url) => {
    if (url === '/open-in-app/apps') {
      return { ok: true, json: async () => ({ apps: ['button-failure-app'] }) };
    }
    if (url === '/open-in-app/open') return { ok: false, status: 503 };
    throw new Error('unexpected endpoint');
  });
  await controller.load();
  const harness = createButtonHarness(controller, recordedPath);
  let node;
  assert.doesNotThrow(() => {
    node = harness.render();
  });

  const icon = findAll(node, (item) => item.type === 'img')[0];
  assert.equal(icon.props.src, '/open-in-app/icon/button-failure-app');
  icon.props.onError();
  node = harness.render();
  assert.equal(findAll(node, (item) => item.type === 'img').length, 0);
  assert.ok(findAll(node, (item) => item.type === 'svg' && item.props.className === 'icon').length >= 1);

  const mainButton = findAll(
    node,
    (item) => item.type === 'button' && item.props['data-state'] !== undefined,
  )[0];
  assert.ok(mainButton);
  assert.doesNotThrow(() => mainButton.props.onClick());
  await new Promise((resolve) => setImmediate(resolve));
  node = harness.render();
  assert.equal(
    findAll(node, (item) => item.type === 'button' && item.props['data-state'] === 'error').length,
    1,
  );
  harness.dispose();
});

test('OpenInAppButton retains the first available app after a fresh controller is created', async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({ apps: ['first-app', 'second-app'] }),
  });
  const controller = new OpenInAppController(fetcher);
  await controller.load();
  const firstHarness = createButtonHarness(controller, recordedPath);
  let node = firstHarness.render();
  assert.equal(
    findAll(node, (item) => item.type === 'button' && item.props['data-state'] !== undefined)[0]
      .props['aria-label'],
    'dashboard.openIn:first-app',
  );
  controller.choose('second-app');
  node = firstHarness.render();
  assert.equal(
    findAll(node, (item) => item.type === 'button' && item.props['data-state'] !== undefined)[0]
      .props['aria-label'],
    'dashboard.openIn:second-app',
  );
  firstHarness.dispose();

  const refreshedController = new OpenInAppController(fetcher);
  await refreshedController.load();
  const refreshedHarness = createButtonHarness(refreshedController, recordedPath);
  node = refreshedHarness.render();
  assert.equal(
    findAll(node, (item) => item.type === 'button' && item.props['data-state'] !== undefined)[0]
      .props['aria-label'],
    'dashboard.openIn:first-app',
  );
  refreshedHarness.dispose();
});
