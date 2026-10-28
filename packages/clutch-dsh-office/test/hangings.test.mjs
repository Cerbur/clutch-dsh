import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as T from 'three';
import { validateAsset, syncAsset, ASSET_RULES } from '../scripts/sync-asset.mjs';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  kitchenAssetName,
} from '../lib/office/kitchen-layout.js';

const ids = [
  'whale-mitt',
  'wall-clock',
  'board-cloth',
  'wall-plant-left',
  'wall-plant-right',
  'wall-calendar',
];
async function asset(id) {
  const name = kitchenAssetName(id);
  const m = JSON.parse(
    await readFile(new URL(`../assets/models/kitchen/${name}.manifest.json`, import.meta.url)),
  );
  const bytes = await readFile(new URL(`../assets/models/kitchen/${name}.glb`, import.meta.url));
  return { m, bytes };
}
function worldBox(id, m) {
  return new T.Box3(new T.Vector3(...m.bounds.min), new T.Vector3(...m.bounds.max)).applyMatrix4(
    new T.Matrix4().compose(
      new T.Vector3(...KITCHEN_PLACEMENT[id]),
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), KITCHEN_ROTATION[id] ?? 0),
      new T.Vector3(...(KITCHEN_SCALE[id] ?? [1, 1, 1])),
    ),
  );
}
test('W01-W05 remain independent bounded wall assets without relaxing the refrigerator contract', async () => {
  for (const id of new Set(ids.map(kitchenAssetName))) {
    const { m, bytes } = await asset(id);
    const facts = validateAsset(m, bytes);
    assert.equal(m.assetId, `kitchen/${id}`);
    assert.equal(m.coordinates.origin, 'wall-plane-bottom-center');
    assert.equal(facts.meshes, 1);
    assert.equal(facts.primitives, 1);
    assert.equal(facts.materials, 1);
    assert.ok(facts.images <= 3);
    assert.ok(bytes.length < 3 * 1024 * 1024);
    assert.ok(Math.abs(facts.bounds.min[1]) < 1e-4 && Math.abs(facts.bounds.min[2]) < 1e-4);
    const directory = await mkdtemp(join(tmpdir(), 'office-hangings-'));
    try {
      await writeFile(join(directory, 'manifest.json'), JSON.stringify(m));
      await writeFile(join(directory, m.file), bytes);
      await syncAsset(join(directory, 'manifest.json'), join(directory, 'adopted'));
      assert.deepEqual(await readFile(join(directory, 'adopted', m.file)), bytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    assert.throws(() => validateAsset({ ...m, file: 'refrigerator.glb' }, bytes), /contract/);
    assert.throws(
      () =>
        validateAsset({ ...m, coordinates: { ...m.coordinates, origin: 'floor-center' } }, bytes),
      /contract/,
    );
  }
  assert.equal(ASSET_RULES['kitchen/refrigerator'].triangles, 30000);
  assert.equal(ASSET_RULES['kitchen/refrigerator'].bytes, 8 * 1024 * 1024);
});
test('new wall decorations stay out of the complete stove run and hood heat column', async () => {
  const stove = worldBox('stove', (await asset('stove')).m);
  const hood = worldBox('range-hood', (await asset('range-hood')).m);
  for (const id of ids) {
    const box = worldBox(id, (await asset(id)).m);
    assert.ok(box.min.y > 1.3 && box.max.y < 3.5, id + ' fits wall height');
    assert.ok(
      box.min.x > -2.315 && box.max.x < 2.5 && box.min.z > -1.815 && box.max.z < 3,
      id + ' inside room',
    );
    if (KITCHEN_ROTATION[id] === Math.PI / 2)
      assert.ok(
        box.min.z > stove.max.z + 0.05 || box.max.z < stove.min.z - 0.05,
        id + ' avoids entire stove run, not just flames',
      );
    const heatColumn = new T.Box3(
      new T.Vector3(hood.min.x, 0, hood.min.z),
      new T.Vector3(hood.max.x, 3.5, hood.max.z),
    );
    assert.equal(box.intersectsBox(heatColumn), false, id + ' avoids hood heat column');
  }
  assert.equal(kitchenAssetName('wall-plant-left'), 'wall-plant');
  assert.equal(kitchenAssetName('wall-plant-right'), 'wall-plant');
  assert.equal(KITCHEN_ROTATION['wall-plant-left'], Math.PI / 2);
  assert.equal(KITCHEN_ROTATION['wall-plant-right'] ?? 0, 0);
});

test('the production bake boundary rejects a missing or incorrectly aliased repeated plant', async () => {
  const { assertCurrentKitchenSources } = await import('../lib/client/scene/baked-lighting.js');
  const manifest = JSON.parse(
    await readFile(new URL('../assets/lighting/kitchen/manifest.json', import.meta.url)),
  );
  assertCurrentKitchenSources(manifest);
  assert.deepEqual(
    assertCurrentKitchenSources(Buffer.from(JSON.stringify(manifest)).toString('base64')),
    manifest,
  );
  assert.deepEqual(assertCurrentKitchenSources(JSON.stringify(manifest)), manifest);
  const missing = structuredClone(manifest);
  missing.sources = missing.sources.filter((v) => v.id !== 'wall-plant-right');
  delete missing.instances['wall-plant-right'];
  assert.throws(
    () => assertCurrentKitchenSources(missing),
    /incomplete current kitchen source set/,
  );
  const wrong = structuredClone(manifest);
  wrong.sources.find((v) => v.id === 'wall-plant-right').assetId = 'kitchen/refrigerator';
  assert.throws(() => assertCurrentKitchenSources(wrong), /identity mismatch/);
});
