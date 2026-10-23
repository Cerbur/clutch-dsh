import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import {
  parseAnimation,
  parseAnimationPreferences,
  DEFAULT_ANIMATION_PREFERENCES,
  DEFAULT_STORED_ANIMATION_PREFERENCES,
  parseStoredAnimationPreferences,
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

test('new profiles default to classic without replacing explicit animation selections', () => {
  const expected = { active: 'classic', scripts: {} };
  const stored = { version: 2, active: 'classic', files: {} };
  assert.deepEqual(DEFAULT_ANIMATION_PREFERENCES, expected);
  assert.deepEqual(parseAnimationPreferences(undefined), expected);
  assert.deepEqual(DEFAULT_STORED_ANIMATION_PREFERENCES, stored);
  assert.deepEqual(parseStoredAnimationPreferences(undefined), stored);
  for (const active of ['emoji', 'rings', 'classic', 'custom-saved']) {
    const scripts = { 'custom-saved': source() };
    const preferences = { active, scripts };
    assert.deepEqual(parseAnimationPreferences(preferences), preferences);
    assert.deepEqual(parseStoredAnimationPreferences(preferences), preferences);
    const persisted = {
      version: 2,
      active,
      files: { 'custom-saved': 'clutch-dsh-fireworks/animations/' + 'a'.repeat(64) + '.js' },
    };
    assert.deepEqual(parseStoredAnimationPreferences(persisted), persisted);
  }
  assert.deepEqual(DEFAULT_ANIMATION_PREFERENCES, expected);
});

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
  {
    reducedMotion = false,
    width = 500,
    height = 300,
    dpr = 1,
    validationOnly = false,
    seed = 42,
  } = {},
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
  const html = animationDocument(
    template,
    'playback-token',
    seed,
    '</script><script>bad()</script>',
    validationOnly,
  );
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

function connectSandboxWorker(
  harness,
  context = (target) =>
    new Proxy(
      { fillRect: (...args) => target.push(args) },
      { get: (target, key) => target[key] ?? (() => {}) },
    ),
) {
  const draws = [];
  const hidden = [];
  const drawing = context(draws);
  const canvas = { getContext: () => drawing };
  const runtime = vm.createContext({
    postMessage: (data) => harness.worker.onmessage({ data }),
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.drawing = context(hidden);
      }
      getContext() {
        return this.drawing;
      }
    },
  });
  vm.runInContext(harness.workerSource, runtime);
  let delivered = harness.worker.sent.length;
  const dispatch = (data) => {
    runtime.pendingMessage = data;
    vm.runInContext('onmessage({ data: pendingMessage })', runtime, { timeout: 1000 });
  };
  dispatch({ type: 'init', canvas });
  const step = () => dispatch(harness.worker.sent[delivered++]);
  const flush = () => {
    while (delivered < harness.worker.sent.length) step();
  };
  return { canvas, draws, hidden, step, flush, render: dispatch };
}

// A small Canvas adapter, not a rasterizer: exercise the real worker's circle/line paths,
// alpha isolation and sprite blits, and reject unsupported methods instead of silently no-oping.
function pathDrawingContext(target) {
  let path = [];
  const stack = [];
  const defaults = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
  };
  const numeric = (values) =>
    values.forEach((value) => assert.ok(Number.isFinite(value), 'finite drawing coordinates'));
  const context = {
    ...defaults,
    reset() {
      assert.equal(stack.length, 0, 'drawing state must be balanced between frames');
      Object.assign(context, defaults);
      path = [];
    },
    setTransform(...args) {
      numeric(args);
    },
    save() {
      stack.push(Object.fromEntries(Object.keys(defaults).map((key) => [key, context[key]])));
    },
    restore() {
      assert.ok(stack.length, 'restore needs a matching save');
      Object.assign(context, stack.pop());
    },
    beginPath() {
      path = [];
    },
    arc(...args) {
      numeric(args);
      assert.ok(args[2] >= 0, 'circle radius cannot be negative');
      path.push(['arc', ...args]);
    },
    moveTo(...args) {
      numeric(args);
      path.push(['moveTo', ...args]);
    },
    lineTo(...args) {
      numeric(args);
      path.push(['lineTo', ...args]);
    },
    fill() {
      paint('fill', context.fillStyle);
    },
    stroke() {
      paint('stroke', context.strokeStyle);
    },
    drawImage(image, ...args) {
      numeric([image.width, image.height, ...args]);
      if (context.globalAlpha > 0)
        target.push(['drawImage', image.width, image.height, ...args, context.globalAlpha]);
    },
  };
  function paint(type, color) {
    assert.ok(
      Number.isFinite(context.globalAlpha) && context.globalAlpha >= 0 && context.globalAlpha <= 1,
    );
    if (context.globalAlpha > 0) {
      assert.ok(path.length > 0, 'a paint must have path geometry');
      target.push([
        type,
        path.map((part) => [...part]),
        color,
        context.globalAlpha,
        context.lineWidth,
      ]);
    }
  }
  return context;
}

