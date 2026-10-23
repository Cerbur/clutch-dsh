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
import { sandboxHarness, connectSandboxWorker } from './helpers/animation-harness.mjs';
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

// A strict Canvas adapter, not a rasterizer. Keep only the latest simulation tick's
// paint records, plus counters, instead of retaining every particle in every tick.
function pathDrawingContext(target) {
  let path = [];
  const stack = [];
  const paintCounts = {};
  const defaults = {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    shadowColor: 'transparent',
    shadowBlur: 0,
  };
  const numeric = (values) =>
    values.forEach((value) => assert.ok(Number.isFinite(value), 'finite drawing coordinates'));
  const record = (type, ...args) => {
    paintCounts[type] = (paintCounts[type] ?? 0) + 1;
    target.push([type, ...args]);
  };
  const context = {
    ...defaults,
    paintCounts,
    reset() {
      assert.equal(stack.length, 0, 'drawing state must be balanced between frames');
      Object.assign(context, defaults);
      path = [];
    },
    setTransform(...args) {
      assert.equal(args.length, 6);
      numeric(args);
    },
    save() {
      stack.push(Object.fromEntries(Object.keys(defaults).map((key) => [key, context[key]])));
    },
    restore() {
      assert.ok(stack.length, 'restore needs a matching save');
      Object.assign(context, stack.pop());
    },
    clearRect(...args) {
      numeric(args);
      record('clearRect', ...args);
    },
    fillRect(...args) {
      numeric(args);
      // A reference trail tick starts by fading the previous pixels, not by
      // clearing them. Dropping recorder history does not reset context state.
      if (context.globalCompositeOperation === 'destination-out') target.length = 0;
      record(
        'fillRect',
        args,
        context.fillStyle,
        context.globalAlpha,
        context.globalCompositeOperation,
      );
    },
    createRadialGradient(...args) {
      numeric(args);
      assert.equal(args.length, 6);
      assert.ok(args[2] >= 0 && args[5] >= 0);
      const gradient = {
        stops: [],
        addColorStop(offset, color) {
          assert.ok(Number.isFinite(offset) && offset >= 0 && offset <= 1);
          assert.equal(typeof color, 'string');
          gradient.stops.push([offset, color]);
        },
      };
      paintCounts.gradient = (paintCounts.gradient ?? 0) + 1;
      return gradient;
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
      assert.ok(image.width > 0 && image.height > 0, 'blit only an active, nonempty buffer');
      if (context.globalAlpha > 0)
        record(
          'drawImage',
          image.width,
          image.height,
          ...args,
          context.globalAlpha,
          context.globalCompositeOperation,
        );
    },
  };
  function paint(type, color) {
    assert.ok(
      Number.isFinite(context.globalAlpha) && context.globalAlpha >= 0 && context.globalAlpha <= 1,
    );
    if (context.globalAlpha > 0) {
      assert.ok(path.length > 0, 'a paint must have path geometry');
      record(
        type,
        path.map((part) => [...part]),
        color,
        context.globalAlpha,
        context.lineWidth,
        context.globalCompositeOperation,
      );
    }
  }
  return new Proxy(context, {
    get(target, key) {
      assert.ok(key in target, 'unsupported Canvas method/property: ' + String(key));
      return target[key];
    },
    set(target, key, value) {
      assert.ok(key in target, 'unsupported Canvas property: ' + String(key));
      target[key] = value;
      return true;
    },
  });
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

test('real whale paints all 260 blue outline points near midpoint on a persistent trail buffer', async () => {
  const template = await whaleTemplate();
  const outline = JSON.parse(
    JSON.stringify(vm.runInNewContext(template.source + '; SHELL_OUTLINE')),
  );
  assert.equal(outline.length, 260, 'retain the full whale rather than a generic burst');
  const centers = new Set();
  for (const seed of [0, 1, 42, 0xffffffff]) {
    for (const [width, height, dpr] of [
      [800, 600, 1],
      [300, 500, 2],
      [500, 220, 2],
    ]) {
      const harness = sandboxHarness(template, { seed, width, height, dpr });
      const { draws, hidden, privateCanvases, render } = connectSandboxWorker(
        harness,
        pathDrawingContext,
      );
      const paintAt = (time, delta = 0) => {
        draws.length = 0;
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
      };
      try {
        paintAt(300);
        assert.ok(
          hidden.some(([type]) => type === 'stroke'),
          'rockets really paint private paths',
        );
        assert.equal(privateCanvases.length, 1);
        const trail = privateCanvases[0];
        assert.equal(trail.getContext('2d'), trail.getContext('2d'), 'private context persists');
        assert.equal(trail.width, Math.floor(width * dpr));
        assert.equal(trail.height, Math.floor(height * dpr));
        paintAt(2500);
        const midpoint = JSON.stringify(hidden);
        assert.equal(privateCanvases.length, 1, 'forward seek reuses its trail canvas');
        assert.deepEqual(
          hidden[0],
          ['fillRect', [0, 0, width, height], 'rgba(0,0,0,0.16)', 1, 'destination-out'],
          'fade the trail toward transparency',
        );
        const paints = hidden.filter(([type]) => type === 'fill' || type === 'stroke');
        assert.ok(paints.length >= 260);
        assert.ok(
          paints.every((paint) => paint[5] === 'lighter'),
          'sparks blend additively in private buffer',
        );
        assert.equal(draws.length, 1, 'display only the private buffer, not individual particles');
        assert.deepEqual(
          draws[0],
          ['drawImage', trail.width, trail.height, 0, 0, width, height, 1, 'source-over'],
          'blit the transparent trail at CSS dimensions',
        );

        // Original shape points jitter and the launch center is random. Check the
        // complete painted contour with a free center, not the obsolete fixed pose.
        const radius = Math.min(width, height) * 0.19;
        let whale;
        for (let start = 0; start + outline.length <= paints.length; start++) {
          const candidate = paints.slice(start, start + outline.length);
          if (
            !candidate.every(([type, path, color]) => {
              const match =
                typeof color === 'string' &&
                /^hsla\(([^,]+),([^%]+)%,([^%]+)%,([^)]+)\)$/.exec(color);
              return (
                type === 'fill' &&
                path.length === 1 &&
                path[0][0] === 'arc' &&
                path[0][3] >= 1.5 &&
                path[0][3] <= 2.3 &&
                match &&
                +match[1] >= 183 &&
                +match[1] <= 232 &&
                +match[2] >= 88 &&
                +match[2] <= 100 &&
                +match[3] >= 62 &&
                +match[3] <= 70 &&
                +match[4] > 0.65
              );
            })
          )
            continue;
          const offsets = candidate.map(([, path], index) => {
            const [ox, oy] = outline[outline.length - 1 - index];
            return [path[0][1] - ox * radius, path[0][2] - oy * radius * 0.92];
          });
          const cx = offsets.reduce((sum, [x]) => sum + x, 0) / outline.length;
          const cy = offsets.reduce((sum, [, y]) => sum + y, 0) / outline.length;
          if (offsets.every(([x, y]) => Math.abs(x - cx) < 1 && Math.abs(y - cy) < 1)) {
            whale = { candidate, cx, cy };
            break;
          }
        }
        assert.ok(whale, 'all 260 blue points must actually paint the whale contour at midpoint');
        assert.ok(whale.cx > width * 0.3 && whale.cx < width * 0.7);
        assert.ok(whale.cy > height * 0.1 && whale.cy < height * 0.45);
        for (const [, path] of whale.candidate) {
          assert.ok(path[0][1] >= 0 && path[0][1] <= width);
          assert.ok(path[0][2] >= 0 && path[0][2] <= height);
        }
        centers.add([width, height, whale.cx.toFixed(2), whale.cy.toFixed(2)].join(':'));
        paintAt(2500, 1000);
        assert.equal(JSON.stringify(hidden), midpoint, 'delta cannot advance a repeated pose');
        const clears = trail.drawing.paintCounts.clearRect;
        paintAt(2713, 137);
        paintAt(711, 137);
        paintAt(2500, 137);
        assert.ok(
          trail.drawing.paintCounts.clearRect > clears,
          'backtracking clears stale trail pixels',
        );
        assert.equal(
          JSON.stringify(hidden),
          midpoint,
          'replay restores midpoint paints after a backtrack',
        );
        assert.equal(privateCanvases.length, 1, 'backtracking keeps the same private canvas');
        paintAt(4999);
        assert.equal(
          hidden.some(([type]) => type === 'fill' || type === 'stroke'),
          false,
          'particles burn out naturally before endpoint',
        );
        paintAt(5000);
        assert.equal(draws.length, 0, 'endpoint never blits a released buffer');
        assert.equal(trail.width, 0, 'release private backing pixels at the endpoint');
        assert.equal(trail.height, 0);
      } finally {
        harness.hide();
      }
      assertSandboxReleased(harness);
    }
  }
  assert.ok(centers.size > 3, 'seed changes the original launch center across viewports');
});

