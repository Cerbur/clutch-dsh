import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Observe the actual render entry: a whale-shaped set of dots alone cannot catch
// the loss of the reference show's accumulated luminous trails and burst flashes.
function traceTemplate(source) {
  const canvases = [];
  const operations = [];
  const context = (target) =>
    new Proxy(
      {
        save() {},
        restore() {},
        beginPath() {},
        setTransform() {},
        clearRect() {},
        arc(...args) {
          target.push(['arc', ...args]);
        },
        moveTo() {},
        lineTo() {},
        fill() {},
        stroke() {},
        fillRect(...args) {
          target.push(['fillRect', ...args]);
        },
        drawImage(...args) {
          target.push(['drawImage', ...args.slice(1)]);
        },
        createRadialGradient() {
          target.push(['gradient']);
          return { addColorStop() {} };
        },
      },
      {
        set(object, key, value) {
          if (key === 'globalCompositeOperation') target.push(['composite', value]);
          object[key] = value;
          return true;
        },
      },
    );
  const runtime = vm.createContext({
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.operations = [];
        this.context = context(this.operations);
        canvases.push(this);
      }
      getContext() {
        return this.context;
      }
    },
    frame: {
      width: 800,
      height: 600,
      dpr: 1,
      seed: 42,
      durationMs: 5000,
      ctx: context(operations),
    },
    fx: {
      clamp: (p) => Math.max(0, Math.min(1, p)),
      easeOut: (p) => 1 - (1 - Math.max(0, Math.min(1, p))) ** 3,
      circle() {},
      line() {},
    },
  });
  vm.runInContext(source, runtime);
  for (const time of [0, 800, 1600, 2500, 3500]) {
    runtime.frame.time = time;
    vm.runInContext('render(frame, fx)', runtime, { timeout: 1000 });
  }
  return { canvases, operations };
}

test('whale retains the reference accumulated additive trails and radial burst flashes', async () => {
  const source = await readFile(
    new globalThis.URL('../assets/animations/classic.js', import.meta.url),
    'utf8',
  );
  const { canvases, operations } = traceTemplate(source);
  assert.ok(
    canvases.length > 0,
    'the original show needs a persistent offscreen trail buffer, not a few synthetic line segments',
  );
  const trail = canvases.flatMap((canvas) => canvas.operations);
  assert.ok(
    trail.some(([name, value]) => name === 'composite' && value === 'destination-out'),
    'old trails fade toward transparency',
  );
  assert.ok(
    trail.some(([name, value]) => name === 'composite' && value === 'lighter'),
    'overlapping original sparks accumulate light',
  );
  assert.ok(
    trail.some(([name]) => name === 'gradient'),
    'original shell burst flash survives the port',
  );
  assert.ok(
    operations.some(([name]) => name === 'drawImage'),
    'host canvas composites the private trail buffer',
  );
});

