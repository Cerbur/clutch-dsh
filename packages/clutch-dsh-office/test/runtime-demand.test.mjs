import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as T from 'three';

// Load the actual runtime/motion/guard sources without a client bundle or GLB
// parsing. Only DOM, GPU and asynchronous asset delivery are replaced.
async function harness(t, reducedMotion = false) {
  const pending = new Map();
  const owners = [],
    appearances = [],
    renders = [],
    shadowUpdates = [],
    cacheInvalidations = [],
    failures = [];
  let nextFrame = 0,
    now = 0,
    renderer,
    resize;
  const document = new EventTarget();
  document.hidden = false;
  const reduced = new EventTarget();
  reduced.matches = reducedMotion;
  const canvas = new EventTarget();
  canvas.setAttribute = () => {};
  canvas.remove = () => {};
  const bubbles = Array.from({ length: 4 }, () => ({ style: {} }));
  const container = {
    clientWidth: 800,
    clientHeight: 600,
    prepend() {},
    querySelector: (selector) => bubbles[Number(selector.match(/\d/)[0])],
  };
  const context = vm.createContext({
    console,
    document,
    window: { devicePixelRatio: 2, matchMedia: () => reduced },
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => pending.delete(id),
    ResizeObserver: class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  });
  class Renderer {
    constructor() {
      renderer = this;
      this.debug = { checkShaderErrors: false, onShaderError: null };
      this.shadowMap = { needsUpdate: true, autoUpdate: false };
      this.domElement = canvas;
    }
    setPixelRatio(value) {
      this.pixelRatio = value;
    }
    setSize(width, height) {
      this.size = [width, height];
    }
    render(scene, camera) {
      renders.push({ now, staticShadows: this.shadowMap.needsUpdate, scene, camera });
      this.shadowMap.needsUpdate = false;
    }
    dispose() {}
    forceContextLoss() {}
  }
  class Models {
    constructor(onChange, dynamic = false) {
      this.onChange = onChange;
      this.dynamic = dynamic;
      owners.push(this);
    }
    invalidate() {
      if (!this.disposed) this.onChange();
    }
    dispose() {
      this.disposed = true;
    }
  }
  const mocks = {
    './static-frame.js': {
      // Scheduling tests isolate the compositor; its real multi-pass ownership
      // and invalidation contract is covered by static-frame.test.mjs.
      createKitchenStaticFrame: (renderer, scene, camera, updateShadows) => ({
        render() {
          updateShadows();
          renderer.render(scene, camera);
        },
        invalidate() {
          cacheInvalidations.push(now);
        },
        dispose() {},
      }),
    },
    three: { ...T, WebGLRenderer: Renderer },
    './baked-assets.js': {},
    './models.js': { Models },
    './kitchen/index.js': { buildKitchen: () => new T.Group() },
    './character/deepseek.js': {
      buildDeepSeek() {
        const root = new T.Group(),
          body = new T.Group();
        root.add(body);
        const model = { root, body, arm: new T.Group(), tail: new T.Group() };
        appearances.push(model);
        return model;
      },
    },
    './lighting.js': {
      createKitchenLighting: () => ({
        updateCharacterShadows: () => shadowUpdates.push(now),
        dispose() {},
      }),
    },
  };
  const modules = new Map();
  function load(url) {
    if (modules.has(url.href)) return modules.get(url.href);
    const source = readFileSync(url, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    });
    const exports = {};
    modules.set(url.href, exports);
    vm.compileFunction(outputText, ['require', 'exports'], {
      parsingContext: context,
      filename: url.pathname,
    })(
      (specifier) => mocks[specifier] ?? load(new URL(specifier.replace(/\.js$/, '.ts'), url)),
      exports,
    );
    return exports;
  }
  const module = load(new URL('../src/client/scene/runtime.ts', import.meta.url));
  const runtime = module.createKitchenRuntime(container, (kind) => failures.push(kind));
  t.after(() => runtime.dispose());
  return {
    runtime,
    renderer,
    owners,
    appearances,
    renders,
    shadowUpdates,
    cacheInvalidations,
    failures,
    pending,
    bubbles,
    resize,
    document,
    reduced,
    canvas,
    planAction: load(new URL('../src/office/actions.ts', import.meta.url)).planAction,
    tick(time) {
      now = time;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(now);
    },
  };
}

