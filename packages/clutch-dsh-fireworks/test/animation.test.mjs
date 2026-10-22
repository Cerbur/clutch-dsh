import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import {
  parseAnimation,
  parseAnimationPreferences,
  DEFAULT_ANIMATION_PREFERENCES,
  MAX_SCRIPT_BYTES,
} from '../lib/animation.js';
import { animationDocument } from '../lib/client/animation-sandbox.js';
import { FireworksController } from '../lib/client/fireworks-controller.js';
import { FIREWORKS_EVENT_TTL_MS, FIREWORKS_LAUNCH_EVENT } from '../lib/contract/index.js';

const source = (body = 'fx.circle(30, 40, 12, "red");', durationMs = 1200) =>
  '// clutch_fireworks: ' +
  JSON.stringify({ version: 1, name: 'Test', durationMs }) +
  '\nfunction render(frame, fx) {' +
  body +
  '}';

test('validates imported files without executing code, bounds scripts and template selections', () => {
  assert.equal(
    parseAnimation(source('throw new Error("must not execute while importing")'), 'custom-test')
      .durationMs,
    1200,
  );
  assert.deepEqual(parseAnimationPreferences(undefined), DEFAULT_ANIMATION_PREFERENCES);
  assert.equal(
    parseAnimationPreferences({ active: 'custom-a', scripts: { 'custom-a': source() } }).active,
    'custom-a',
  );
  for (const invalid of [
    '',
    '{}',
    source('', 499),
    source('', 8001),
    source().replace('"version":1', '"version":2'),
    source() + ' '.repeat(MAX_SCRIPT_BYTES),
  ])
    assert.throws(() => parseAnimation(invalid, 'custom-a'));
  for (const invalid of [
    null,
    {},
    { active: 'missing', scripts: {} },
    { active: 'emoji', scripts: { emoji: source() } },
    {
      active: 'emoji',
      scripts: Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['custom-' + i, source()])),
    },
  ])
    assert.throws(() => parseAnimationPreferences(invalid));
});

