import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Box3, Matrix4, Vector3 } from 'three';
import { validateAsset } from '../scripts/sync-asset.mjs';
import { KITCHEN_PLACEMENT, KITCHEN_ROTATION } from '../lib/office/kitchen-layout.js';

test('both wall deliveries fit the approved shell with floor-matched thickness and textureless matte surfaces', async () => {
  for (const id of ['left-wall', 'right-wall']) {
    const bytes = await readFile(new URL(`../assets/models/kitchen/${id}.glb`, import.meta.url));
    const manifest = JSON.parse(
      await readFile(new URL(`../assets/models/kitchen/${id}.manifest.json`, import.meta.url)),
    );
    const facts = validateAsset(manifest, bytes);
    assert.ok(
      facts.dimensions.width > 5.08 && facts.dimensions.width < 5.1,
      'rounded miter envelope',
    );
    assert.ok(Math.abs(facts.dimensions.height - 3.5) < 0.0001);
    assert.ok(Math.abs(facts.bounds.min[1]) < 0.0001);
    assert.equal(facts.materials, 1);
    assert.equal(facts.primitives, 1);
    const floorManifest = JSON.parse(
      await readFile(new URL('../assets/models/kitchen/floor.manifest.json', import.meta.url)),
    );
    assert.ok(Math.abs(facts.dimensions.depth - floorManifest.dimensions.height) < 0.0003);
    assert.ok(
      !facts.nodes.some((name) => /shelf|plant|stove|sink|refrigerator/.test(name)),
      'decorations stay scene-owned',
    );
    const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    assert.equal(facts.images, 0);
    assert.equal(doc.textures?.length ?? 0, 0);
    assert.equal(doc.materials[0].normalTexture, undefined);
    assert.equal(doc.materials[0].pbrMetallicRoughness.baseColorTexture, undefined);
    assert.equal(doc.materials[0].pbrMetallicRoughness.metallicRoughnessTexture, undefined);
    assert.ok(doc.materials[0].pbrMetallicRoughness.roughnessFactor >= 0.65);
    assert.equal(doc.materials[0].pbrMetallicRoughness.metallicFactor, 0);
    assert.ok(Math.abs(facts.bounds.max[2] - 0.06) < 0.0001, 'interior wall plane stays fixed');
    const placed = new Box3(new Vector3(...facts.bounds.min), new Vector3(...facts.bounds.max))
      .applyMatrix4(new Matrix4().makeRotationY(KITCHEN_ROTATION[id] ?? 0))
      .translate(new Vector3(...KITCHEN_PLACEMENT[id]));
    assert.ok(Math.abs(placed.max.y - 3.5) < 0.0001);
    assert.ok(Math.abs(placed.min.y) < 0.0001);
    if (id === 'left-wall')
      assert.ok(Math.abs(placed.min.x + 2.6) < 0.0003, 'outside left plane flush with floor');
    else assert.ok(Math.abs(placed.min.z + 2.1) < 0.0003, 'outside rear plane flush with floor');
  }
});
