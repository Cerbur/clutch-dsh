import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import process from 'node:process';
import * as T from 'three';
import { ASSET_RULES, validateAsset } from '../scripts/sync-asset.mjs';
import { assertCurrentKitchenSources } from '../lib/client/scene/baked-lighting.js';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  kitchenAssetName,
} from '../lib/office/kitchen-layout.js';

// Pins belong to the four user-supplied originals, not generated delivery bytes.
const components = [
  [
    'spice-rack',
    '20261029155104_74696ecf.glb',
    '33ee71fb2a0ff49c3cc52429686140f19cb55347c597ec5dc54ba1bb432959ed',
    25000,
  ],
  [
    'open-cubby',
    '20261029153007_cd2bc74b.glb',
    '55b36206f2c05d27187b519755a682414288151cb5c84845ebdf418fd10aaa48',
    10000,
  ],
  [
    'black-utensil-rail',
    '20261029153103_de0c2698.glb',
    '27a88a0e86d172f2f547ef2488ff3d8ae6cc04410deb239cea91e6ec8ddb082d',
    15000,
  ],
  [
    'wall-storage-box',
    '20261029134813_d5ca8d38.glb',
    '15ab234bc5ec9ba5febe5f3c391a3a836abc5187704a236a587412e5babe1d99',
    15000,
  ],
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function asset(id) {
  const name = kitchenAssetName(id);
  const base = new URL(`../assets/models/kitchen/${name}`, import.meta.url);
  return {
    bytes: await readFile(new URL(base.href + '.glb')),
    manifest: JSON.parse(await readFile(new URL(base.href + '.manifest.json'))),
  };
}
function transform(id) {
  return new T.Matrix4().compose(
    new T.Vector3(...KITCHEN_PLACEMENT[id]),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), KITCHEN_ROTATION[id] ?? 0),
    new T.Vector3(...(KITCHEN_SCALE[id] ?? [1, 1, 1])),
  );
}
async function worldBox(id) {
  const { manifest } = await asset(id);
  return new T.Box3(
    new T.Vector3(...manifest.bounds.min),
    new T.Vector3(...manifest.bounds.max),
  ).applyMatrix4(transform(id));
}

for (const [id, , sourceHash, ceiling] of components) {
  test(`${id} retains its original identity and independent static delivery contract`, async () => {
    const { bytes, manifest } = await asset(id);
    const facts = validateAsset(manifest, bytes);
    const expectedNodes = [
      id,
      id.replaceAll('-', '_') + '_mesh',
      'wall_anchor',
      'front_anchor',
      'hang_anchor',
    ];
    assert.equal(manifest.revision, '2026-10-29-r1');
    assert.equal(manifest.source.inputSha256, sourceHash);
    assert.equal(manifest.sha256, sha(bytes));
    assert.equal(manifest.bytes, bytes.length);
    assert.equal(manifest.coordinates.origin, 'wall-plane-bottom-center');
    assert.equal(facts.meshes, 1);
    assert.equal(facts.primitives, 1);
    assert.equal(facts.materials, 1);
    assert.equal(facts.images, 3);
    assert.ok(facts.triangles > 0 && facts.triangles <= ceiling);
    assert.ok(bytes.length <= 4 * 1024 * 1024);
    assert.equal(ASSET_RULES[`kitchen/${id}`].triangles, ceiling);
    assert.equal(ASSET_RULES[`kitchen/${id}`].bytes, 4 * 1024 * 1024);
    for (const name of expectedNodes) assert.ok(facts.nodes.includes(name), name);
    for (const name of ['wall_anchor', 'front_anchor', 'hang_anchor']) {
      assert.ok(Array.isArray(manifest.anchors[name]), name + ' is declared');
      assert.equal(manifest.anchors[name].length, 3);
    }
    assert.ok(Math.abs(facts.bounds.min[1]) < 1e-4, 'authored bottom stays at Y0');
    assert.ok(Math.abs(facts.bounds.min[2]) < 1e-4, 'rear envelope stays at wall plane Z0');
    const jsonLength = bytes.readUInt32LE(12);
    const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength));
    const binaryStart = 20 + jsonLength + 8;
    assert.equal(doc.buffers.length, 1);
    assert.equal(doc.buffers[0].uri, undefined);
    for (const image of doc.images) {
      assert.equal(image.uri, undefined);
      assert.equal(image.mimeType, 'image/png');
      const view = doc.bufferViews[image.bufferView];
      assert.equal(view.buffer, 0);
      const start = binaryStart + (view.byteOffset ?? 0);
      assert.ok(start + view.byteLength <= bytes.length);
      const png = bytes.subarray(start, start + view.byteLength);
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(png.toString('ascii', 12, 16), 'IHDR');
      assert.equal(png.readUInt32BE(16), 1024);
      assert.equal(png.readUInt32BE(20), 1024);
    }
    assert.equal(ASSET_RULES['kitchen/refrigerator'].triangles, 30000);
    assert.equal(ASSET_RULES['kitchen/refrigerator'].bytes, 8 * 1024 * 1024);
  });
}

