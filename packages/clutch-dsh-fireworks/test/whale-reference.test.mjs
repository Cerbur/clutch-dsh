import assert from 'node:assert/strict';
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

function recordingContext() {
  let hash = 2166136261,
    count = 0,
    gradients = 0;
  const values = {};
  let enabled = true;
  const record = (...parts) => {
    if (!enabled) return;
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
  ])
    ctx[name] = (...args) => record(name, ...args);
  for (const name of [
    'globalCompositeOperation',
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'lineCap',
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