const actor = { id: 'one', label: 'One', seat: 0, activity: 'working' };

test('room arrivals and camera resize invalidate color cache, actor updates retain it', async (t) => {
  const h = await harness(t);
  h.tick(0);
  h.resize();
  assert.equal(h.cacheInvalidations.length, 1);
  h.owners[0].invalidate();
  assert.equal(h.cacheInvalidations.length, 2);
  h.runtime.update([actor]);
  h.tick(50);
  h.owners[1].invalidate();
  h.runtime.update([{ ...actor, label: 'Updated' }]);
  h.runtime.update([]);
  assert.equal(h.cacheInvalidations.length, 2);
});

test('skeletal actor updates use actual ground speed with no legacy body bob and pause with visibility', async (t) => {
  const h = await harness(t);
  h.runtime.update([actor]);
  const model = h.appearances[0];
  const updates = [];
  let pauses = 0;
  model.animation = {
    walkSpeed: 0.48,
    update: (...args) => updates.push(args),
    pause: () => pauses++,
    dispose() {},
  };
  for (let i = 0; i <= 600; i++) h.tick((i * 1000) / 60);
  assert.equal(model.body.position.y, 0, 'skeletal hips replace whole-body floating');
  assert.equal(model.root.position.y, 0.025, 'shoe origin uses the actual floor surface');
  assert.ok(updates.some(([, speed]) => Math.abs(speed) > 0.47));
  assert.ok(updates.every(([, speed]) => Math.abs(speed) <= 0.48000001));
  h.document.hidden = true;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.ok(pauses > 0);
  assert.equal(h.pending.size, 0);
  h.document.hidden = false;
  h.document.dispatchEvent(new Event('visibilitychange'));
  h.tick(20_000);
  assert.equal(updates.at(-1)[0], 0, 'resume does not catch up hidden animation time');
  h.reduced.matches = true;
  h.reduced.dispatchEvent(new Event('change'));
  h.tick(20_100);
  assert.equal(updates.at(-1)[2], true);
  assert.equal(h.pending.size, 0);
});

test('empty kitchens draw once per invalidation, coalesce requests and preserve resolution', async (t) => {
  const h = await harness(t);
  assert.equal(h.pending.size, 1);
  h.resize();
  h.tick(0);
  assert.equal(h.pending.size, 0);
  assert.equal(h.renders.length, 1);
  assert.equal(h.renderer.pixelRatio, 2);
  assert.deepEqual(h.renderer.size, [800, 600]);
  assert.equal(h.renders[0].staticShadows, true);
  h.resize();
  h.resize();
  h.tick(100);
  assert.equal(h.renders.at(-1).staticShadows, false, 'resize keeps static maps');
  assert.equal(h.pending.size, 0);
  h.owners[0].invalidate();
  h.owners[0].invalidate();
  h.tick(200);
  assert.equal(h.renders.at(-1).staticShadows, true, 'room asset refreshes static maps');
  assert.equal(h.pending.size, 0);
});

test('small RAF timestamp jitter does not turn the 30 fps budget into 20–25 fps', async (t) => {
  const h = await harness(t);
  h.runtime.update([actor]);
  for (let frame = 0; frame <= 120; frame++) h.tick(frame * (1000 / 60 - 0.01));
  assert.ok(h.renders.length >= 59 && h.renders.length <= 61, String(h.renders.length));
});

