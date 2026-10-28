import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { WebGLShadowMap } from 'three/src/renderers/webgl/WebGLShadowMap.js';
import { createCharacterShadowPass } from '../lib/client/scene/character-shadow.js';
import { createKitchenLightRig } from '../lib/client/scene/lighting.js';
import { createKitchenRenderGuard } from '../lib/client/scene/render-failure.js';

// Exercise r180's real caster traversal and map update gates. Only GPU operations
// are stubbed. Direct renderBufferDirect outside the active renderer stage fails.
function harness(t) {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera();
  const rig = createKitchenLightRig(scene);
  const lights = scene.getObjectsByProperty('isSpotLight', true);
  const proxy = rig.characterShadow;
  const geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial();
  const furniture = new T.Mesh(geometry, material),
    actor = new T.Mesh(geometry, material);
  furniture.name = 'static-furniture';
  actor.name = 'session-character';
  furniture.castShadow = actor.castShadow = true;
  furniture.frustumCulled = actor.frustumCulled = false;
  actor.layers.enable(1);
  const parent = new T.Group();
  parent.add(actor);
  scene.add(furniture, parent);
  const draws = [],
    clears = [];
  let target = null,
    active = false;
  const renderer = {
    debug: { checkShaderErrors: true, onShaderError: null },
    state: {
      setBlending() {},
      setScissorTest() {},
      viewport() {},
      buffers: { color: { setClear() {} }, depth: { getReversed: () => false, setTest() {} } },
    },
    getRenderTarget: () => target,
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    setRenderTarget(value) {
      target = value;
    },
    clear() {
      clears.push(target);
    },
    renderBufferDirect(shadowCamera, _scene, _geometry, _material, object) {
      assert.ok(active, 'Three requires currentRenderState during shadow draws');
      draws.push({
        light: lights.find((light) => light.shadow.camera === shadowCamera).name,
        object: object.name,
      });
    },
    render(renderScene, renderCamera) {
      renderScene.updateMatrixWorld(true);
      renderCamera.updateMatrixWorld(true);
      active = true;
      try {
        this.shadowMap.render(lights, renderScene, renderCamera);
        assert.ok(proxy.shadow.map, 'fourth map exists before first setupLights/color pass');
      } finally {
        active = false;
      }
    },
  };
  renderer.shadowMap = new WebGLShadowMap(
    renderer,
    { update: (object) => object.geometry },
    { maxTextureSize: 4096 },
  );
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.shadowMap.needsUpdate = true;
  const original = renderer.shadowMap.render;
  const pass = createCharacterShadowPass(renderer, scene, proxy);
  t.after(() => {
    pass.dispose();
    rig.dispose();
    geometry.dispose();
    material.dispose();
  });
  return { scene, camera, rig, proxy, actor, furniture, renderer, pass, original, draws, clears };
}

test('first frame uses real layer-1 caster traversal, creates all maps and never overwrites the actor map', (t) => {
  const h = harness(t);
  h.pass.update(h.camera);
  assert.equal(h.draws.length, 0, 'request does not enter an uninitialized renderer');
  h.renderer.render(h.scene, h.camera);
  assert.deepEqual(
    h.draws.filter((x) => x.light === h.proxy.name).map((x) => x.object),
    ['session-character'],
  );
  for (const name of ['warm-key', 'review-fill-area-shadow', 'review-rim-area-shadow'])
    assert.deepEqual(
      h.draws.filter((x) => x.light === name).map((x) => x.object),
      ['static-furniture'],
    );
  assert.equal(h.clears.filter((target) => target === h.proxy.shadow.map).length, 1);
  assert.equal(h.proxy.shadow.map.width, 512);
  assert.equal(h.proxy.shadow.autoUpdate, false);
  assert.equal(h.proxy.shadow.needsUpdate, false);
  assert.equal(h.renderer.shadowMap.needsUpdate, false);
  assert.equal(h.camera.layers.mask, 1, 'main-camera layers stay unchanged');
  assert.equal(h.actor.layers.mask, 3);
  assert.equal(h.actor.castShadow, true, 'caster restored for future dynamic frames');
});

test('an initially empty room gets a cleared map even without an explicit request', (t) => {
  const h = harness(t);
  h.actor.removeFromParent();
  h.renderer.render(h.scene, h.camera);
  assert.ok(h.proxy.shadow.map);
  assert.equal(h.clears.filter((target) => target === h.proxy.shadow.map).length, 1);
  assert.equal(
    h.draws.some((x) => x.light === h.proxy.name),
    false,
  );
});

