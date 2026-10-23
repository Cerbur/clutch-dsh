import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import { readAnimationTheme, connectAnimationTheme } from '../lib/client/animation-theme.js';
import { validateAnimation } from '../lib/client/animation-validation.js';
import { FireworksController } from '../lib/client/fireworks-controller.js';
import { FIREWORKS_LAUNCH_EVENT } from '../lib/contract/index.js';
import { animationThemeHost, installAnimationThemeHost } from './helpers/animation-theme-host.mjs';
import { sandboxHarness, connectSandboxWorker } from './helpers/animation-harness.mjs';

const template = {
  id: 'custom-theme',
  name: 'Theme probe',
  durationMs: 1200,
  source: `function render(frame) {
    if (frame.theme !== 'light' && frame.theme !== 'dark') throw new Error('missing theme');
    frame.ctx.fillRect(frame.theme === 'light' ? 1 : 0, frame.time, frame.seed, frame.progress);
  }`,
};

test('resolved DSH scheme and explicit choices override the opposite OS preference', (t) => {
  const host = installAnimationThemeHost(t, { theme: 'light', osDark: true });
  assert.equal(readAnimationTheme(), 'light');
  host.setTheme('dark');
  host.setOsDark(false);
  assert.equal(readAnimationTheme(), 'dark');
  // DSH publishes a resolved scheme even when the preference is system/custom.
  host.root.setAttribute('data-ds-theme-source', 'system');
  assert.equal(readAnimationTheme(), 'dark');
  host.root.style.colorScheme = 'only light';
  assert.equal(readAnimationTheme(), 'light');
  host.root.style.colorScheme = 'normal';
  host.root.setAttribute('data-ds-theme-source', 'light');
  assert.equal(readAnimationTheme(), 'light');
  host.root.setAttribute('data-ds-theme-source', 'dark');
  assert.equal(readAnimationTheme(), 'dark');
});

test('older host palette/background signals precede OS, which is only a last fallback', (t) => {
  const host = installAnimationThemeHost(t, { theme: 'normal', osDark: false });
  host.root.removeAttribute('data-ds-theme-source');
  host.body.setAttribute('data-ds-dark-theme', '');
  assert.equal(readAnimationTheme(), 'dark');
  host.body.removeAttribute('data-ds-dark-theme');
  host.body.backgroundColor = 'rgb(15, 23, 42)';
  assert.equal(readAnimationTheme(), 'dark');
  host.body.backgroundColor = 'rgba(255, 255, 255, 1)';
  host.setOsDark(true);
  assert.equal(readAnimationTheme(), 'light');
  host.body.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  host.root.backgroundColor = 'rgb(255 255 255)';
  assert.equal(readAnimationTheme(), 'light');
  host.root.backgroundColor = 'transparent';
  assert.equal(readAnimationTheme(), 'dark');
  host.setOsDark(false);
  assert.equal(readAnimationTheme(), 'light');
});

test('host theme relay sends only an enum, resends on load and fully unsubscribes', (t) => {
  const host = installAnimationThemeHost(t, { osDark: true });
  const frame = host.createFrame();
  const cleanup = connectAnimationTheme(frame, 'secret');
  const first = { type: 'clutch_fireworks/theme', token: 'secret', theme: 'light' };
  assert.deepEqual(frame.messages, [{ data: first, targetOrigin: '*' }]);
  frame.load();
  assert.deepEqual(frame.messages[1].data, first);
  host.setOsDark(false);
  host.mutate(host.body, 'class');
  assert.equal(frame.messages.length, 2, 'unrelated mutations/OS cannot override explicit light');
  host.setTheme('dark');
  assert.deepEqual(frame.messages.at(-1).data, { ...first, theme: 'dark' });
  cleanup();
  host.setTheme('light');
  frame.load();
  assert.equal(frame.messages.length, 3);
  assert.equal(host.observers.size, 0);
  assert.equal(host.mediaListeners.size, 0);
  assert.equal(frame.listeners.size, 0);
});