function recordingContext({ geometryOnly = false, observe } = {}) {
  let hash = 2166136261,
    count = 0,
    gradients = 0;
  const values = {};
  let enabled = true;
  const record = (...parts) => {
    if (!enabled) return;
    observe?.(parts, values);
    if (geometryOnly) {
      // A cold canvas also initializes its DPR transform; paths are already
      // recorded in CSS coordinates, so buffer setup is outside this hash.
      if (parts[0] === 'globalCompositeOperation' || parts[0] === 'setTransform') return;
      // Keep alpha, gradient stops and every path/size while ignoring only RGB.
      parts = parts.map((part) =>
        typeof part === 'string' && /^(hsla|rgba)\(/.test(part)
          ? { alpha: Number(part.slice(part.lastIndexOf(',') + 1, -1)) }
          : part,
      );
    }
    const text = JSON.stringify(parts, (_key, value) =>
      typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value,
    );
    for (let i = 0; i < text.length; i++)
      hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
    count++;
  };
  const ctx = {};
  for (const name of [
    'fillRect',
    'clearRect',
    'beginPath',
    'moveTo',
    'lineTo',
    'stroke',
    'arc',
    'fill',
    'save',
    'restore',
    'setTransform',
  ])
    ctx[name] = (...args) => record(name, ...args);
  ctx.drawImage = (_canvas, ...args) => record('drawImage', ...args);
  for (const name of [
    'globalCompositeOperation',
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'lineCap',
    'globalAlpha',
  ])
    Object.defineProperty(ctx, name, {
      get: () => values[name],
      set: (value) => {
        values[name] = value;
        record(name, value);
      },
    });
  ctx.createRadialGradient = (...args) => {
    const id = gradients++;
    record('gradient', id, ...args);
    return { id, addColorStop: (...stops) => record('colorStop', id, ...stops) };
  };
  return {
    ctx,
    snapshot: () => ({ hash, count }),
    recordFrame(value) {
      enabled = value;
      hash = 2166136261;
      count = 0;
      gradients = 0;
    },
  };
}

// Captured from the supplied unmodified reference createScene at canonical
// 16.667ms steps. Hash the actual draw/style/gradient stream, not source strings.
const REFERENCE_TRACES = [
  {
    width: 800,
    height: 600,
    seed: 42,
    snapshots: [
      {
        tick: 60,
        hash: 21818620,
        count: 8180,
      },
      {
        tick: 180,
        hash: 2889256526,
        count: 377277,
      },
      {
        tick: 280,
        hash: 2531865091,
        count: 1010455,
      },
      {
        tick: 340,
        hash: 1239841945,
        count: 1244093,
      },
      {
        tick: 430,
        hash: 739431160,
        count: 1324997,
      },
      {
        tick: 500,
        hash: 188171399,
        count: 1325278,
      },
    ],
  },
  {
    width: 1920,
    height: 1080,
    seed: 1,
    snapshots: [
      {
        tick: 60,
        hash: 3451313056,
        count: 7970,
      },
      {
        tick: 180,
        hash: 844353847,
        count: 249754,
      },
      {
        tick: 280,
        hash: 3520265913,
        count: 557329,
      },
      {
        tick: 340,
        hash: 2822694095,
        count: 739982,
      },
      {
        tick: 430,
        hash: 2401907206,
        count: 837568,
      },
      {
        tick: 500,
        hash: 1591756579,
        count: 838066,
      },
    ],
  },
  {
    width: 300,
    height: 500,
    seed: 0,
    snapshots: [
      {
        tick: 60,
        hash: 3347069024,
        count: 8180,
      },
      {
        tick: 180,
        hash: 2105376379,
        count: 313710,
      },
      {
        tick: 280,
        hash: 1630511251,
        count: 538424,
      },
      {
        tick: 340,
        hash: 2684722841,
        count: 695912,
      },
      {
        tick: 430,
        hash: 3664861554,
        count: 735389,
      },
      {
        tick: 500,
        hash: 2619546074,
        count: 735669,
      },
    ],
  },
];

test('original particle physics, shell parameters, RNG and compositing match the reference traces', async () => {
  const source = await readFile(
    new globalThis.URL('../assets/animations/classic.js', import.meta.url),
    'utf8',
  );
  for (const expected of REFERENCE_TRACES) {
    const runtime = vm.createContext({ ...expected, recordingContext });
    vm.runInContext(
      source +
        `;
      showClock = 0; showRandomState = seed >>> 0;
      var drawing = recordingContext();
      var originalScene = createScene(drawing.ctx, width, height, () => {});
      var actual = [];
      for (var tick = 1; tick <= 500; tick++) {
        showClock = tick * 16.667;
        originalScene.step(showClock);
        if ([60,180,280,340,430,500].includes(tick)) actual.push({ tick, ...drawing.snapshot() });
      }
    `,
      runtime,
      { timeout: 10000 },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(runtime.actual)),
      expected.snapshots,
      `reference draw stream seed${expected.seed} ${expected.width}x${expected.height}`,
    );
  }
});

