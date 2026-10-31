import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createKitchenStaticFrame } from '../lib/client/scene/static-frame.js';

function fixture() {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera();
  const furniture = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial());
  const actor = furniture.clone();
  actor.layers.enable(1);
  const receiver = new T.Mesh(new T.PlaneGeometry(), new T.MeshStandardMaterial());
  receiver.material.userData.officeBakedLighting = true;
  const hidden = furniture.clone();
  hidden.visible = false;
  scene.add(furniture, receiver, actor, hidden);
  const background = new T.Color('blue');
  scene.background = background;
  let currentTarget = null,
    width = 1680,
    height = 820,
    shadowUpdates = 0,
    failAt = Infinity;
  const calls = [],
    targets = [],
    copies = [];
  const captures = new Set();
  let captureDisposals = 0;
  const renderer = {
    extensions: { has: () => true },
    autoClear: true,
    getContext: () => ({ SAMPLES: 1, getParameter: () => 4 }),
    getDrawingBufferSize: (size) => size.set(width * 2, height * 2),
    getRenderTarget: () => currentTarget,
    initRenderTarget: (target) => targets.push(target),
    copyTextureToTexture: (source, destination) => copies.push({ source, destination }),
    setRenderTarget: (value) => {
      currentTarget = value;
      if (value && !captures.has(value)) {
        captures.add(value);
        value.addEventListener('dispose', () => captureDisposals++);
      }
    },
    render(renderScene) {
      calls.push({
        target: currentTarget,
        scene: renderScene,
        clear: this.autoClear,
        furniture: furniture.visible,
        receiver: receiver.visible,
        actor: actor.visible,
        background: scene.background,
        furnitureMaterial: furniture.material,
        visibleNames: scene.children.filter((mesh) => mesh.visible).map((mesh) => mesh.name),
      });
      if (calls.length === failAt) throw new Error('simulated GPU failure');
    },
  };
  const cache = createKitchenStaticFrame(renderer, scene, camera, () => shadowUpdates++);
  return {
    cache,
    renderer,
    calls,
    targets,
    copies,
    furniture,
    actor,
    receiver,
    hidden,
    scene,
    camera,
    background,
    resize(w, h) {
      width = w;
      height = h;
    },
    fail(after = 0) {
      failAt = calls.length + after + 1;
    },
    get captureDisposals() {
      return captureDisposals;
    },
    get shadowUpdates() {
      return shadowUpdates;
    },
  };
}

test('full-resolution cache preserves full-scene shadow setup and redraws only actors/receivers', () => {
  const f = fixture();
  f.cache.render();
  assert.equal(f.calls.length, 4);
  const [capture, copy, depth, dynamic] = f.calls;
  assert.deepEqual([capture.furniture, capture.receiver, capture.actor], [true, true, false]);
  assert.equal(capture.target.width, 3360);
  assert.equal(capture.target.height, 1640);
  assert.equal(capture.target.samples, 4);
  assert.equal(capture.target.texture.type, T.HalfFloatType);
  assert.equal(capture.target.depthTexture.type, T.UnsignedIntType);
  assert.equal(f.targets[0].samples, 0, 'retain resolved storage only');
  assert.equal(f.copies.length, 2, 'preserve both HDR color and background mask');
  assert.equal(f.captureDisposals, 1, 'MSAA storage is freed immediately after resolve/copy');
  assert.equal(copy.target, null);
  assert.equal(copy.scene.children[0].material.depthWrite, false);
  assert.equal(depth.furnitureMaterial.colorWrite, false);
  assert.ok(depth.furnitureMaterial instanceof T.MeshDepthMaterial);
  assert.deepEqual([depth.furniture, depth.receiver, depth.actor], [true, false, false]);
  assert.deepEqual([dynamic.furniture, dynamic.receiver, dynamic.actor], [false, true, true]);
  assert.equal(dynamic.clear, false);
  assert.equal(dynamic.background, null);
  assert.equal(f.hidden.visible, false);
  assert.equal(f.scene.background, f.background);
  f.calls.length = 0;
  f.cache.render();
  assert.equal(f.calls.length, 3, 'stable frames redraw only depth, not static PBR');
  assert.deepEqual(
    [f.calls[2].furniture, f.calls[2].receiver, f.calls[2].actor],
    [false, true, true],
  );
  f.cache.dispose();
});