function sandboxHarness(template) {
  let workerSource;
  let worker;
  let onHide;
  let terminated = 0;
  let revoked = 0;
  let raf;
  const timers = new Map();
  const reports = [];
  const html = animationDocument(template, 'playback-token', 42, '</script><script>bad()</script>');
  const runtime = html.split('<script>')[1].split('</script>')[0];
  vm.runInNewContext(runtime, {
    document: { querySelector: () => ({ transferControlToOffscreen: () => ({}) }) },
    Blob: class {
      constructor(parts) {
        workerSource = parts.join('');
      }
    },
    URL: {
      createObjectURL: () => 'blob:opaque-origin',
      revokeObjectURL: () => {
        revoked++;
      },
    },
    Worker: class {
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Expose the fake worker so the test can deliver its messages.
        worker = this;
        this.sent = [];
      }
      postMessage(value) {
        this.sent.push(value);
      }
      terminate() {
        terminated++;
      }
    },
    parent: { postMessage: (value) => reports.push(value) },
    addEventListener: (_name, listener) => {
      onHide = listener;
    },
    setTimeout: (listener, delay) => {
      const id = {};
      timers.set(id, { listener, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (listener) => {
      raf = listener;
      return 1;
    },
    cancelAnimationFrame: () => {
      raf = undefined;
    },
    innerWidth: 500,
    matchMedia: () => ({ matches: false }),
    innerHeight: 300,
    devicePixelRatio: 1,
  });
  return {
    html,
    workerSource,
    reports,
    worker,
    timers,
    frame: (time) => raf(time),
    hide: () => onHide(),
    get terminated() {
      return terminated;
    },
    get revoked() {
      return revoked;
    },
  };
}

test('sandbox escapes script terminators and locks down parent DOM, network and inline resources', () => {
  const harness = sandboxHarness(parseAnimation(source('const text = "</script>";'), 'custom-a'));
  assert.equal(harness.html.match(/<script>/g).length, 1);
  assert.match(harness.html, /connect-src 'none'/);
  assert.match(harness.html, /default-src 'none'/);
  assert.match(harness.workerSource, /<\/script>/);
  harness.hide();
  assert.equal(harness.terminated, 1);
  assert.equal(harness.revoked, 1);
});

test('renderer frame watchdog kills stuck scripts and releases Worker and Blob', () => {
  const harness = sandboxHarness(parseAnimation(source(), 'custom-a'));
  harness.worker.onmessage({ data: { type: 'ready' } });
  harness.frame(100);
  const watchdog = [...harness.timers.values()].find(({ delay }) => delay === 750);
  watchdog.listener();
  assert.equal(harness.terminated, 1);
  assert.equal(harness.revoked, 1);
  assert.equal(harness.reports[0].type, 'clutch_fireworks/error');
});

test('real built-in scripts execute through shared drawing helpers; runtime errors are contained', async () => {
  for (const id of ['emoji', 'classic', 'rings', 'example-custom', 'broken']) {
    const script =
      id === 'broken'
        ? source('throw new Error("broken script")')
        : await readFile(
            new globalThis.URL('../assets/animations/' + id + '.js', import.meta.url),
            'utf8',
          );
    const template = parseAnimation(script, id);
    const harness = sandboxHarness(template);
    const posted = [];
    const draws = [];
    const drawing = new Proxy(
      {},
      {
        get:
          (_target, key) =>
          (...args) => {
            draws.push([key, args]);
            if (key === 'measureText') return { width: 64 };
          },
        set: () => true,
      },
    );
    const worker = vm.createContext({ postMessage: (value) => posted.push(value) });
    vm.runInContext(harness.workerSource, worker);
    worker.onmessage({ data: { type: 'init', canvas: { getContext: () => drawing } } });
    worker.onmessage({
      data: {
        type: 'frame',
        frame: {
          width: 800,
          height: 600,
          dpr: 1,
          seed: 42,
          time: 700,
          progress: 0.2,
          durationMs: template.durationMs,
        },
      },
    });
    assert.equal(posted.at(-1).type, id === 'broken' ? 'error' : 'painted');
    if (id !== 'broken')
      assert.ok(
        draws.some(([name]) => ['fillText', 'arc', 'lineTo'].includes(name)),
        id + ' must paint',
      );
    if (id === 'emoji') {
      const glyphs = draws.filter(([name]) => name === 'fillText').map(([, args]) => args[0]);
      assert.equal(glyphs.length, 40);
      assert.ok(glyphs.filter((glyph) => glyph === '🎉').length >= 10);
      assert.ok(glyphs.filter((glyph) => glyph === '🌟').length >= 5);
      assert.ok(glyphs.filter((glyph) => glyph === '✨').length >= 5);
    }
    harness.hide();
  }
});

test('helpers reuse emoji and glow rasters as particles move, scale, rotate and fade', () => {
  const harness = sandboxHarness(
    parseAnimation(
      source(`
    for (let i = 0; i < 40; i++) {
      fx.emoji('🎉', i * 10, 100, 20 + frame.time / 100 + i / 10, 1, frame.time / 1000);
      fx.circle(i * 10, frame.time / 10, 2.5, 'red', frame.time / 1000, 10);
      fx.emoji('hidden', 0, 0, 32, 0);
    }
  `),
      'custom-cache',
    ),
  );
  let rasterizations = 0;
  let glows = 0;
  let blits = 0;
  const context = () =>
    new Proxy(
      {
        globalCompositeOperation: 'source-over',
        measureText: () => ({ width: 64 }),
        arc: () => {
          glows++;
        },
        fillText: () => {
          rasterizations++;
        },
        drawImage: () => {
          blits++;
        },
      },
      { get: (target, name) => target[name] ?? (() => {}) },
    );
  const canvas = { width: 500, height: 300, getContext: context };
  const worker = vm.createContext({
    postMessage: () => {},
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return context();
      }
    },
  });
  vm.runInContext(harness.workerSource, worker);
  worker.onmessage({ data: { type: 'init', canvas } });
  for (let time = 100; time <= 1000; time += 100)
    worker.onmessage({
      data: {
        type: 'frame',
        frame: {
          width: 500,
          height: 300,
          dpr: 1,
          seed: 42,
          time,
        },
      },
    });
  assert.equal(rasterizations, 1, 'changing size must not rasterize every particle on every frame');
  assert.equal(glows, 1, 'all glowing particles share the same blurred sprite');
  assert.equal(blits, 800, 'all visible particles still draw on every frame');
  worker.onmessage({
    data: {
      type: 'frame',
      frame: {
        width: 500,
        height: 300,
        dpr: 2,
        seed: 42,
        time: 1100,
      },
    },
  });
  assert.equal(rasterizations, 2, 'DPR changes refresh glyph resolution');
  assert.equal(glows, 2, 'DPR changes refresh glow resolution');
  for (const time of [8000, 20000])
    worker.onmessage({
      data: { type: 'frame', frame: { width: 500, height: 300, dpr: 2, seed: 42, time } },
    });
  assert.equal(
    rasterizations,
    43,
    'large emoji draw directly even after a smaller size was cached',
  );
  harness.hide();
});