// Library integration is opt-in on other machines; local acceptance must run with
// OFFICE_ASSET_LIBRARY=/Users/yuancheng/Documents/blender/office. Missing files
// under a configured root fail normally and are never replaced by fixtures.
for (const [id, originalName, sourceHash] of components) {
  test(
    `${id} matches the immutable library delivery and archived user original`,
    {
      skip: process.env.OFFICE_ASSET_LIBRARY
        ? false
        : 'set OFFICE_ASSET_LIBRARY for library acceptance',
    },
    async () => {
      const library = resolve(process.env.OFFICE_ASSET_LIBRARY);
      const { manifest, bytes } = await asset(id);
      const directory = resolve(library, 'kitchen', id);
      const sourcePath = resolve(library, manifest.source.input);
      assert.ok(
        sourcePath.startsWith(resolve(directory, 'source') + sep),
        'source metadata stays in its component source directory',
      );
      const original = await readFile(sourcePath);
      assert.equal(sha(original), sourceHash, originalName);
      assert.equal(manifest.source.inputSha256, sha(original));
      assert.equal(manifest.source.inputBytes, original.length);
      const deliveryRoot = resolve(directory, 'deliveries', manifest.revision);
      const delivered = JSON.parse(await readFile(resolve(deliveryRoot, 'manifest.json')));
      // syncAsset serializes the manifest; JSON treats -0 and 0 identically.
      assert.deepEqual(JSON.parse(JSON.stringify(delivered)), manifest);
      assert.deepEqual(await readFile(resolve(deliveryRoot, manifest.file)), bytes);
    },
  );
}

test('production lightmap requires all four decor sources and their baked geometry', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../assets/lighting/kitchen/manifest.json', import.meta.url)),
  );
  assertCurrentKitchenSources(manifest);
  for (const [id] of components) {
    const { bytes } = await asset(id);
    const source = manifest.sources.find((item) => item.id === id);
    assert.equal(source?.assetId, `kitchen/${id}`);
    assert.equal(source.sha256, sha(bytes));
    assert.ok(manifest.instances[id]?.length > 0, id + ' participates in occlusion/bounce');
    const missingSource = structuredClone(manifest);
    missingSource.sources = missingSource.sources.filter((item) => item.id !== id);
    const missingGeometry = structuredClone(manifest);
    delete missingGeometry.instances[id];
    const wrongIdentity = structuredClone(manifest);
    wrongIdentity.sources.find((item) => item.id === id).assetId = 'kitchen/refrigerator';
    for (const encode of [
      (value) => value,
      (value) => JSON.stringify(value),
      (value) => Buffer.from(JSON.stringify(value)).toString('base64'),
    ]) {
      assert.throws(
        () => assertCurrentKitchenSources(encode(missingSource)),
        /incomplete current kitchen source set/,
        id,
      );
      assert.throws(
        () => assertCurrentKitchenSources(encode(missingGeometry)),
        /incomplete current kitchen source set/,
        id,
      );
      assert.throws(
        () => assertCurrentKitchenSources(encode(wrongIdentity)),
        /identity mismatch/,
        id,
      );
    }
  }
});