test('opaque iframe authenticates theme updates and does not forward injected fields to the Worker', () => {
  const h = sandboxHarness(template, { theme: 'dark' });
  const { flush, draws } = connectSandboxWorker(h);
  h.frame(100);
  flush();
  assert.equal(draws.at(-1)[0], 0);
  for (const [data, source] of [
    [{ type: 'clutch_fireworks/theme', token: 'playback-token', theme: 'light' }, {}],
    [{ type: 'clutch_fireworks/theme', token: 'wrong', theme: 'light' }],
    [{ type: 'wrong', token: 'playback-token', theme: 'light' }],
    ...['system', null, {}, ['light'], 1].map((theme) => [
      { type: 'clutch_fireworks/theme', token: 'playback-token', theme },
    ]),
  ]) {
    h.receive(data, source);
    h.frame(200);
    flush();
    assert.equal(draws.at(-1)[0], 0);
  }
  h.receive({
    type: 'clutch_fireworks/theme',
    token: 'playback-token',
    theme: 'light',
    seed: 900,
    time: 0,
    durationMs: 8000,
    session: 'must not cross',
  });
  h.frame(600);
  flush();
  assert.deepEqual(draws.at(-1), [1, 500, 42, 500 / 1200]);
  assert.deepEqual(Object.keys(h.worker.sent.at(-1).frame).sort(), [
    'delta',
    'dpr',
    'durationMs',
    'height',
    'message',
    'progress',
    'seed',
    'theme',
    'time',
    'width',
  ]);
  h.frame(1300);
  flush();
  assert.equal(h.reports.at(-1).type, 'clutch_fireworks/done');
  assert.equal(h.terminated, 1);
  assert.equal(h.revoked, 1);
  assert.equal(h.listeners.get('message').size, 0);
  assert.equal(h.listeners.get('pagehide').size, 0);
  assert.match(h.html, /connect-src 'none'/);
  assert.doesNotMatch(h.html, /prefers-color-scheme/);
});

for (const cleanup of ['done', 'watchdog', 'pagehide']) {
  test(`reduced midpoint recolors without restarting the validation deadline (${cleanup})`, () => {
    const h = sandboxHarness(template, { reducedMotion: true, theme: 'dark' });
    const { draws, hidden, flush, step } = connectSandboxWorker(h);
    h.frame(100);
    flush();
    h.frame(101);
    flush();
    assert.deepEqual(draws, [[0, 600, 42, 0.5]]);
    h.receive({ type: 'clutch_fireworks/theme', token: 'playback-token', theme: 'light' });
    h.frame(700);
    step();
    assert.deepEqual(draws.at(-1), [1, 600, 42, 0.5]);
    assert.equal(h.reports.length, 1, 'midpoint acknowledgement cannot complete playback');
    assert.equal(h.worker.sent.at(-1).type, 'validate');
    flush();
    assert.deepEqual(hidden.at(-1), [1, 599, 42, 599 / 1200]);
    h.frame(800);
    flush();
    assert.equal(draws.length, 2, 'no animation of the visible reduced-motion canvas');
    // A theme change right at the original endpoint must still await final validation.
    h.receive({ type: 'clutch_fireworks/theme', token: 'playback-token', theme: 'dark' });
    h.frame(1301);
    assert.equal(h.worker.sent.at(-1).frame.time, 600);
    if (cleanup === 'done') {
      step();
      assert.equal(h.reports.length, 1);
      assert.equal(h.worker.sent.at(-1).frame.time, 1200);
      step();
      assert.equal(h.reports.at(-1).type, 'clutch_fireworks/done');
    } else if (cleanup === 'watchdog') {
      [...h.timers.values()].find(({ delay }) => delay === 750).listener();
      assert.equal(h.reports.at(-1).type, 'clutch_fireworks/error');
    } else h.hide();
    assert.equal(h.terminated, 1);
    assert.equal(h.revoked, 1);
    assert.equal(h.timers.size, 0);
    assert.equal(h.listeners.get('message').size, 0);
    const count = h.worker.sent.length;
    h.receive({ type: 'clutch_fireworks/theme', token: 'playback-token', theme: 'light' });
    h.worker.onmessage({ data: { type: 'painted' } });
    assert.equal(h.worker.sent.length, count, 'late theme/paint cannot revive a disposed driver');
  });
}