for (const hz of [60, 120, 144]) {
  test(`actors draw at most 30 fps on a ${hz} Hz display and shadows update only on drawn frames`, async (t) => {
    const h = await harness(t);
    h.runtime.update([actor, { ...actor, id: 'two', seat: 1 }]);
    for (let frame = 0; frame <= hz * 2; frame++) h.tick((frame * 1000) / hz);
    assert.ok(h.renders.length >= 59 && h.renders.length <= 61);
    for (let i = 1; i < h.renders.length; i++)
      assert.ok(h.renders[i].now - h.renders[i - 1].now >= 1000 / 30 - 1000 / hz - 1e-6);
    assert.equal(h.shadowUpdates.length, h.renders.length);
    assert.equal(h.renders.filter((frame) => frame.staticShadows).length, 1);
    assert.equal(h.pending.size, 1);
    assert.ok(Number.isFinite(parseFloat(h.bubbles[0].style.left)));
    assert.ok(Number.isFinite(parseFloat(h.bubbles[0].style.top)));
  });
}

test('skipped RAFs retain full motion delta, including a first timestamp of zero', async (t) => {
  const h = await harness(t);
  h.runtime.update([actor]);
  for (let i = 0; i <= 72; i++) h.tick((i * 1000) / 120);
  const model = h.appearances[0];
  assert.ok(Math.abs(model.root.rotation.y - 0.6 * 3.5) < 1e-10);
  assert.ok(Math.abs(model.body.position.y - Math.sin(0.6 * 3) * 0.012) < 1e-10);
  const yaw = model.root.rotation.y;
  h.tick(10_000);
  assert.ok(
    Math.abs(model.root.rotation.y - yaw - 0.06 * 3.5) < 1e-10,
    'long stall remains clamped',
  );
});

test('capped animation reaches the fridge and returns to cooking with whole-body motion', async (t) => {
  const h = await harness(t);
  h.runtime.update([{ ...actor, activity: 'searching' }]);
  const model = h.appearances[0];
  const spawn = model.root.position.clone();
  for (let frame = 0; frame <= 120 * 20; frame++) h.tick((frame * 1000) / 120);
  const target = h.planAction('searching', 0).target;
  assert.ok(model.root.position.distanceTo(spawn) > 0.5);
  assert.ok(Math.abs(model.root.position.x - target[0]) < 1e-8);
  assert.ok(Math.abs(model.root.position.z - target[1]) < 1e-8);
  h.runtime.update([actor]);
  for (let frame = 1; frame <= 120 * 20; frame++) h.tick(20_000 + (frame * 1000) / 120);
  const cooking = h.planAction('working', 0).target;
  assert.ok(Math.abs(model.root.position.x - cooking[0]) < 1e-8);
  assert.ok(Math.abs(model.root.position.z - cooking[1]) < 1e-8);
});

test('actor additions/removals clear the dynamic map without invalidating static maps or retaining idle time', async (t) => {
  const h = await harness(t);
  h.tick(0);
  h.runtime.update([actor]);
  h.tick(10_000);
  assert.equal(h.appearances[0].root.rotation.y, 0);
  h.tick(10_010);
  assert.equal(h.renders.length, 2, 'skip a RAF that arrives too soon');
  h.owners[1].invalidate();
  h.tick(10_040);
  assert.equal(h.renders.at(-1).staticShadows, false, 'actor asset keeps static cache');
  h.runtime.update([]);
  h.tick(10_050);
  assert.equal(h.pending.size, 0);
  assert.equal(h.renders.length, 4);
  assert.equal(h.shadowUpdates.length, 4, 'last actor removal clears the dynamic map once');
  assert.equal(h.owners[1].disposed, true);
  h.runtime.update([actor]);
  h.tick(50_000);
  assert.equal(h.appearances[1].root.rotation.y, 0, 'new actor does not consume idle time');
});