test('sprite caches bound entries and pixels while overflow still draws', () => {
  for (const dpr of [0.5, 2]) {
    const harness = sandboxHarness(
      parseAnimation(
        source(`
      for (let i = 0; i < 150; i++) fx.emoji(String(i), i, 100);
    `),
        'custom-budget',
      ),
    );
    const allocated = [];
    let draws = 0;
    const drawing = new Proxy(
      {
        measureText: () => ({ width: 64 }),
        drawImage: () => {
          draws++;
        },
        fillText: () => {
          draws++;
        },
      },
      { get: (target, name) => target[name] ?? (() => {}) },
    );
    const worker = vm.createContext({
      postMessage: () => {},
      OffscreenCanvas: class {
        constructor(width, height) {
          this.width = width;
          this.height = height;
          allocated.push(width * height);
        }
        getContext() {
          return drawing;
        }
      },
    });
    vm.runInContext(harness.workerSource, worker);
    worker.onmessage({ data: { type: 'init', canvas: { getContext: () => drawing } } });
    worker.onmessage({
      data: { type: 'frame', frame: { width: 500, height: 300, dpr, seed: 42 } },
    });
    assert.equal(allocated.length, dpr === 0.5 ? 128 : 30);
    assert.ok(allocated.reduce((sum, pixels) => sum + pixels, 0) <= 2_000_000);
    // Cached particles paint once into the sprite and once onto the frame; overflow paints directly.
    assert.equal(draws - allocated.length, 150);
    harness.hide();
  }
});

test('each queued event captures its template only after the previous animation and toast finish', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let selected = parseAnimation(source('', 1000), 'custom-a');
  const controller = new FireworksController(
    async () => {},
    Date.now,
    () => selected,
  );
  t.after(() => controller.stop());
  const launch = (id) => ({
    type: FIREWORKS_LAUNCH_EVENT,
    id,
    sessionId: 'origin',
    issuedAt: 1000,
    expiresAt: 1000 + FIREWORKS_EVENT_TTL_MS,
  });
  controller.accept([launch('one'), launch('two')]);
  selected = parseAnimation(source('', 2000), 'custom-b');
  assert.equal(controller.getSnapshot().animation.id, 'custom-a');
  const first = controller.getSnapshot().burst;
  t.mock.timers.tick(1000);
  controller.reportPlayback(first, 'done');
  assert.equal(controller.getSnapshot().burst, undefined);
  assert.equal(controller.getSnapshot().toast.id, 'one');
  t.mock.timers.tick(7000);
  assert.equal(controller.getSnapshot().burst.id, 'two');
  assert.equal(controller.getSnapshot().animation.id, 'custom-b');
  controller.dismissToast();
  assert.equal(controller.getSnapshot().burst.id, 'two');
  controller.reportPlayback(controller.getSnapshot().burst, 'done');
  assert.equal(controller.getSnapshot().burst, undefined);
});