for (const reducedMotion of [false, true]) {
  test(`real classic whale completes its full 5000ms playback and releases resources (reduced motion: ${reducedMotion})`, async () => {
    const harness = sandboxHarness(await whaleTemplate(), { reducedMotion, seed: 1 });
    const { draws, hidden, privateCanvases, flush, step } = connectSandboxWorker(
      harness,
      pathDrawingContext,
    );
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
          privateCanvases.some(({ drawing }) => drawing.paintCounts.stroke > 0),
          'real line paths must paint',
        );
        assert.ok(
          privateCanvases.some(({ drawing }) => drawing.paintCounts.fill > 0) &&
            draws.some(([type]) => type === 'drawImage'),
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
    const hidden = [];
    const privateCanvases = [];
    const painted = { fill: 0, stroke: 0, fillText: 0 };
    const paintedGlyphs = new Map();
    const context = (target, image) =>
      new Proxy(
        {
          globalCompositeOperation: 'source-over',
          measureText: () => ({ width: 64 }),
          createRadialGradient: () => ({
            addColorStop: (offset, color) => {
              assert.ok(offset >= 0 && offset <= 1);
              assert.equal(typeof color, 'string');
            },
          }),
        },
        {
          get: (state, key) =>
            state[key] ??
            ((...args) => {
              if (key === 'fillRect' && state.globalCompositeOperation === 'destination-out')
                target.length = 0;
              if (Object.hasOwn(painted, key)) painted[key]++;
              if (key === 'fillText' && image) paintedGlyphs.set(image, args[0]);
              if (key === 'drawImage') {
                assert.ok(args[0].width > 0 && args[0].height > 0);
                assert.ok(args.slice(1).every(Number.isFinite));
              }
              if (['fill', 'stroke', 'fillText', 'drawImage'].includes(key))
                target.push([key, args]);
            }),
        },
      );
    const drawing = context(draws);
    const worker = vm.createContext({
      postMessage: (value) => posted.push(value),
      OffscreenCanvas: class {
        constructor(width, height) {
          this.width = width;
          this.height = height;
          this.drawing = context(hidden, this);
          privateCanvases.push(this);
        }
        getContext(type) {
          assert.equal(type, '2d');
          return this.drawing;
        }
      },
    });
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
        draws.some(([name]) => ['fill', 'stroke', 'fillText', 'drawImage'].includes(name)) &&
          painted.fill + painted.stroke + painted.fillText > 0,
        id + ' must paint',
      );
    if (id === 'emoji') {
      const glyphs = draws
        .filter(([name]) => name === 'drawImage')
        .map(([, args]) => paintedGlyphs.get(args[0]));
      assert.equal(glyphs.length, 40);
      assert.ok(glyphs.filter((glyph) => glyph === '🎉').length >= 10);
      assert.ok(glyphs.filter((glyph) => glyph === '🌟').length >= 5);
      assert.ok(glyphs.filter((glyph) => glyph === '✨').length >= 5);
      assert.equal(
        privateCanvases.length,
        new Set(glyphs).size,
        'reuse one persistent raster per emoji',
      );
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