/** Run the actual bundled AnimationSurface via FireworksOverlay with stable hook identities. */
async function surfaceHarness(t, preview, reducedMotion) {
  const host = animationThemeHost({ theme: 'light', osDark: true });
  const hooks = [];
  let cursor = 0;
  let pending = [];
  let plugin;
  let tree;
  const frame = host.createFrame();
  const react = {
    useRef(initial) {
      return (hooks[cursor++] ??= { current: initial });
    },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [
        hooks[index],
        (value) => {
          hooks[index] = value;
        },
      ];
    },
    useMemo(calculate, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => value !== hooks[index].deps[i]))
        hooks[index] = { value: calculate(), deps };
      return hooks[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => value !== hooks[index].deps[i])) {
        pending.push(() => {
          hooks[index]?.cleanup?.();
          hooks[index] = { deps, cleanup: effect() };
        });
      }
    },
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  };
  const jsx = (type, props) => ({ type, props });
  host.window.__ModuleLoader__ = {
    load({ factory }) {
      plugin = factory((name) => {
        if (name === 'react') return react;
        if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
        throw new Error(name);
      });
    },
  };
  vm.runInNewContext(
    await readFile(new globalThis.URL('../lib/client.js', import.meta.url), 'utf8'),
    {
      ...host.globals,
      crypto: { randomUUID },
      TextEncoder: globalThis.TextEncoder,
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    },
  );
  const controller = new FireworksController(
    async () => {},
    Date.now,
    () => template,
  );
  const unmount = () => {
    for (const hook of hooks) hook?.cleanup?.();
    frame.sandbox?.hide();
    frame.remove();
  };
  t.after(() => {
    unmount();
    controller.stop();
  });
  if (preview) controller.previewAnimation(template, () => {});
  else
    controller.accept([
      {
        type: FIREWORKS_LAUNCH_EVENT,
        id: 'theme-event',
        sessionId: 'origin',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30_000,
      },
    ]);
  const render = () => {
    cursor = 0;
    const overlay = plugin.FireworksOverlay({ controller, openSession() {} });
    const surface = overlay.props.children.filter(Boolean).find((node) => node.props['aria-hidden'])
      .props.children;
    tree = surface.type(surface.props);
    if (tree?.type === 'iframe') {
      tree.props.ref.current = frame;
      frame.srcdoc = tree.props.srcDoc;
    }
    for (const effect of pending) effect();
    pending = [];
    return tree;
  };
  render();
  frame.sandbox = sandboxHarness(template, { html: frame.srcdoc, reducedMotion });
  frame.load();
  const worker = connectSandboxWorker(frame.sandbox);
  return { ...worker, host, frame, controller, render, unmount };
}

for (const preview of [false, true]) {
  for (const reducedMotion of [false, true]) {
    test(`actual surface delivers/updates host theme through iframe and Worker (preview ${preview}, reduced ${reducedMotion})`, async (t) => {
      const h = await surfaceHarness(t, preview, reducedMotion);
      const { sandbox } = h.frame;
      const initialDocument = h.frame.srcdoc;
      const burst = h.controller.getSnapshot().burst;
      const toast = h.controller.getSnapshot().toast;
      sandbox.frame(100);
      h.flush();
      h.host.report(h.frame, 'done', { source: {} });
      h.host.report(h.frame, 'done', { data: { token: 'wrong', type: 'clutch_fireworks/done' } });
      assert.equal(h.controller.getSnapshot().burst, burst);
      h.host.report(h.frame, 'ready');
      assert.equal(h.draws.at(-1)[0], 1, 'explicit DSH light overrides dark OS');
      if (reducedMotion) {
        sandbox.frame(101);
        h.flush();
      }
      h.host.setTheme('dark');
      h.render();
      assert.equal(h.frame.srcdoc, initialDocument, 'theme does not reload iframe/reset token');
      assert.equal(h.controller.getSnapshot().burst, burst);
      assert.equal(h.controller.getSnapshot().toast, toast);
      sandbox.frame(700);
      h.flush();
      assert.equal(h.draws.at(-1)[0], 0);
      assert.equal(h.draws.at(-1)[1], 600);
      assert.equal(sandbox.worker.sent.at(-1).frame.time, reducedMotion ? 599 : 600);
      assert.equal(sandbox.reports.length, 1);
      sandbox.frame(reducedMotion ? 1301 : 1300);
      h.flush();
      assert.equal(sandbox.reports.at(-1).type, 'clutch_fireworks/done');
      h.host.report(h.frame, 'done');
      assert.equal(h.controller.getSnapshot().burst, undefined);
      assert.equal(h.controller.getSnapshot().toast, toast);
      h.unmount();
      assert.equal(h.host.observers.size, 0);
      assert.equal(h.host.mediaListeners.size, 0);
      assert.equal(h.frame.listeners.size, 0);
      assert.equal(h.host.windowListeners.get('message').size, 0);
      assert.equal(sandbox.timers.size, 0);
      assert.equal(sandbox.terminated, 1);
    });
  }
}

