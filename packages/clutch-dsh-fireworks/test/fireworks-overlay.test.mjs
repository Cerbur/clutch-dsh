import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { FireworksController } from '../lib/client/fireworks-controller.js';
import { FIREWORKS_LAUNCH_EVENT, FIREWORKS_EVENT_TTL_MS } from '../lib/contract/index.js';

const {
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout,
  AbortController,
  TextEncoder,
  TextDecoder,
  TransformStream,
} = globalThis;

async function clientModule(
  fetchSse = () => {
    throw new Error('unused stream');
  },
) {
  let plugin;
  const jsx = (type, props, key) => ({ type, props: { ...props, key } });
  const react = {
    useState: (initial) => [initial, () => {}],
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  vm.runInNewContext(await readFile(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load({ factory }) {
          plugin = factory((name) => {
            if (name === 'react') return react;
            if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
            throw new Error('Unexpected browser dependency: ' + name);
          });
        },
      },
    },
    document: { querySelector: () => ({}) },
    setTimeout,
    clearTimeout,
    AbortController,
    TextEncoder,
    TextDecoder,
    URLSearchParams,
    TransformStream,
    fetch: fetchSse,
  });
  return plugin;
}

function elements(node) {
  if (node === null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node.type === 'function') return elements(node.type(node.props));
  return [node, ...elements(node.props?.children)];
}

test('clickable toast opens its own Session and leaves the global animation running', async () => {
  const plugin = await clientModule();
  const controller = new FireworksController(async () => {
    throw new Error('unused');
  });
  const event = {
    type: FIREWORKS_LAUNCH_EVENT,
    id: 'background-call',
    sessionId: 'source-session',
    issuedAt: Date.now(),
    expiresAt: Date.now() + FIREWORKS_EVENT_TTL_MS,
    message: 'Feature verified',
  };
  controller.accept([event]);
  const opened = [];
  const tree = plugin.FireworksOverlay({ controller, openSession: (id) => opened.push(id) });
  const childKeys = tree.props.children.filter(Boolean).map((child) => child.props.key);
  assert.equal(
    new Set(childKeys).size,
    childKeys.length,
    'toast and particles need distinct sibling keys',
  );
  const buttons = elements(tree).filter((node) => node.type === 'button');
  assert.equal(buttons.length, 2);
  buttons[0].props.onClick();
  assert.deepEqual(opened, ['source-session']);
  assert.equal(controller.getSnapshot().toast, undefined);
  assert.equal(controller.getSnapshot().burst.id, 'background-call');
  controller.stop();
});

test('preview and tool launches mount the same surface with the same completion callback', async () => {
  const plugin = await clientModule();
  const animation = { id: 'emoji', name: 'Emoji', durationMs: 3200, source: '' };
  const controller = new FireworksController(
    async () => {},
    Date.now,
    () => animation,
  );
  const surface = () => {
    const tree = plugin.FireworksOverlay({ controller, openSession: () => {} });
    const particles = tree.props.children.filter(Boolean).find((node) => node.props['aria-hidden']);
    return particles.props.children;
  };
  controller.previewAnimation(animation, () => {});
  const previewSurface = surface();
  assert.equal(previewSurface.props.signal, controller.getSnapshot().burst);
  assert.equal(previewSurface.props.template, animation);
  previewSurface.props.onStatus('done');
  assert.equal(controller.getSnapshot().burst, undefined);
  controller.accept([
    {
      type: FIREWORKS_LAUNCH_EVENT,
      id: 'live',
      sessionId: 'origin',
      issuedAt: Date.now(),
      expiresAt: Date.now() + FIREWORKS_EVENT_TTL_MS,
    },
  ]);
  const liveSurface = surface();
  assert.equal(liveSurface.type, previewSurface.type);
  assert.equal(liveSurface.props.signal, controller.getSnapshot().burst);
  assert.equal(liveSurface.props.template, animation);
  liveSurface.props.onStatus('done');
  assert.equal(controller.getSnapshot().burst, undefined);
  assert.equal(controller.getSnapshot().toast.sessionId, 'origin');
  controller.stop();
});

test('client registers one root overlay and mounts one native Remote contribution', async () => {
  const streams = [];
  const plugin = await clientModule(() => {
    throw new Error('fireworks must not fetch its own stream');
  });
  const effects = [];
  let injected, controller, settingsPlayback;
  let mounts = 0,
    unmounts = 0;
  const opened = [];
  const context = {
    remote: {
      async $mount(contribution) {
        assert.equal(contribution.package, '@cerbur/clutch-dsh-fireworks');
        assert.equal(contribution.descriptors[0].mode, 'stream');
        mounts++;
        return async () => {
          unmounts++;
        };
      },
      clutch_fireworks: {
        events(query, signal) {
          streams.push({ query, signal });
          return {
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise((resolve) =>
                    signal.addEventListener('abort', () => resolve({ done: true }), { once: true }),
                  ),
              };
            },
            dispose() {},
          };
        },
      },
    },
    connection: {
      rpc: {
        async call(_channel, _endpoint, _query, signal) {
          return new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }),
          );
        },
      },
    },
    uiWorkspace: { openSession: (id) => opened.push(id) },
    async effect(effect) {
      const cleanup = await effect();
      effects.push(cleanup);
    },
    slots: {
      inject(name, register) {
        assert.ok(['shell.overlay', 'plugins.bundle.config'].includes(name));
        register();
      },
      register(options, component) {
        if (options.name === 'plugins.bundle.config') {
          assert.equal(options.key, '@cerbur/clutch-dsh-fireworks');
          settingsPlayback = options.inject().playback;
          return;
        }
        assert.equal(options.name, 'shell.overlay');
        assert.equal(component, plugin.FireworksOverlay);
        injected = options.inject();
        controller = injected.controller;
      },
    },
  };
  context.inject = (deps, callback) => {
    assert.deepEqual(Array.from(deps), ['remote.clutch_fireworks']);
    return callback(context);
  };
  await plugin.apply(context);
  assert.equal(mounts, 1);
  assert.equal(streams.length, 1);
  assert.equal(Object.keys(streams[0].query).length, 0);
  assert.equal(settingsPlayback, controller);
  injected.openSession('origin');
  assert.deepEqual(opened, ['origin']);
  for (const cleanup of effects.reverse()) await cleanup();
  assert.equal(unmounts, 1);
  assert.equal(streams[0].signal.aborted, true);
  assert.equal(controller.getSnapshot().burst, undefined);
});
