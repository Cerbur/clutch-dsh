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
  KITCHEN_INSTANCE_GROUPS,
  kitchenAssetName,
} from '../lib/office/kitchen-layout.js';

const ids = [
  'whale-mitt',
  'wall-clock',
  'board-cloth',
  ...KITCHEN_INSTANCE_GROUPS['wall-plants'],
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
function worldTransform(id) {
  return new T.Matrix4().compose(
    new T.Vector3(...KITCHEN_PLACEMENT[id]),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), KITCHEN_ROTATION[id] ?? 0),
    new T.Vector3(...(KITCHEN_SCALE[id] ?? [1, 1, 1])),
  );
}
function worldBox(id, m) {
  return new T.Box3(new T.Vector3(...m.bounds.min), new T.Vector3(...m.bounds.max)).applyMatrix4(
    worldTransform(id),
  );
}
function assertOutsideHotColumns(id, box, hoodColumn, burnerColumn) {
  assert.equal(box.intersectsBox(hoodColumn), false, id + ' avoids hood heat column');
  assert.equal(box.intersectsBox(burnerColumn), false, id + ' avoids burner heat column');
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
test('mitt, board and left planter use authorized prep walls while hood and burner columns stay clear', async () => {
  const stoveManifest = (await asset('stove')).m;
  const stove = worldBox('stove', stoveManifest);
  const hood = worldBox('range-hood', (await asset('range-hood')).m);
  const cabinet = worldBox('wall-cabinet', (await asset('wall-cabinet')).m);
  const sink = worldBox('sink-cabinet', (await asset('sink-cabinet')).m);
  const spice = worldBox('spice-rack', (await asset('spice-rack')).m);
  const worktopY = new T.Vector3(...stoveManifest.anchors.work_surface).applyMatrix4(
    worldTransform('stove'),
  ).y;
  const heatColumn = new T.Box3(
    new T.Vector3(hood.min.x, 0, hood.min.z),
    new T.Vector3(hood.max.x, 3.5, hood.max.z),
  );
  // Extend the hood's hot zone across the worktop depth, including both fire anchors.
  const burnerColumn = heatColumn.clone();
  burnerColumn.min.x = Math.min(stove.min.x, hood.min.x);
  burnerColumn.max.x = Math.max(stove.max.x, hood.max.x);
  for (const name of ['burner_left', 'burner_right'])
    assert.ok(
      burnerColumn.containsPoint(
        new T.Vector3(...stoveManifest.anchors[name]).applyMatrix4(worldTransform('stove')),
      ),
      name + ' remains covered by the forbidden hot zone',
    );
  for (const id of ids) {
    const box = worldBox(id, (await asset(id)).m);
    assert.ok(box.min.y > worktopY && box.max.y < 3.5, id + ' fits above the worktop');
    assert.ok(
      box.min.x > -2.315 && box.max.x < 2.5 && box.min.z > -1.815 && box.max.z < 3,
      id + ' inside room',
    );
    if (KITCHEN_ROTATION[id] === Math.PI / 2) {
      if (id === 'whale-mitt' || id === 'board-cloth') {
        if (id === 'whale-mitt')
          assert.ok(
            box.min.z > stove.min.z && box.max.z < stove.max.z,
            'mitt stays over the front non-fire preparation run',
          );
        assert.ok(box.max.y < cabinet.min.y, id + ' hangs below upper cabinet height');
        if (id === 'board-cloth') {
          assert.ok(
            box.min.z > cabinet.min.z && box.max.z < cabinet.max.z,
            'board and cloth hang under the blue cabinet',
          );
          assert.ok(
            box.min.z > Math.min(stove.min.z, sink.min.z) && box.max.z < hood.min.z,
            'board stays over the rear L-shaped preparation run, behind the hob',
          );
        }
      } else if (id === 'wall-plant-left') {
        assert.ok(
          box.min.z > hood.max.z + 0.05 && box.max.z < spice.min.z - 0.05,
          'left planter occupies the cool wall gap between hood and spice rack',
        );
        const mitt = worldBox('whale-mitt', (await asset('whale-mitt')).m);
        assert.ok(box.min.y > mitt.max.y, 'left planter clears the reachable mitt below');
      } else
        assert.ok(
          box.min.z > stove.max.z + 0.05 || box.max.z < stove.min.z - 0.05,
          id + ' avoids the entire stove run',
        );
    }
    assertOutsideHotColumns(id, box, heatColumn, burnerColumn);
  }
  // The new prep-wall permission must still reject foliage directly above either fire.
  const plant = worldBox('wall-plant-left', (await asset('wall-plant-left')).m);
  const center = plant.getCenter(new T.Vector3());
  for (const name of ['burner_left', 'burner_right']) {
    const fire = new T.Vector3(...stoveManifest.anchors[name]).applyMatrix4(
      worldTransform('stove'),
    );
    const aboveFire = plant
      .clone()
      .translate(new T.Vector3(fire.x - center.x, 0, fire.z - center.z));
    assert.throws(
      () =>
        assertOutsideHotColumns('left planter above ' + name, aboveFire, heatColumn, burnerColumn),
      /avoids (hood|burner) heat column/,
      name + ' cannot become a decorative plant zone',
    );
  }
  const calendar = worldBox('wall-calendar', (await asset('wall-calendar')).m);
  const rightPlant = worldBox('wall-plant-right', (await asset('wall-plant-right')).m);
  assert.ok(calendar.max.y < rightPlant.min.y, 'reachable calendar sits below the right-wall pot');
  assert.ok(
    calendar.min.x < rightPlant.max.x && calendar.max.x > rightPlant.min.x,
    'calendar stays in the same wall column as the right pot',
  );
  for (const id of KITCHEN_INSTANCE_GROUPS['wall-plants'])
    assert.equal(kitchenAssetName(id), 'wall-plant');
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
  for (const id of [
    'wall-plant-left',
    'wall-plant-right',
    'wall-plant-window-left',
    'wall-plant-window-middle',
    'wall-plant-window-right',
  ]) {
    assert.equal(manifest.sources.find((v) => v.id === id)?.assetId, 'kitchen/wall-plant', id);
    assert.ok(manifest.instances[id]?.length > 0, id + ' has baked source geometry');
    const missing = structuredClone(manifest);
    missing.sources = missing.sources.filter((v) => v.id !== id);
    delete missing.instances[id];
    const wrong = structuredClone(manifest);
    wrong.sources.find((v) => v.id === id).assetId = 'kitchen/refrigerator';
    for (const encode of [
      (value) => value,
      (value) => JSON.stringify(value),
      (value) => Buffer.from(JSON.stringify(value)).toString('base64'),
    ]) {
      assert.throws(
        () => assertCurrentKitchenSources(encode(missing)),
        /incomplete current kitchen source set/,
        id,
      );
      assert.throws(() => assertCurrentKitchenSources(encode(wrong)), /identity mismatch/, id);
    }
  }
});
