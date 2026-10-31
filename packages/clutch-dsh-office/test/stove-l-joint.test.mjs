import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateAsset, ASSET_RULES } from '../scripts/sync-asset.mjs';
import { geometryOnlyGlb } from '../scripts/export-lighting-geometry.mjs';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  KITCHEN_STATIONS,
} from '../lib/office/kitchen-layout.js';

test('new static stove forms a measured L without moving table or relaxing the legacy contract', async () => {
  const [bytes, json, sinkJson] = await Promise.all([
    readFile(new URL('../assets/models/kitchen/stove.glb', import.meta.url)),
    readFile(new URL('../assets/models/kitchen/stove.manifest.json', import.meta.url)),
    readFile(new URL('../assets/models/kitchen/sink-cabinet.manifest.json', import.meta.url)),
  ]);
  const manifest = JSON.parse(json),
    sink = JSON.parse(sinkJson);
  const refined = manifest.revision === '2026-10-29-refined-r1';
  if (!refined) {
    assert.equal(manifest.style.parentRevision, '2026-10-28-r6');
    assert.equal(manifest.revision, '2026-10-28-candy-r1');
  }
  const facts = validateAsset(manifest, bytes);
  if (refined) {
    assert.ok(facts.triangles > 0 && facts.triangles <= 40000);
    assert.equal(facts.materials, 3);
    assert.equal(facts.primitives, 3);
  } else {
    assert.equal(facts.triangles, 12655);
    assert.equal(facts.primitives, 2);
  }
  assert.equal(facts.images, 3);
  assert.ok(bytes.length < 4 * 1024 * 1024);
  assert.equal(ASSET_RULES['kitchen/stove'].primitives, 20);
  assert.ok(ASSET_RULES['kitchen/stove'].nodes.includes('左柜门'));
  assert.throws(
    () => validateAsset({ ...manifest, revision: 'old-contract' }, bytes),
    /Missing required node/,
  );
  const position = new T.Vector3(...KITCHEN_PLACEMENT.stove);
  const rotation = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 1, 0),
    KITCHEN_ROTATION.stove,
  );
  const transform = new T.Matrix4().compose(position, rotation, new T.Vector3(1, 1, 1));
  const [sx] = KITCHEN_SCALE['sink-cabinet'];
  const sinkLeft = KITCHEN_PLACEMENT['sink-cabinet'][0] + sink.bounds.min[0] * sx;
  assert.ok(Math.abs(position.x - manifest.countertop.depth / 2 - sinkLeft) < 1e-7);
  assert.ok(
    Math.abs(manifest.countertop.depth - 0.9996259421448968) < 1e-7,
    'depth matches measured sink left module width',
  );
  const { scene } = await new GLTFLoader().parseAsync(geometryOnlyGlb(bytes).buffer, '');
  scene.applyMatrix4(transform);
  scene.updateMatrixWorld(true);
  const body = new T.Box3().setFromObject(scene.getObjectByName('灶台静态总成'), true);
  const cap = new T.Box3().setFromObject(scene.getObjectByName('转角接缝台面'), true);
  assert.ok(Math.abs(body.min.z - -0.997) < 1e-6, 'body clears protruding sink handles');
  assert.ok(Math.abs(cap.min.z - -1.064) < 1e-6, 'only top cap bridges to sink rolled lip');
  assert.ok(cap.max.y - cap.min.y < 0.0011, 'thin cap stays above the rounded sink edge');
  assert.ok(
    Math.abs(cap.max.y - 0.91665) < 0.0002,
    'tops meet at actual mesh height rather than faucet total height',
  );
  assert.ok(
    cap.min.x > sinkLeft && cap.max.x < sinkLeft + manifest.countertop.depth,
    'cap inset avoids neighboring module',
  );
  assert.ok(
    Math.abs(KITCHEN_PLACEMENT['storage-cabinet'][2] + 0.3531339466571808 - 2.99) < 1e-6,
    'cart front is at platform edge',
  );
  assert.deepEqual(KITCHEN_PLACEMENT.table, [1.45, 0, 1.15]);
  assert.deepEqual(KITCHEN_PLACEMENT['chair-left'], [0.95, 0.025, 2.03]);
  assert.ok(
    KITCHEN_STATIONS.cook.every((p) => p[0] > body.max.x),
    'cook stations remain in front of deeper cabinet',
  );
});