test('no-paint seeking preserves the original RNG, state and next painted frame', async () => {
  const source = await readFile(
    new globalThis.URL('../assets/animations/classic.js', import.meta.url),
    'utf8',
  );
  for (const { width, height, seed } of REFERENCE_TRACES) {
    const runs = [];
    for (const history of [true, false]) {
      const runtime = vm.createContext({ width, height, seed, history, recordingContext });
      vm.runInContext(
        source +
          `;
        showClock = 0; showRandomState = seed >>> 0;
        var drawing = recordingContext();
        var probe = createScene(drawing.ctx, width, height, () => {});
        var actual = [];
        for (var tick = 1; tick <= 500; tick++) {
          var sample = [60,180,280,340,430,500].includes(tick);
          drawing.recordFrame(sample);
          showClock = tick * 16.667;
          probe.step(showClock, history || sample);
          if (sample) actual.push({ tick, random: showRandomState, state: probe.stats(), ...drawing.snapshot() });
        }
      `,
        runtime,
        { timeout: 10000 },
      );
      runs.push(JSON.parse(JSON.stringify(runtime.actual)));
    }
    assert.deepEqual(
      runs[1],
      runs[0],
      'seeking must only skip raster work, never simulation/random draws',
    );
  }
});

function paletteRecorder() {
  const colors = new Set();
  const composites = new Set();
  const rectangles = [];
  const drawing = recordingContext({
    geometryOnly: true,
    observe(parts, values) {
      const [name, value] = parts;
      if (name === 'globalCompositeOperation') composites.add(value);
      if (name === 'fillStyle' || name === 'strokeStyle') {
        if (typeof value === 'string' && value.startsWith('hsla(')) colors.add(value);
      }
      if (name === 'colorStop') colors.add(parts[3]);
      if (name === 'fillRect')
        rectangles.push({ args: parts.slice(1), composite: values.globalCompositeOperation });
    },
  });
  return { ...drawing, colors, composites, rectangles };
}

function assertLightPalette(drawing) {
  let visible = 0;
  for (const color of drawing.colors) {
    const match = /^hsla\(([^,]+),([^%]+)%,([^%]+)%,([^)]+)\)$/.exec(color);
    assert.ok(match, color);
    const [, hue, saturation, lightness, alpha] = match.map(Number);
    if (alpha === 0) continue; // Transparent outer edge of the radial flash.
    visible++;
    assert.ok([174, 218, 242].includes(hue), 'use saturated teal, blue and indigo ink');
    assert.ok(saturation >= 84 && saturation <= 100, color);
    assert.ok(lightness >= 24 && lightness <= (hue === 174 ? 28 : 34), color);
  }
  assert.ok(visible > 0, 'actually paint colored sparks');
  assert.deepEqual([...drawing.composites].sort(), ['destination-out', 'source-over']);
  assert.ok(drawing.rectangles.length > 0, 'retain the fading trail buffer');
  assert.ok(
    drawing.rectangles.every(({ composite }) => composite === 'destination-out'),
    'full-canvas rectangles must only erase trails, never paint a background',
  );
}

test('light changes only raster colors/compositing across the complete original simulation', async () => {
  const source = await readFile(
    new globalThis.URL('../assets/animations/classic.js', import.meta.url),
    'utf8',
  );
  for (const { width, height, seed } of REFERENCE_TRACES) {
    const runs = [];
    for (const theme of ['dark', 'light']) {
      const drawing = paletteRecorder();
      const runtime = vm.createContext({ width, height, seed, theme, drawing });
      vm.runInContext(
        source +
          `;
        rasterTheme = theme;
        showClock = 0; showRandomState = seed >>> 0;
        var probe = createScene(drawing.ctx, width, height, () => {});
        var actual = [];
        for (var tick = 1; tick <= 1000; tick++) {
          showClock = tick * FIXED_STEP_MS;
          probe.step(showClock);
          actual.push({ tick, time: showClock, random: showRandomState,
            state: probe.stats(), ...drawing.snapshot() });
          if (probe.stats().complete) break;
        }
      `,
        runtime,
        { timeout: 10000 },
      );
      runs.push({ actual: JSON.parse(JSON.stringify(runtime.actual)), drawing });
    }
    assert.ok(runs[0].actual.at(-1).state.complete);
    assert.deepEqual(
      runs[1].actual,
      runs[0].actual,
      `theme must preserve every tick's counts, timing, geometry, alpha and RNG (seed ${seed})`,
    );
    assert.notDeepEqual([...runs[0].drawing.colors], [...runs[1].drawing.colors]);
    assert.ok(runs[0].drawing.composites.has('lighter'));
    assertLightPalette(runs[1].drawing);
  }
});