test('new wall storage avoids burner and hood columns and uses usable wall zones', async () => {
  const stove = await worldBox('stove');
  const hood = await worldBox('range-hood');
  const heatColumn = hood.clone();
  heatColumn.min.y = stove.min.y;
  heatColumn.max.y = 3.5;
  heatColumn.min.x = Math.min(stove.min.x, hood.min.x);
  heatColumn.max.x = Math.max(stove.max.x, hood.max.x);
  const { manifest: stoveManifest } = await asset('stove');
  for (const name of ['burner_left', 'burner_right']) {
    assert.ok(
      heatColumn.containsPoint(
        new T.Vector3(...stoveManifest.anchors[name]).applyMatrix4(transform('stove')),
      ),
      name + ' stays within the prohibited heat column',
    );
  }
  assert.equal(
    (await worldBox('utensil-rail')).intersectsBox(heatColumn),
    false,
    'resized orange rail stays behind the hob in the preparation zone',
  );
  const leftWall = await worldBox('left-wall');
  const rearWall = await worldBox('right-wall');
  const boxes = new Map();
  for (const [id] of components) {
    const box = await worldBox(id);
    boxes.set(id, box);
    assert.equal(box.intersectsBox(heatColumn), false, id + ' avoids heat');
    assert.ok(box.min.y > 1 && box.max.y < 3.5, id + ' is wall mounted above the counter');
    assert.ok(
      box.min.x > leftWall.max.x && box.max.x < 2.5 && box.min.z > rearWall.max.z && box.max.z < 3,
      id + ' stays inside the room',
    );
    const root = new T.Vector3(...KITCHEN_PLACEMENT[id]);
    if (id === 'wall-storage-box') {
      assert.equal(KITCHEN_ROTATION[id] ?? 0, 0);
      assert.ok(root.z > rearWall.max.z && root.z - rearWall.max.z < 0.03);
    } else {
      assert.equal(KITCHEN_ROTATION[id], Math.PI / 2);
      assert.ok(root.x > leftWall.max.x && root.x - leftWall.max.x < 0.03);
    }
  }
  const rail = boxes.get('black-utensil-rail');
  const spice = boxes.get('spice-rack');
  assert.ok(rail.max.y <= 2.05, 'utensil hooks remain within ordinary reach');
  assert.ok(rail.max.y < spice.min.y, 'spice shelf clears the hanging utensils');
  assert.ok(
    rail.min.z < spice.max.z && spice.min.z < rail.max.z,
    'shelf and hooks share the cart-side wall column',
  );
  const cart = await worldBox('storage-cabinet');
  // Lower utensils can hang beside the cart's tallest plant. The transformed
  // triangle test in kitchen-assets checks actual surfaces; their aggregate
  // boxes need not be vertically disjoint.
  assert.ok(rail.max.y > cart.max.y, 'the upper hook rod clears the cart contents');
  assert.ok(
    rail.min.z < cart.max.z && cart.min.z < rail.max.z,
    'hooks are accessible above the cart',
  );
  const blue = await worldBox('wall-cabinet');
  const cubby = boxes.get('open-cubby');
  assert.ok(
    Math.abs(cubby.max.y - blue.max.y) < 0.12,
    'low-frequency open storage aligns with the upper cabinet',
  );
  assert.ok(cubby.min.z > blue.max.z, 'cubby sits beside the blue cabinet');
  const box = boxes.get('wall-storage-box');
  assert.ok(box.max.y <= 2.05, 'small wall box remains reachable');
  assert.equal(box.intersectsBox(await worldBox('refrigerator')), false, 'box clears the fridge');
  assert.equal(
    box.intersectsBox(await worldBox('wall-shelf')),
    false,
    'box clears the double shelf',
  );
  const calendar = await worldBox('wall-calendar');
  const plant = await worldBox('wall-plant-right');
  assert.ok(calendar.max.y < box.min.y, 'small box clears the calendar below');
  assert.ok(box.max.y < plant.min.y, 'small box clears the raised planter above');
  for (const neighbor of [calendar, plant])
    assert.ok(
      box.min.x < neighbor.max.x && box.max.x > neighbor.min.x,
      'box, calendar and planter share the right-hand wall column',
    );
});