async function whaleTemplate() {
  const script = await readFile(
    new globalThis.URL('../assets/animations/classic.js', import.meta.url),
    'utf8',
  );
  const template = parseAnimation(script, 'classic');
  assert.equal(template.id, 'classic');
  assert.equal(template.durationMs, 5000);
  return template;
}

function assertSandboxReleased(harness) {
  assert.equal(harness.terminated, 1);
  assert.equal(harness.revoked, 1);
  assert.equal(harness.timers.size, 0);
}

test('real whale outline remains reachable and frame-rate independent for every tested seed and viewport', async () => {
  const template = await whaleTemplate();
  const outline = JSON.parse(
    JSON.stringify(vm.runInNewContext(template.source + '; WHALE_OUTLINE')),
  );
  assert.equal(
    outline.length,
    260,
    'retain the complete sampled whale, not a generic particle burst',
  );
  const launchVariants = new Set();
  for (const seed of [0, 1, 42, 0xffffffff]) {
    for (const [width, height, dpr] of [
      [800, 600, 1],
      [300, 500, 2],
      [500, 220, 2],
    ]) {
      const harness = sandboxHarness(template, { seed, width, height, dpr });
      const { draws, hidden, render } = connectSandboxWorker(harness, pathDrawingContext);
      const paintAt = (time, delta = 0) => {
        draws.length = 0;
        hidden.length = 0;
        render({
          type: 'frame',
          frame: {
            width,
            height,
            dpr,
            seed,
            time,
            delta,
            progress: time / template.durationMs,
            durationMs: template.durationMs,
            message: '',
          },
        });
        assert.equal(
          harness.reports.some(({ type }) => type === 'clutch_fireworks/error'),
          false,
          JSON.stringify(harness.reports),
        );
        return JSON.stringify(draws);
      };
      try {
        // Sample either side of phase transitions rather than requiring an exact event tick.
        for (const time of [300, 1799, 1801, 2399, 2401, 2500, 2801, 3200, 4500]) {
          paintAt(time);
          assert.ok(draws.length > 0, `seed ${seed} must paint at ${time}ms in ${width}x${height}`);
        }
        launchVariants.add(paintAt(1500));
        const formed = paintAt(3200);
        const radius = Math.min(width, height) * 0.25;
        const circles = draws
          .filter(([type]) => type === 'fill')
          .flatMap(([, path]) => path.filter(([type]) => type === 'arc').map(([, x, y]) => [x, y]));
        // At full hold all original samples must be painted at their normalized positions,
        // regardless of the random shell families, launches or particle decoration.
        for (const [x, y] of outline) {
          const expectedX = width * 0.5 + x * radius;
          const expectedY = height * 0.38 + y * radius * 0.92;
          assert.ok(
            expectedX >= 0 && expectedX <= width && expectedY >= 0 && expectedY <= height,
            'the full whale fits the viewport',
          );
          assert.ok(
            circles.some(
              ([actualX, actualY]) =>
                Math.abs(actualX - expectedX) < 1e-7 && Math.abs(actualY - expectedY) < 1e-7,
            ),
            `seed ${seed} must paint whale sample ${x},${y}`,
          );
        }
        assert.equal(paintAt(3200, 1000), formed, 'absolute time, not delta, determines the pose');
        for (const fps of [30, 60]) {
          for (let frame = 0; (frame / fps) * 1000 < 5000; frame++)
            paintAt((frame / fps) * 1000, 1000 / fps);
          assert.equal(paintAt(3200, 1000 / fps), formed, `same pose after ${fps}fps history`);
        }
        // Deliberately skip 1800/2400/2680 and revisit earlier times after the finale.
        for (const time of [137, 711, 1817, 2419, 2713, 3191, 4703, 4999, 0, 2500])
          paintAt(time, 137);
        assert.equal(
          paintAt(3200),
          formed,
          'irregular and out-of-order frames cannot gate whale formation',
        );
        const paintedAlpha = () =>
          draws.filter(([type]) => type === 'fill').reduce((sum, [, , , alpha]) => sum + alpha, 0);
        paintAt(3200);
        const holdAlpha = paintedAlpha();
        paintAt(4500);
        assert.ok(
          paintedAlpha() > 0 && paintedAlpha() < holdAlpha,
          'whale visibly fades before the endpoint',
        );
        paintAt(4999);
        assert.equal(
          draws.length,
          0,
          'particles finish naturally before the endpoint, not by truncation',
        );
        paintAt(5000);
        assert.equal(draws.length, 0, 'all visible particles fade by the configured endpoint');
      } finally {
        harness.hide();
      }
      assertSandboxReleased(harness);
    }
  }
  assert.ok(launchVariants.size > 2, 'seed changes launch presentation without gating the whale');
});