test('reduced motion snaps once, redraws on updates/assets and resumes without a time jump', async (t) => {
  const h = await harness(t, true);
  h.runtime.update([actor]);
  h.tick(0);
  assert.equal(h.pending.size, 0);
  assert.equal(h.appearances[0].body.position.y, 0);
  const position = h.appearances[0].root.position.clone();
  h.runtime.update([{ ...actor, activity: 'searching' }]);
  h.tick(10_000);
  assert.equal(h.pending.size, 0);
  assert.ok(h.appearances[0].root.position.distanceTo(position) > 0.5);
  h.owners[1].invalidate();
  h.tick(20_000);
  assert.equal(h.pending.size, 0);
  assert.equal(h.renders.at(-1).staticShadows, false);
  h.reduced.matches = false;
  h.reduced.dispatchEvent(new Event('change'));
  const before = h.appearances[0].root.position.clone();
  h.tick(30_000);
  assert.equal(h.pending.size, 1);
  assert.deepEqual(h.appearances[0].root.position, before);
  h.reduced.matches = true;
  h.reduced.dispatchEvent(new Event('change'));
  h.tick(40_000);
  assert.equal(h.pending.size, 0);
});

test('offscreen and hidden documents pause and retain dirty assets until visible again', async (t) => {
  const h = await harness(t);
  h.runtime.update([actor]);
  h.tick(0);
  h.tick(40);
  const yaw = h.appearances[0].root.rotation.y;
  h.runtime.setVisible(false);
  h.owners[0].invalidate();
  h.resize();
  h.tick(10_000);
  assert.equal(h.pending.size, 0);
  assert.equal(h.renders.length, 2);
  h.runtime.setVisible(true);
  h.tick(20_000);
  assert.equal(h.appearances[0].root.rotation.y, yaw);
  assert.equal(h.renders.at(-1).staticShadows, true);
  h.document.hidden = true;
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.pending.size, 0);
  h.runtime.update([{ ...actor, activity: 'searching' }]);
  h.document.hidden = false;
  h.document.dispatchEvent(new Event('visibilitychange'));
  h.tick(30_000);
  assert.equal(h.appearances[0].root.rotation.y, yaw);
  assert.equal(h.renders.at(-1).staticShadows, false);
});

test('render failure, context loss and disposal cancel pending work and ignore late invalidations', async (t) => {
  for (const ending of ['render', 'context', 'dispose']) {
    const h = await harness(t);
    h.runtime.update([actor]);
    if (ending === 'render')
      h.renderer.render = () => {
        throw new Error('GPU failed');
      };
    if (ending === 'context') h.canvas.dispatchEvent(new Event('webglcontextlost'));
    if (ending === 'dispose') h.runtime.dispose();
    h.tick(0);
    h.owners[0].invalidate();
    h.resize();
    h.tick(100);
    assert.equal(h.pending.size, 0);
    assert.deepEqual(
      h.failures,
      ending === 'render' ? ['webgl'] : ending === 'context' ? ['contextLost'] : [],
    );
  }
});

test('session board keeps four independent owners, caps overflow and refreshes labels without respawning', async (t) => {
  const h = await harness(t);
  const group = [0, 1, 2, 3, 4].map((seat) => ({
    id: 'session-' + seat,
    label: 'Session ' + seat,
    seat,
    activity: 'working',
    roaming: true,
  }));
  h.runtime.update(group);
  assert.equal(h.appearances.length, 4);
  assert.equal(h.owners.filter((o) => o.dynamic && !o.disposed).length, 4);
  h.tick(0);
  h.tick(40);
  h.runtime.update(group.slice(0, 4).map((a) => ({ ...a, label: 'Renamed', activity: 'waiting' })));
  assert.equal(h.appearances.length, 4);
  const before = h.appearances.map((a) => a.root.position.clone());
  for (let i = 2; i < 400; i++) h.tick(i * 40);
  assert.ok(h.appearances.some((a, i) => a.root.position.distanceTo(before[i]) > 0.1));
  h.runtime.update([]);
  assert.equal(h.owners.filter((o) => o.dynamic && !o.disposed).length, 0);
});