test('subsequent actor-only updates preserve cached static maps and clear ghosts after actor removal', (t) => {
  const h = harness(t);
  h.renderer.render(h.scene, h.camera);
  h.draws.length = 0;
  h.clears.length = 0;
  h.actor.position.x = 2;
  h.pass.update(h.camera);
  h.renderer.render(h.scene, h.camera);
  assert.deepEqual(h.draws, [{ light: h.proxy.name, object: 'session-character' }]);
  assert.deepEqual(h.clears, [h.proxy.shadow.map]);
  assert.equal(h.renderer.shadowMap.needsUpdate, false);
  h.draws.length = 0;
  h.clears.length = 0;
  h.actor.removeFromParent();
  h.pass.update(h.camera);
  h.renderer.render(h.scene, h.camera);
  assert.deepEqual(h.draws, []);
  assert.deepEqual(h.clears, [h.proxy.shadow.map]);
});

test('normal shadow invalidation can repaint the three other maps without touching the actor map', (t) => {
  const h = harness(t);
  h.renderer.render(h.scene, h.camera);
  h.draws.length = 0;
  h.clears.length = 0;
  h.renderer.shadowMap.needsUpdate = true;
  h.renderer.render(h.scene, h.camera);
  assert.equal(h.draws.length, 3);
  assert.ok(h.draws.every((x) => x.object === 'static-furniture'));
  assert.equal(
    h.draws.some((x) => x.light === h.proxy.name),
    false,
  );
  assert.equal(h.clears.includes(h.proxy.shadow.map), false);
});

test('static-map refresh restores actor caster flags even when a static draw fails', (t) => {
  const h = harness(t);
  h.renderer.render(h.scene, h.camera);
  const draw = h.renderer.renderBufferDirect;
  h.renderer.renderBufferDirect = (...args) => {
    if (args[4] === h.furniture) throw new Error('static depth failed');
    draw(...args);
  };
  h.renderer.shadowMap.needsUpdate = true;
  assert.throws(() => h.renderer.render(h.scene, h.camera), /static depth failed/);
  assert.equal(h.actor.castShadow, true);
  assert.equal(h.furniture.castShadow, true);
  assert.equal(h.actor.layers.mask, 3);
});

test('a shadow-pass throw is guarded once, restores update flags and prevents later GPU retries', (t) => {
  const h = harness(t);
  let failures = 0,
    calls = 0;
  h.renderer.renderBufferDirect = () => {
    calls++;
    throw new Error('actor depth shader hook failed');
  };
  const guard = createKitchenRenderGuard(
    {
      debug: h.renderer.debug,
      render(scene, camera) {
        h.pass.update(camera);
        h.renderer.render(scene, camera);
      },
    },
    () => failures++,
  );
  t.after(() => guard.dispose());
  assert.equal(guard.render(h.scene, h.camera), false);
  assert.equal(
    h.renderer.shadowMap.needsUpdate,
    true,
    'restore the normal pass request even on failure',
  );
  assert.equal(h.proxy.shadow.needsUpdate, false);
  assert.equal(guard.render(h.scene, h.camera), false);
  assert.equal(failures, 1);
  assert.equal(calls, 1);
});

test('driver depth-shader errors are contained by the same frame guard', (t) => {
  const h = harness(t);
  let failures = 0;
  h.renderer.renderBufferDirect = () => h.renderer.debug.onShaderError({}, {}, {}, {});
  const guard = createKitchenRenderGuard(
    {
      debug: h.renderer.debug,
      render(scene, camera) {
        h.pass.update(camera);
        h.renderer.render(scene, camera);
      },
    },
    () => failures++,
  );
  t.after(() => guard.dispose());
  assert.equal(guard.render(h.scene, h.camera), false);
  assert.equal(guard.render(h.scene, h.camera), false);
  assert.equal(failures, 1);
});

test('disposal restores only the owned renderer hook, is idempotent and ignores late requests', (t) => {
  const h = harness(t);
  h.pass.update(h.camera);
  h.pass.dispose();
  h.pass.dispose();
  assert.equal(h.renderer.shadowMap.render, h.original);
  h.pass.update(h.camera);
  assert.equal(h.draws.length, 0);
});

test('hook replacement fails closed and disposal does not overwrite another owner', (t) => {
  const h = harness(t),
    replacement = () => {};
  h.renderer.shadowMap.render = replacement;
  assert.throws(() => h.pass.update(h.camera), /shadow stage was replaced/);
  h.pass.dispose();
  assert.equal(h.renderer.shadowMap.render, replacement);
});
