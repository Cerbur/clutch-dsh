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

function sandboxHarness(
  template,
  { reducedMotion = false, width = 500, height = 300, dpr = 1 } = {},
) {
  let workerSource;
  let worker;
  let onHide;
  let terminated = 0;
  let revoked = 0;
  let raf;
  let now = 0;
  const timers = new Map();
  const reports = [];
  const html = animationDocument(template, 'playback-token', 42, '</script><script>bad()</script>');
  const runtime = html.split('<script>')[1].split('</script>')[0];
  const environment = {
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
    innerWidth: width,
    matchMedia: () => ({ matches: reducedMotion }),
    innerHeight: height,
    devicePixelRatio: dpr,
    performance: { now: () => now },
  };
  vm.runInNewContext(runtime, environment);
  return {
    html,
    workerSource,
    reports,
    worker,
    timers,
    resize: (width, height, dpr) => {
      environment.innerWidth = width;
      environment.innerHeight = height;
      environment.devicePixelRatio = dpr;
    },
    frame: (time) => {
      now = time;
      const callback = raf;
      raf = undefined;
      callback(time);
    },
    hide: () => onHide(),
    get terminated() {
      return terminated;
    },
    get revoked() {
      return revoked;
    },
  };
}

test('reduced-motion midpoint stays visible for the duration and completes only after validation', () => {
  const harness = sandboxHarness(parseAnimation(source(), 'custom-static'), {
    reducedMotion: true,
  });
  harness.worker.onmessage({ data: { type: 'ready' } });
  harness.frame(100);
  assert.equal(harness.worker.sent.at(-1).frame.time, 600);
  harness.worker.onmessage({ data: { type: 'painted' } });
  assert.deepEqual(
    harness.reports.map(({ type }) => type),
    ['clutch_fireworks/ready'],
  );
  assert.equal(harness.terminated, 0, 'a single midpoint frame must not end playback');
  for (const now of [101, 700, 1299]) {
    harness.frame(now);
    if (now === 101) assert.equal(harness.worker.sent.at(-1).frame.time, 0);
    harness.worker.onmessage({ data: { type: 'painted' } });
    assert.equal(harness.reports.length, 1, 'must retain the frame until the configured end');
  }
  harness.frame(1301);
  assert.equal(harness.worker.sent.at(-1).frame.progress, 1, 'validate the end frame too');
  assert.equal(harness.reports.length, 1, 'wait for the final frame acknowledgement');
  harness.worker.onmessage({ data: { type: 'painted' } });
  assert.equal(harness.reports.at(-1).type, 'clutch_fireworks/done');
  assert.equal(harness.terminated, 1);
  assert.equal(harness.revoked, 1);
  assert.equal(harness.timers.size, 0);
});

for (const [name, body, result] of [
  ['success', '', 'done'],
  ['error after midpoint', 'if (frame.progress > 0.75) throw new Error("late failure");', 'error'],
  ['error at endpoint', 'if (frame.progress === 1) throw new Error("end failure");', 'error'],
])
  test('reduced-motion full preview: ' + name, () => {
    const template = parseAnimation(
      source(body + 'fx.circle(30, 40, 12, "red");'),
      'custom-late-error',
    );
    const controller = new FireworksController(async () => {});
    const statuses = [];
    controller.previewAnimation(template, (status) => statuses.push(status));
    const preview = controller.getSnapshot().burst;
    const harness = sandboxHarness(template, { reducedMotion: true });
    let shown = 0;
    let hidden = 0;
    const context = (draw) =>
      new Proxy({ arc: draw }, { get: (target, key) => target[key] ?? (() => {}) });
    const runtime = vm.createContext({
      postMessage: (data) => {
        harness.worker.onmessage({ data });
        for (const report of harness.reports.splice(0))
          controller.reportPlayback(preview, report.type.split('/')[1], report.message);
      },
      OffscreenCanvas: class {
        getContext() {
          return context(() => hidden++);
        }
      },
    });
    vm.runInContext(harness.workerSource, runtime);
    runtime.onmessage({
      data: { type: 'init', canvas: { getContext: () => context(() => shown++) } },
    });
    try {
      for (const time of [100, 101, 700, 1100]) {
        harness.frame(time);
        runtime.onmessage({ data: harness.worker.sent.at(-1) });
        if (time === 100)
          assert.deepEqual(statuses, ['ready'], 'midpoint success must leave validation pending');
      }
      if (statuses.length === 1) {
        harness.frame(1301);
        runtime.onmessage({ data: harness.worker.sent.at(-1) });
      }
      assert.deepEqual(
        statuses,
        ['ready', result],
        'one painted midpoint cannot validate the draft',
      );
      assert.equal(controller.getSnapshot().preview, undefined);
      assert.equal(shown, 1, 'only the static midpoint may paint to the displayed canvas');
      assert.ok(hidden > 0, 'timeline validation must draw on a separate canvas');
      assert.equal(harness.terminated, 1);
      assert.equal(harness.revoked, 1);
    } finally {
      controller.stop();
      harness.hide();
    }
  });

