import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ASSET_RULES, validateAsset } from '../scripts/sync-asset.mjs';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_SCALE,
  kitchenActorGroundY,
  KITCHEN_STATIONS,
} from '../lib/office/kitchen-layout.js';

test('independent floor mat retains immutable authored textile PBR, scale and tight budgets', async () => {
  const bytes = await readFile(new URL('../assets/models/kitchen/floor-mat.glb', import.meta.url));
  const manifest = JSON.parse(
    await readFile(new URL('../assets/models/kitchen/floor-mat.manifest.json', import.meta.url)),
  );
  const facts = validateAsset(manifest, bytes);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    'c4c982fcbe133b70cb3e534bc5a2a66186f0ea3f1b06695289af9b37f035059f',
  );
  assert.equal(facts.triangles, 1900);
  assert.equal(bytes.length, 1427356);
  assert.equal(manifest.revision, '2026-10-29-r1');
  assert.equal(ASSET_RULES['kitchen/floor-mat'].triangles, 6000);
  assert.equal(ASSET_RULES['kitchen/floor-mat'].images, 2);
  assert.equal(ASSET_RULES['kitchen/refrigerator'].triangles, 30000);
  assert.equal(KITCHEN_SCALE['floor-mat'], undefined);
  assert.notDeepEqual(KITCHEN_PLACEMENT.rug, KITCHEN_PLACEMENT['floor-mat']);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.equal(doc.images.length, 2);
  assert.equal(doc.materials.length, 1);
  const material = doc.materials[0];
  assert.equal(material.pbrMetallicRoughness.metallicFactor, 0);
  assert.ok(Math.abs(material.pbrMetallicRoughness.roughnessFactor - 0.7) < 1e-6);
  assert.equal(material.extensions?.KHR_materials_clearcoat?.clearcoatFactor ?? 0, 0);
  if (process.env.OFFICE_ASSET_LIBRARY) {
    const original = await readFile(
      process.env.OFFICE_ASSET_LIBRARY +
        '/kitchen/floor-mat/deliveries/2026-10-29-r1/floor-mat.glb',
    );
    assert.deepEqual(bytes, original);
  }
});

test('walkable mat supports fridge stops and edge-crossing soles without lowering existing roaming ground', () => {
  const [x, y, z] = KITCHEN_PLACEMENT['floor-mat'];
  const safeTop = y + 0.018 + 0.001;
  for (const point of [
    KITCHEN_STATIONS.search[0],
    [x, z],
    [x - 0.8, z],
    [x + 0.8, z],
    [x, z - 0.6],
    [x, z + 0.6],
  ]) {
    assert.ok(kitchenActorGroundY(point, 0.025) >= safeTop - 1e-9);
    assert.equal(kitchenActorGroundY(point, 0.054), 0.054);
  }
  assert.ok(kitchenActorGroundY([x, z], 0.04, 0.012) - 0.012 >= safeTop - 1e-9);
  assert.equal(kitchenActorGroundY([-0.4, 1.55], 0.025), 0.025);
  assert.equal(kitchenActorGroundY([x + 1.1, z], 0.025), 0.025);
});
