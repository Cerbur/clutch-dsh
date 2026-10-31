import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateAsset } from '../scripts/sync-asset.mjs';
import { KITCHEN_PLACEMENT, KITCHEN_ROOM } from '../lib/office/kitchen-layout.js';

test('floor carries tangent normals on a rounded inset and preserves world contact height', async () => {
  const bytes = await readFile(new URL('../assets/models/kitchen/floor.glb', import.meta.url));
  const manifest = JSON.parse(
    await readFile(new URL('../assets/models/kitchen/floor.manifest.json', import.meta.url)),
  );
  const facts = validateAsset(manifest, bytes);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  const tileNode = doc.nodes.find((node) => node.name === '瓷砖地面');
  const primitive = doc.meshes[tileNode.mesh].primitives[0];
  assert.equal(
    doc.accessors[primitive.indices].count,
    52 * 3,
    'rounded silhouette uses52 fan triangles; tile joints remain baked',
  );
  const accessor = doc.accessors[primitive.attributes.POSITION];
  const view = doc.bufferViews[accessor.bufferView];
  const bin = 28 + bytes.readUInt32LE(12);
  const start = bin + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  for (let i = 0; i < accessor.count; i++) {
    const offset = start + i * (view.byteStride ?? 12);
    const x = bytes.readFloatLE(offset),
      z = bytes.readFloatLE(offset + 8);
    assert.ok(
      Math.abs(x) < 2.499 || Math.abs(z) < 2.499,
      'square corner is removed from actual surface geometry',
    );
  }
  assert.ok(primitive.attributes.TANGENT !== undefined);
  assert.ok(doc.materials[primitive.material].normalTexture);
  assert.ok(doc.materials[primitive.material].pbrMetallicRoughness.metallicRoughnessTexture);
  assert.equal(facts.materials, 2);
  assert.ok(facts.triangles < 5000);
  assert.ok(Math.abs(facts.bounds.min[1] + 0.26) < 0.0001);
  assert.ok(Math.abs(facts.nodePositions.floor_surface[1] - 0.025) < 0.0001);
  assert.deepEqual(KITCHEN_PLACEMENT.floor, [0, 0, KITCHEN_ROOM.centerZ]);
  assert.ok(Math.abs(facts.dimensions.width - 5.2) < 0.0001);
  assert.ok(Math.abs(facts.dimensions.depth - 5.2) < 0.0001);
});