test('reduced-motion validation remains bounded by watchdog and page cleanup', () => {
  for (const cleanup of ['timeout', 'pagehide']) {
    const harness = sandboxHarness(parseAnimation(source(), 'custom-cleanup'), {
      reducedMotion: true,
    });
    harness.worker.onmessage({ data: { type: 'ready' } });
    harness.frame(100);
    harness.worker.onmessage({ data: { type: 'painted' } });
    harness.frame(101);
    if (cleanup === 'timeout') [...harness.timers.values()][0].listener();
    else harness.hide();
    assert.equal(harness.terminated, 1);
    assert.equal(harness.revoked, 1);
    assert.equal(harness.timers.size, 0);
    assert.equal(
      harness.reports.some(({ type }) => type === 'clutch_fireworks/done'),
      false,
    );
    harness.worker.onmessage({ data: { type: 'painted' } });
    harness.hide();
    assert.equal(harness.terminated, 1, 'late callbacks cannot revive a completed playback');
  }
});

function connectSandboxWorker(harness) {
  const draws = [];
  const hidden = [];
  const context = (target) =>
    new Proxy(
      { fillRect: (...args) => target.push(args) },
      { get: (target, key) => target[key] ?? (() => {}) },
    );
  const canvas = { getContext: () => context(draws) };
  const runtime = vm.createContext({
    postMessage: (data) => harness.worker.onmessage({ data }),
    OffscreenCanvas: class {
      getContext() {
        return context(hidden);
      }
    },
  });
  vm.runInContext(harness.workerSource, runtime);
  let delivered = harness.worker.sent.length;
  runtime.onmessage({ data: { type: 'init', canvas } });
  const step = () => runtime.onmessage({ data: harness.worker.sent[delivered++] });
  const flush = () => {
    while (delivered < harness.worker.sent.length) step();
  };
  return { canvas, draws, hidden, step, flush };
}

test('reduced-motion resize redraws the visible midpoint while preserving timeline and deadline', () => {
  const harness = sandboxHarness(
    parseAnimation(
      source('frame.ctx.fillRect(frame.width / 2, frame.height / 2, frame.time, frame.dpr);'),
      'custom-resize',
    ),
    { reducedMotion: true },
  );
  const { canvas, draws, hidden, step, flush } = connectSandboxWorker(harness);
  harness.frame(100);
  flush();
  assert.deepEqual(draws, [[250, 150, 600, 1]]);
  harness.frame(101);
  flush();
  assert.deepEqual(hidden, [[250, 150, 0, 1]]);

  for (const [time, width, height, dpr] of [
    [400, 300, 500, 1],
    [700, 300, 500, 2],
    [1000, 7680, 4320, 3],
  ]) {
    harness.resize(width, height, dpr);
    harness.frame(time);
    flush();
    const appliedDpr = Math.min(dpr, 2, Math.sqrt(8_000_000 / (width * height)));
    assert.equal(canvas.width, Math.floor(width * appliedDpr));
    assert.equal(canvas.height, Math.floor(height * appliedDpr));
    assert.ok(canvas.width * canvas.height <= 8_000_000);
    assert.deepEqual(draws.at(-1), [width / 2, height / 2, 600, appliedDpr]);
    assert.deepEqual(hidden.at(-1), [width / 2, height / 2, time - 101, appliedDpr]);
    assert.equal(harness.reports.length, 1, 'resize must not report ready or finish again');
  }
  assert.equal(draws.length, 4, 'redraw only when dimensions or DPR change');
  harness.frame(1200);
  flush();
  assert.equal(draws.length, 4);
  assert.equal(harness.reports.length, 1);

  // Resize at the original deadline; even a midpoint acknowledgement cannot complete validation.
  harness.resize(500, 300, 1);
  harness.frame(1301);
  assert.equal(harness.reports.length, 1);
  step();
  assert.equal(harness.reports.length, 1, 'midpoint redraw must not complete playback');
  assert.equal(harness.terminated, 0);
  assert.equal(harness.worker.sent.at(-1).type, 'validate');
  step();
  assert.deepEqual(draws.at(-1), [250, 150, 600, 1]);
  assert.deepEqual(hidden.at(-1), [250, 150, 1200, 1]);
  assert.deepEqual(
    harness.reports.map(({ type }) => type),
    ['clutch_fireworks/ready', 'clutch_fireworks/done'],
  );
  assert.equal(harness.terminated, 1);
  assert.equal(harness.revoked, 1);
  assert.equal(harness.timers.size, 0);
  harness.hide();
  assert.equal(harness.terminated, 1);
});