for (const reducedMotion of [false, true]) {
  test(`real classic whale completes its full 5000ms playback and releases resources (reduced motion: ${reducedMotion})`, async () => {
    const harness = sandboxHarness(await whaleTemplate(), { reducedMotion, seed: 1 });
    const { draws, hidden, flush, step } = connectSandboxWorker(harness, pathDrawingContext);
    try {
      harness.frame(100);
      flush();
      assert.deepEqual(
        harness.reports.map(({ type }) => type),
        ['clutch_fireworks/ready'],
      );
      assert.equal(harness.worker.sent.at(-1).frame.time, reducedMotion ? 2500 : 0);
      if (reducedMotion)
        assert.ok(draws.length > 0, 'the static forming-whale midpoint must paint');
      const midpoint = JSON.stringify(draws);
      const start = reducedMotion ? 101 : 100;
      if (reducedMotion) {
        harness.frame(start);
        flush();
        assert.equal(harness.worker.sent.at(-1).type, 'validate');
        assert.equal(harness.worker.sent.at(-1).frame.time, 0);
      }
      for (const time of [300, 1799, 1801, 2399, 2401, 2500, 2801, 3500, 4500, 4999]) {
        harness.frame(start + time);
        flush();
        assert.equal(harness.worker.sent.at(-1).frame.time, time);
        assert.equal(harness.worker.sent.at(-1).frame.progress, time / 5000);
        assert.deepEqual(
          harness.reports.map(({ type }) => type),
          ['clutch_fireworks/ready'],
        );
        assert.equal(harness.terminated, 0, 'no successful intermediate frame ends playback');
      }
      if (reducedMotion) {
        assert.equal(
          JSON.stringify(draws),
          midpoint,
          'validation must not repaint the displayed midpoint',
        );
        assert.ok(hidden.length > 0, 'the real timeline paints to an offscreen validation canvas');
      } else {
        assert.ok(
          draws.some(([type]) => type === 'stroke'),
          'real line paths must paint',
        );
        assert.ok(
          draws.some(([type]) => type === 'fill' || type === 'drawImage'),
          'real circle paths or their sprites must paint',
        );
      }
      harness.frame(start + 5000);
      assert.equal(harness.worker.sent.at(-1).frame.time, 5000);
      assert.equal(harness.worker.sent.at(-1).frame.progress, 1);
      assert.equal(harness.terminated, 0, 'the endpoint must be acknowledged before cleanup');
      assert.equal(harness.reports.length, 1);
      step();
      assert.deepEqual(
        harness.reports.map(({ type }) => type),
        ['clutch_fireworks/ready', 'clutch_fireworks/done'],
      );
      assertSandboxReleased(harness);
      harness.worker.onmessage({ data: { type: 'painted' } });
      harness.worker.onmessage({ data: { type: 'error', message: 'late callback' } });
      harness.hide();
      assert.equal(harness.reports.length, 2);
      assertSandboxReleased(harness);
    } finally {
      harness.hide();
    }
  });
}