test('theme changes do not extend the actual controller animation or toast deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = await surfaceHarness(t, false, false);
  h.frame.sandbox.frame(100);
  h.flush();
  h.host.report(h.frame, 'ready');
  const burst = h.controller.getSnapshot().burst;
  const toast = h.controller.getSnapshot().toast;
  t.mock.timers.tick(2100);
  h.host.setTheme('dark');
  h.render();
  t.mock.timers.tick(99);
  assert.equal(h.controller.getSnapshot().burst, burst);
  assert.equal(h.controller.getSnapshot().toast, toast);
  t.mock.timers.tick(1);
  assert.equal(h.controller.getSnapshot().burst, undefined, 'original ready + duration + grace');
  h.unmount();
  t.mock.timers.tick(5799);
  assert.equal(h.controller.getSnapshot().toast, toast);
  t.mock.timers.tick(1);
  assert.equal(h.controller.getSnapshot().toast, undefined, 'original eight-second toast lifetime');
});

test('a script failure after a theme update releases the host subscription on fallback', async (t) => {
  const h = await surfaceHarness(t, false, true);
  h.frame.sandbox.frame(100);
  h.flush();
  h.host.report(h.frame, 'ready');
  const toast = h.controller.getSnapshot().toast;
  h.host.setTheme('dark');
  h.frame.sandbox.frame(101);
  h.frame.sandbox.worker.onmessage({ data: { type: 'error', message: 'theme draw failed' } });
  h.host.report(h.frame, 'error');
  const fallback = h.render();
  assert.equal(typeof fallback.type, 'function', 'live failures retain trusted EmojiFallback');
  assert.equal(h.host.observers.size, 0);
  assert.equal(h.host.mediaListeners.size, 0);
  assert.equal(h.frame.listeners.size, 0);
  assert.equal(h.frame.sandbox.terminated, 1);
  assert.equal(h.controller.getSnapshot().toast, toast);
});

for (const reducedMotion of [false, true]) {
  test(`import preflight uses the same host theme and authenticated iframe/Worker protocol (${reducedMotion})`, async (t) => {
    const host = installAnimationThemeHost(t, { theme: 'light', osDark: true });
    const result = validateAnimation(template, new globalThis.AbortController().signal);
    const frame = host.frames[0];
    frame.sandbox = sandboxHarness(template, { html: frame.srcdoc, reducedMotion });
    host.setTheme('dark');
    const { flush, draws } = connectSandboxWorker(frame.sandbox);
    flush();
    assert.equal(draws.at(-1)[0], 0);
    assert.equal(draws.at(-1)[1], reducedMotion ? 600 : 0);
    assert.equal(frame.sandbox.reports.at(-1).type, 'clutch_fireworks/ready');
    assert.equal(frame.sandbox.terminated, 1);
    host.report(frame, 'ready');
    await result;
    assert.equal(frame.removed, true);
    assert.equal(host.observers.size, 0);
    assert.equal(host.mediaListeners.size, 0);
    assert.equal(frame.listeners.size, 0);
  });
}

test('legacy custom scripts ignoring theme still run unchanged with default dark', () => {
  const legacy = {
    ...template,
    source: 'function render(frame) { frame.ctx.fillRect(0, 0, frame.time, 1); }',
  };
  const h = sandboxHarness(legacy);
  const { flush, draws } = connectSandboxWorker(h);
  h.frame(100);
  flush();
  assert.deepEqual(draws.at(-1), [0, 0, 0, 1]);
  assert.equal(h.worker.sent.at(-1).frame.theme, 'dark');
  h.frame(1300);
  flush();
  assert.equal(h.reports.at(-1).type, 'clutch_fireworks/done');
});