for (const [name, body, time] of [
  [
    'midpoint redraw',
    'if (frame.width === 300 && frame.progress === 0.5) throw new Error("resize failure");',
    700,
  ],
  ['timeline after resize', 'if (frame.time > 800) throw new Error("late failure");', 1000],
  ['endpoint after resize', 'if (frame.progress === 1) throw new Error("end failure");', 1301],
])
  test('reduced-motion resize contains errors during ' + name, () => {
    const harness = sandboxHarness(parseAnimation(source(body), 'custom-resize-error'), {
      reducedMotion: true,
    });
    const { flush } = connectSandboxWorker(harness);
    harness.frame(100);
    flush();
    harness.frame(101);
    flush();
    harness.resize(300, 500, 2);
    harness.frame(time);
    flush();
    assert.deepEqual(
      harness.reports.map(({ type }) => type),
      ['clutch_fireworks/ready', 'clutch_fireworks/error'],
    );
    assert.equal(harness.terminated, 1);
    assert.equal(harness.revoked, 1);
    assert.equal(harness.timers.size, 0);
    harness.worker.onmessage({ data: { type: 'painted' } });
    harness.hide();
    assert.equal(harness.reports.length, 2);
    assert.equal(harness.terminated, 1);
  });

for (const cleanup of ['timeout', 'pagehide'])
  for (const phase of ['redraw', 'validation'])
    test('reduced-motion resize releases resources on ' + cleanup + ' during ' + phase, () => {
      const harness = sandboxHarness(parseAnimation(source(), 'custom-resize-cleanup'), {
        reducedMotion: true,
      });
      const { step, flush } = connectSandboxWorker(harness);
      harness.frame(100);
      flush();
      harness.frame(101);
      flush();
      harness.resize(300, 500, 2);
      harness.frame(700);
      if (phase === 'validation') step();
      assert.equal(harness.timers.size, 1, 'each pending paint is guarded');
      assert.equal([...harness.timers.values()][0].delay, 750);
      const sent = harness.worker.sent.length;
      if (cleanup === 'timeout') [...harness.timers.values()][0].listener();
      else harness.hide();
      harness.worker.onmessage({ data: { type: 'painted' } });
      harness.hide();
      assert.equal(harness.worker.sent.length, sent, 'late redraw cannot resume validation');
      assert.equal(harness.terminated, 1);
      assert.equal(harness.revoked, 1);
      assert.equal(harness.timers.size, 0);
      assert.deepEqual(
        harness.reports.map(({ type }) => type),
        cleanup === 'timeout'
          ? ['clutch_fireworks/ready', 'clutch_fireworks/error']
          : ['clutch_fireworks/ready'],
      );
    });

test('large windows retain CSS dimensions and aspect ratio within the backing-pixel budget', () => {
  for (const [width, height, dpr] of [
    [5120, 1440, 1],
    [5120, 1440, 2],
    [7680, 4320, 2],
    [1440, 5120, 2],
  ]) {
    const harness = sandboxHarness(parseAnimation(source(), 'custom-wide'), { width, height, dpr });
    harness.worker.onmessage({ data: { type: 'ready' } });
    harness.frame(100);
    const frame = harness.worker.sent.at(-1).frame;
    assert.equal(frame.width, width);
    assert.equal(frame.height, height);
    assert.ok(frame.dpr <= Math.min(dpr, 2));
    const canvas = { getContext: () => new Proxy({}, { get: () => () => {} }) };
    const runtime = vm.createContext({ postMessage: () => {} });
    vm.runInContext(harness.workerSource, runtime);
    runtime.onmessage({ data: { type: 'init', canvas } });
    runtime.onmessage({ data: harness.worker.sent.at(-1) });
    const { width: pixelWidth, height: pixelHeight } = canvas;
    assert.ok(pixelWidth * pixelHeight <= 8_000_000);
    assert.ok(Math.abs(pixelWidth / pixelHeight - width / height) < 0.002);
    harness.hide();
  }
});

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