test('asset invalidation and resize rebuild once; actor movement does not rebuild', () => {
  const f = fixture();
  f.cache.render();
  f.calls.length = 0;
  f.actor.position.x = 1;
  f.cache.render();
  assert.equal(f.calls.length, 3);
  f.cache.invalidate();
  f.cache.invalidate();
  f.calls.length = 0;
  f.cache.render();
  assert.equal(f.calls.length, 4);
  f.resize(1920, 1080);
  f.calls.length = 0;
  f.cache.render();
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[0].target.width, 3840);
  f.calls.length = 0;
  f.cache.render();
  assert.equal(f.calls.length, 3);
  f.cache.dispose();
});

test('failed renders restore caller state and disposal releases only cache-owned resources once', () => {
  const f = fixture();
  f.cache.render();
  const target = f.targets[0];
  const quad = f.calls[1].scene.children[0];
  const counts = { target: 0, geometry: 0, material: 0, source: 0 };
  target.addEventListener('dispose', () => counts.target++);
  quad.geometry.addEventListener('dispose', () => counts.geometry++);
  quad.material.addEventListener('dispose', () => counts.material++);
  f.furniture.geometry.addEventListener('dispose', () => counts.source++);
  f.cache.invalidate();
  f.fail();
  assert.throws(() => f.cache.render(), /GPU failure/);
  assert.equal(f.renderer.getRenderTarget(), null);
  assert.equal(f.renderer.autoClear, true);
  assert.equal(f.scene.background, f.background);
  assert.deepEqual(
    [f.actor.visible, f.receiver.visible, f.furniture.visible, f.hidden.visible],
    [true, true, true, false],
  );
  assert.equal(f.captureDisposals, 2, 'failed capture also frees temporary MSAA storage');
  f.cache.dispose();
  f.cache.dispose();
  assert.deepEqual(counts, { target: 1, geometry: 1, material: 1, source: 0 });
  f.calls.length = 0;
  f.cache.render();
  assert.equal(f.calls.length, 0);
});

test('oven glass stays in the shadow setup but blends only once in the live pass', () => {
  const f = fixture();
  const glass = new T.Mesh(
    new T.PlaneGeometry(),
    new T.MeshStandardMaterial({ transparent: true, opacity: 0.4, depthWrite: false }),
  );
  glass.name = 'glass';
  f.scene.add(glass);
  f.cache.render();
  assert.equal(f.calls.length, 5);
  assert.ok(f.calls[0].visibleNames.includes('glass'));
  assert.ok(!f.calls[1].visibleNames.includes('glass'));
  assert.ok(!f.calls[3].visibleNames.includes('glass'));
  assert.ok(f.calls[4].visibleNames.includes('glass'));
  assert.equal(glass.material.opacity, 0.4);
  f.cache.dispose();
});

test('depth-pass failure restores original materials and visibility', () => {
  const f = fixture();
  f.cache.render();
  const source = f.furniture.material;
  f.fail(1);
  assert.throws(() => f.cache.render(), /GPU failure/);
  assert.equal(f.furniture.material, source);
  assert.deepEqual([f.actor.visible, f.receiver.visible, f.furniture.visible], [true, true, true]);
  assert.equal(f.renderer.autoClear, true);
  f.cache.dispose();
});

test('unsupported HDR targets retain the direct renderer and release cleanly', () => {
  const f = fixture();
  f.cache.dispose();
  f.renderer.extensions.has = () => false;
  const direct = createKitchenStaticFrame(f.renderer, f.scene, f.camera, () => {});
  direct.render();
  assert.equal(f.calls.length, 1);
  assert.deepEqual(
    [f.calls[0].furniture, f.calls[0].receiver, f.calls[0].actor],
    [true, true, true],
  );
  direct.dispose();
  direct.render();
  assert.equal(f.calls.length, 1);
});

test('streaming assets use the direct path until ready, then cache at full resolution', () => {
  const f = fixture();
  f.furniture.userData.assetState = 'loading';
  f.cache.render();
  assert.equal(f.calls.length, 1);
  assert.equal(f.targets.length, 0);
  f.furniture.userData.assetState = 'ready';
  f.calls.length = 0;
  f.cache.render();
  assert.equal(f.calls.length, 4);
  assert.equal(f.captureDisposals, 1);
  f.cache.dispose();
});