test('real whale midpoint redraws after resize without restarting its 5000ms deadline', async () => {
  const harness = sandboxHarness(await whaleTemplate(), { reducedMotion: true });
  const { canvas, draws, hidden, step, flush } = connectSandboxWorker(harness, pathDrawingContext);
  try {
    harness.frame(100);
    flush();
    assert.ok(draws.length > 0);
    harness.frame(101);
    flush();
    for (const [now, width, height, dpr] of [
      [2000, 300, 500, 2],
      [5101, 7680, 4320, 3],
    ]) {
      const previousDraws = draws.length;
      harness.resize(width, height, dpr);
      harness.frame(now);
      assert.equal(harness.worker.sent.at(-1).type, 'frame');
      assert.equal(harness.worker.sent.at(-1).frame.time, 2500);
      step();
      assert.ok(draws.length > previousDraws, 'resized midpoint must contain visible geometry');
      assert.equal(harness.terminated, 0, 'a midpoint redraw cannot complete validation');
      assert.equal(harness.reports.length, 1);
      assert.equal(harness.worker.sent.at(-1).type, 'validate');
      assert.equal(harness.worker.sent.at(-1).frame.time, now - 101);
      const appliedDpr = Math.min(dpr, 2, Math.sqrt(8_000_000 / (width * height)));
      assert.equal(canvas.width, Math.floor(width * appliedDpr));
      assert.equal(canvas.height, Math.floor(height * appliedDpr));
      assert.ok(canvas.width * canvas.height <= 8_000_000);
      step();
    }
    assert.ok(hidden.length > 0);
    assert.deepEqual(
      harness.reports.map(({ type }) => type),
      ['clutch_fireworks/ready', 'clutch_fireworks/done'],
    );
    assertSandboxReleased(harness);
  } finally {
    harness.hide();
  }
});

for (const reducedMotion of [false, true]) {
  for (const cleanup of ['pagehide', 'watchdog']) {
    test(`real whale releases a pending frame on ${cleanup} (reduced motion: ${reducedMotion})`, async () => {
      const harness = sandboxHarness(await whaleTemplate(), { reducedMotion });
      const { flush } = connectSandboxWorker(harness, pathDrawingContext);
      try {
        harness.frame(100);
        flush();
        harness.frame(101);
        flush();
        harness.resize(300, 500, 2);
        harness.frame(2600);
        const sent = harness.worker.sent.length;
        assert.equal(harness.timers.size, 1);
        const watchdog = [...harness.timers.values()][0];
        assert.equal(watchdog.delay, 750);
        if (cleanup === 'watchdog') watchdog.listener();
        else harness.hide();
        harness.worker.onmessage({ data: { type: 'painted' } });
        harness.worker.onmessage({ data: { type: 'error', message: 'late callback' } });
        harness.hide();
        assert.equal(
          harness.worker.sent.length,
          sent,
          'late acknowledgements cannot resume playback',
        );
        assert.deepEqual(
          harness.reports.map(({ type }) => type),
          cleanup === 'watchdog'
            ? ['clutch_fireworks/ready', 'clutch_fireworks/error']
            : ['clutch_fireworks/ready'],
        );
        assertSandboxReleased(harness);
      } finally {
        harness.hide();
      }
    });
  }
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
          progress: 700 / template.durationMs,
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

for (const reducedMotion of [false, true]) {
  test(`import preflight bypasses hidden iframe RAF throttling and terminates its Worker (${reducedMotion})`, () => {
    const harness = sandboxHarness(parseAnimation(source(), 'custom-preflight'), {
      validationOnly: true,
      reducedMotion,
    });
    harness.worker.onmessage({ data: { type: 'ready' } });
    assert.equal(harness.worker.sent.length, 2, 'init immediately schedules a frame without RAF');
    harness.worker.onmessage({ data: { type: 'painted' } });
    assert.equal(harness.reports.at(-1).type, 'clutch_fireworks/ready');
    assert.equal(harness.terminated, 1);
    assert.equal(harness.revoked, 1);
    assert.equal(harness.timers.size, 0);
  });
}
