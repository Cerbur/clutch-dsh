import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { geometryOnlyGlb } from '../scripts/export-lighting-geometry.mjs';
import * as T from 'three';
import { KITCHEN_PRACTICALS } from '../lib/office/kitchen-practicals.js';
import { configureWindowGlow } from '../lib/client/scene/window-glow.js';
import { configureKitchenMaterial } from '../lib/client/scene/area-shadow.js';

test('adopted shell bake and runtime use identical practical sources and pane emission', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../assets/lighting/kitchen/manifest.json', import.meta.url)),
  );
  assert.deepEqual(
    manifest.bake.practicals,
    KITCHEN_PRACTICALS,
    'changing any practical source requires a real Cycles rebake, not a relabelled atlas',
  );
  assert.deepEqual(manifest.receiverIds, ['floor', 'left-wall', 'right-wall']);
});

test('window pane emission composes with PBR/area-shadow hooks, retaining source geometry, maps and frame surfaces', () => {
  const root = new T.Group();
  const geometry = new T.BoxGeometry();
  const map = new T.Texture();
  const material = new T.MeshStandardMaterial({ map, color: '#c09050', roughness: 0.54 });
  const mesh = new T.Mesh(geometry, material);
  root.add(mesh);
  const attributes = { ...geometry.attributes };
  const initial = material.color.clone();
  let previous = 0;
  material.onBeforeCompile = function (shader) {
    previous++;
    shader.uniforms.priorHook = { value: 1 };
  };
  material.customProgramCacheKey = () => 'window-source-identity';
  configureKitchenMaterial(material);
  configureWindowGlow(root);
  const hook = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  configureWindowGlow(root);
  assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.customProgramCacheKey(), key);
  assert.match(key, /window-source-identity.*kitchen-area.*office-window-pane-warm/);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.equal(previous, 1);
  assert.equal(shader.uniforms.priorHook.value, 1);
  assert.match(shader.vertexShader, /vOfficeWindowPosition = position/);
  assert.match(shader.fragmentShader, /totalEmissiveRadiance \+= officePane/);
  assert.match(shader.fragmentShader, /normalize\(vOfficeWindowNormal\)\.z/);
  assert.match(shader.fragmentShader, /step\(0\.090000, vOfficeWindowPosition\.z\)/);
  assert.match(shader.fragmentShader, /kitchenAreaVisibility/);
  assert.match(shader.fragmentShader, /#include <emissivemap_fragment>/);
  assert.equal(mesh.geometry, geometry);
  assert.deepEqual(geometry.attributes, attributes);
  assert.equal(material.map, map);
  assert.ok(material.color.equals(initial));
  assert.equal(material.roughness, 0.54);
  assert.equal(root.children.length, 1, 'no floating pane geometry or extra draw batch');
  assert.throws(
    () => material.onBeforeCompile({ uniforms: {}, vertexShader: '', fragmentShader: '' }, {}),
    /required|include/,
  );
  geometry.dispose();
  material.dispose();
  map.dispose();
});

test('all four real window panes emit while raised timber frame faces stay outside the mask', async () => {
  const bytes = geometryOnlyGlb(
    readFileSync(new URL('../assets/models/kitchen/window.glb', import.meta.url)),
  );
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    '',
  );
  scene.updateMatrixWorld(true);
  const g = KITCHEN_PRACTICALS.windowGlow;
  const emitting = (p) =>
    Math.abs(p.x) <= g.halfWidth &&
    p.y >= g.minHeight &&
    p.y <= g.maxHeight &&
    p.z >= g.minDepth &&
    p.z <= g.maxDepth;
  const hit = (x, y) =>
    new T.Raycaster(new T.Vector3(x, y, 2), new T.Vector3(0, 0, -1)).intersectObject(scene, true)[0]
      .point;
  for (const [x, y] of [
    [-0.22, 0.24],
    [0.22, 0.24],
    [-0.22, 0.55],
    [0.22, 0.55],
  ])
    assert.equal(emitting(hit(x, y)), true, `pane at ${x},${y}`);
  for (const [x, y] of [
    [0, 0.24],
    [0.45, 0.24],
    [-0.22, 0.1],
    [-0.22, 0.68],
  ])
    assert.equal(emitting(hit(x, y)), false, `wood at ${x},${y}`);
  const back = new T.Raycaster(
    new T.Vector3(-0.22, 0.55, -1),
    new T.Vector3(0, 0, 1),
  ).intersectObject(scene, true)[0];
  assert.ok(back, 'actual window rear surface exists');
  assert.equal(
    emitting(back.point),
    false,
    'rear timber must not emit through the pane depth mask',
  );
  scene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    }
  });
});