function renderHarness(source, { seed = 42, width = 800, height = 600 } = {}) {
  const canvases = [];
  const output = recordingContext();
  const runtime = vm.createContext({
    OffscreenCanvas: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
        this.drawing = paletteRecorder();
        canvases.push(this);
      }
      getContext() {
        return this.drawing.ctx;
      }
    },
    frame: { seed, width, height, dpr: 1, durationMs: 5000, ctx: output.ctx },
  });
  vm.runInContext(source, runtime);
  return {
    canvases,
    paint(time, theme) {
      runtime.frame.time = time;
      runtime.frame.theme = theme;
      for (const { drawing } of canvases) {
        drawing.recordFrame(true);
        drawing.colors.clear();
        drawing.composites.clear();
        drawing.rectangles.length = 0;
      }
      vm.runInContext('render(frame)', runtime, { timeout: 1000 });
      return JSON.parse(
        vm.runInContext(
          `JSON.stringify({ tick: simulationTick, time: showClock, random: showRandomState,
            state: scene?.stats(), timeline, surfaceKey, trailDpr })`,
          runtime,
        ),
      );
    },
  };
}

test('same-tick theme changes replay the private trails without changing pose or timeline', async () => {
  const source = await readFile(
    new globalThis.URL('../assets/animations/classic.js', import.meta.url),
    'utf8',
  );
  for (const time of [800, 1600, 2500, 2800, 3500]) {
    const harness = renderHarness(source);
    // Exercise retained history before changing the current raster palette.
    harness.paint(0, 'dark');
    harness.paint(Math.max(0, time - 100), 'dark');
    const dark = harness.paint(time, 'dark');
    const canvas = harness.canvases[0];
    const light = harness.paint(time, 'light');
    assert.deepEqual(light, dark, `same-tick switch at ${time} ms`);
    assert.equal(harness.canvases.length, 1, 'reuse the private buffer');
    assert.ok(canvas.drawing.rectangles.length > 0, 'repaint even when the tick did not advance');
    assertLightPalette(canvas.drawing);

    const freshLight = renderHarness(source);
    assert.deepEqual(freshLight.paint(time, 'light'), light);
    assert.deepEqual(
      canvas.drawing.snapshot(),
      freshLight.canvases[0].drawing.snapshot(),
      'same bounded reconstruction as a cold light seek',
    );
    const unchanged = harness.paint(time, 'light');
    assert.deepEqual(unchanged, light);
    assert.equal(
      canvas.drawing.rectangles.length,
      0,
      'unchanged palette retains accumulated trails',
    );

    assert.deepEqual(harness.paint(time), dark, 'a missing theme falls back to dark');
    assert.ok(canvas.drawing.composites.has('lighter'));
    assert.deepEqual(harness.paint(time, 'light'), light);
    assert.deepEqual(harness.paint(time, 'dark'), dark);
    assert.ok(canvas.drawing.composites.has('lighter'));
  }
});

test('light reduced-motion midpoint contains the full whale and remains within the script contract', async () => {
  const source = await readFile(
    new globalThis.URL('../assets/animations/classic.js', import.meta.url),
    'utf8',
  );
  const header = JSON.parse(source.split('\n')[0].slice('// clutch_fireworks: '.length));
  assert.equal(header.durationMs, 5000);
  assert.ok(Buffer.byteLength(source, 'utf8') <= 65_536, 'standalone export stays within 64 KiB');
  for (const seed of [0, 1, 42, 0xffffffff]) {
    const harness = renderHarness(source, { seed, width: 300, height: 500 });
    const midpoint = harness.paint(2500, 'light');
    assert.ok(midpoint.state.particles >= 260, 'retain every whale outline particle');
    assert.equal(midpoint.tick, midpoint.timeline.whaleTick);
    assert.ok(midpoint.time >= midpoint.state.whaleFormedAt, 'show the formed whale at midpoint');
    assertLightPalette(harness.canvases[0].drawing);
    assert.deepEqual(harness.paint(2500, 'dark'), midpoint);
    assert.deepEqual(harness.paint(2500, 'light'), midpoint);
    const end = harness.paint(5000, 'light');
    assert.equal(end.tick, 0);
    assert.equal(harness.canvases[0].width, 0);
    assert.equal(harness.canvases[0].height, 0);
  }
});
