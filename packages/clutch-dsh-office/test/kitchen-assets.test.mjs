import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateAsset, syncAsset } from '../scripts/sync-asset.mjs';
import { bundledAsset } from '../lib/client/scene/kitchen/asset.js';
import { Models } from '../lib/client/scene/models.js';
import { createCharacterAnimation } from '../lib/client/scene/character/animation.js';
import {
  KITCHEN_PLACEMENT,
  kitchenActorGroundY,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  KITCHEN_INSTANCE_GROUPS,
  kitchenFacing,
} from '../lib/office/kitchen-layout.js';
import { planAction } from '../lib/office/actions.js';
import { createKitchenMotion, advanceKitchenMotion } from '../lib/office/kitchen-motion.js';

export const kitchenRouteAudit = {
  deltas: [1 / 60, 1 / 30, 0.06],
  activities: ['working', 'editing', 'waiting', 'idle', 'searching', 'unknown'],
  seats: [0, 1],
  routes: 0,
  interruptions: 0,
  repeatedInterruptions: 0,
  reducedTargets: 0,
  poseChecks: 0,
  phases: {},
};

async function delivery(name) {
  const base = new URL(`../assets/models/kitchen/${name}`, import.meta.url);
  return {
    bytes: await readFile(new URL(base.href + '.glb')),
    manifest: JSON.parse(await readFile(new URL(base.href + '.manifest.json'))),
  };
}

for (const name of [
  'floor',
  'table',
  'storage-cabinet',
  'sink-cabinet',
  'left-wall',
  'right-wall',
  'pendant-light',
  'utensil-rail',
  'stove',
  'wall-cabinet',
  'range-hood',
  'wall-shelf',
  'wall-art',
  'window',
  'whale-mitt',
  'wall-clock',
  'board-cloth',
  'wall-calendar',
  'spice-rack',
  'open-cubby',
  'black-utensil-rail',
  'wall-storage-box',
  'chair',
  'rug',
  'floor-mat',
  'trash-can',
]) {
  test(`${name} imports under its own filename and preserves the refrigerator`, async () => {
    const { bytes, manifest } = await delivery(name);
    const output = await mkdtemp(join(tmpdir(), 'office-components-'));
    try {
      await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(join(output, manifest.file), bytes);
      await mkdir(join(output, 'adopted'));
      await writeFile(join(output, 'adopted', 'refrigerator.glb'), 'existing refrigerator');
      const result = await syncAsset(join(output, 'manifest.json'), join(output, 'adopted'));
      assert.equal(result.assetId, `kitchen/${name}`);
      assert.deepEqual(await readFile(join(output, 'adopted', manifest.file)), bytes);
      assert.equal(
        await readFile(join(output, 'adopted', 'refrigerator.glb'), 'utf8'),
        'existing refrigerator',
      );
      assert.deepEqual(
        JSON.parse(await readFile(join(output, 'adopted', `${name}.manifest.json`))),
        manifest,
      );
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });
}

test('component budgets, metric dimensions, anchors and semantic nodes are not interchangeable', async () => {
  const { manifest, bytes } = await delivery('table');
  const table = validateAsset(manifest, bytes);
  assert.ok(table.triangles > 30000 && table.triangles < 60000);
  assert.throws(
    () =>
      validateAsset(
        {
          ...manifest,
          assetId: 'kitchen/refrigerator',
          file: 'refrigerator.glb',
          budget: { triangles: 90000 },
        },
        bytes,
      ),
    /refrigerator budget/,
  );
  assert.throws(
    () => validateAsset({ ...manifest, dimensions: { ...manifest.dimensions, height: 1 } }, bytes),
    /dimensions.height/,
  );
  assert.throws(
    () => validateAsset({ ...manifest, anchors: { prep_anchor: [0, 0, 0] } }, bytes),
    /anchor/,
  );
  assert.throws(
    () => validateAsset({ ...manifest, requiredNodes: ['missing-node'] }, bytes),
    /Missing required node/,
  );
  assert.throws(
    () => validateAsset({ ...manifest, coordinates: { ...manifest.coordinates, up: '+Z' } }, bytes),
    /contract/,
  );
  const cabinet = await delivery('storage-cabinet');
  const facts = validateAsset(cabinet.manifest, cabinet.bytes);
  if (cabinet.manifest.requiredNodes.includes('置物柜_用户原件静态总成')) {
    assert.equal(cabinet.manifest.wheelPivots?.length ?? 0, 0);
    assert.equal(facts.meshes, 1);
    assert.equal(facts.primitives, 1);
    assert.ok(facts.nodes.includes('置物柜_用户原件静态总成'));
  } else {
    assert.ok(cabinet.manifest.wheelPivots.every(({ node }) => facts.nodes.includes(node)));
    assert.equal(cabinet.manifest.wheelPivots.length, 4);
  }
});

// No DOM bitmap decoder is available in Node. Strip only material/image references
// from an in-memory copy; browser acceptance separately verifies the real textures.
function geometryOnly(bytes) {
  const jsonSize = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonSize));
  delete doc.materials;
  delete doc.images;
  delete doc.textures;
  delete doc.samplers;
  for (const mesh of doc.meshes) for (const p of mesh.primitives) delete p.material;
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = bytes.subarray(20 + jsonSize);
  const result = Buffer.alloc(20 + padded.length + binary.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  binary.copy(result, 20 + padded.length);
  return result;
}

test('GLTF runtime keeps original scale, table anchors and independent wheel pivots', async () => {
  for (const name of [
    'table',
    'storage-cabinet',
    'sink-cabinet',
    'left-wall',
    'pendant-light',
    'utensil-rail',
    'stove',
    'wall-cabinet',
    'range-hood',
    'wall-shelf',
    'wall-art',
    'window',
    'whale-mitt',
    'wall-clock',
    'board-cloth',
    'wall-calendar',
    'spice-rack',
    'open-cubby',
    'black-utensil-rail',
    'wall-storage-box',
    'chair',
    'rug',
    'floor-mat',
    'trash-can',
  ]) {
    const { bytes, manifest } = await delivery(name);
    let ready;
    const loaded = new Promise((resolve) => {
      ready = resolve;
    });
    const owner = new Models(() => ready());
    const root = bundledAsset(name, geometryOnly(bytes).toString('base64'))(owner, new T.Group());
    await loaded;
    assert.equal(root.userData.assetState, 'ready');
    assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
    const bounds = new T.Box3().setFromObject(root);
    for (const side of ['min', 'max'])
      bounds[side]
        .toArray()
        .forEach((value, i) => assert.ok(Math.abs(value - manifest.bounds[side][i]) < 1e-4));
    for (const node of manifest.requiredNodes) assert.ok(root.getObjectByName(node), node);
    if (name === 'table') {
      for (const [node, position] of Object.entries(manifest.anchors)) {
        const actual = root.getObjectByName(node).getWorldPosition(new T.Vector3());
        assert.ok(actual.distanceTo(new T.Vector3(...position)) < 1e-4);
      }
    } else if (name === 'storage-cabinet') {
      if (manifest.requiredNodes.includes('置物柜_用户原件静态总成')) {
        const assembly = root.getObjectByName('置物柜_用户原件静态总成');
        assert.ok(assembly?.isMesh);
        assert.ok(assembly.geometry.groups.length <= 1);
        assert.equal(manifest.wheelPivots?.length ?? 0, 0);
        for (const node of [
          '柜架与层板',
          '下层收纳筐与食材',
          '中层蔬菜托盘',
          '台面调料与盆栽',
          '脚轮_左前',
          '脚轮_左后',
          '脚轮_右前',
          '脚轮_右后',
        ])
          assert.equal(root.getObjectByName(node), undefined, node);
      } else {
        const frame = root.getObjectByName('柜架与层板');
        root.updateMatrixWorld(true);
        const original = frame.matrixWorld.clone();
        for (const pivot of manifest.wheelPivots) {
          const wheel = root.getObjectByName(pivot.node);
          const initial = wheel.matrixWorld.clone();
          wheel.rotateZ(0.5);
          root.updateMatrixWorld(true);
          assert.equal(initial.equals(wheel.matrixWorld), false);
          assert.equal(original.equals(frame.matrixWorld), true);
        }
      }
    } else if (name === 'sink-cabinet') {
      if (manifest.requiredNodes.includes('水槽柜静态总成')) {
        const assembly = root.getObjectByName('水槽柜静态总成');
        assert.ok(assembly?.isMesh);
        assert.equal(assembly.geometry.groups.length <= 1, true);
        for (const node of ['左柜门', '右柜门', '侧柜门', '抽屉'])
          assert.equal(root.getObjectByName(node), undefined, node);
      } else {
        root.updateMatrixWorld(true);
        const fixed = root.getObjectByName('台面与挡水板').matrixWorld.clone();
        for (const node of ['左柜门', '右柜门', '侧柜门']) {
          const door = root.getObjectByName(node);
          const pivot = door.getWorldPosition(new T.Vector3());
          door.rotateY(0.3);
          root.updateMatrixWorld(true);
          assert.ok(door.getWorldPosition(new T.Vector3()).distanceTo(pivot) < 1e-5);
          assert.equal(fixed.equals(root.getObjectByName('台面与挡水板').matrixWorld), true);
        }
        const drawer = root.getObjectByName('抽屉');
        const drawerStart = drawer.getWorldPosition(new T.Vector3());
        drawer.translateZ(0.23);
        root.updateMatrixWorld(true);
        assert.ok(drawer.getWorldPosition(new T.Vector3()).distanceTo(drawerStart) > 0.22);
        assert.equal(fixed.equals(root.getObjectByName('台面与挡水板').matrixWorld), true);
      }
    }
    owner.dispose();
  }
});

test('DeepSeek keeps feet origin, unit scale and anchors with an independent skeleton', async () => {
  const bytes = await readFile(new URL('../assets/models/character/deepseek.glb', import.meta.url));
  const manifest = JSON.parse(
    await readFile(new URL('../assets/models/character/deepseek.manifest.json', import.meta.url)),
  );
  let ready;
  const loaded = new Promise((resolve) => {
    ready = resolve;
  });
  const owner = new Models(() => ready());
  let loadedClips;
  const root = bundledAsset('deepseek', geometryOnly(bytes).toString('base64'), (_scene, clips) => {
    loadedClips = clips;
  })(owner, new T.Group());
  await loaded;
  assert.equal(root.userData.assetState, 'ready');
  assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
  for (const node of manifest.requiredNodes) {
    let found = root.getObjectByName(node);
    root.traverse((object) => {
      if (object.userData.name === node) found = object;
    });
    assert.ok(found, node);
  }
  for (const [node, position] of Object.entries(manifest.anchors)) {
    const actual = root.getObjectByName(node).getWorldPosition(new T.Vector3());
    assert.ok(actual.distanceTo(new T.Vector3(...position)) < 1e-4);
  }
  const size = new T.Box3().setFromObject(root).getSize(new T.Vector3());
  for (const [key, value] of Object.entries({ width: size.x, height: size.y, depth: size.z }))
    assert.ok(Math.abs(value - manifest.dimensions[key]) < 1e-4);
  assert.equal(manifest.capabilities.rigged, true);
  assert.deepEqual(manifest.capabilities.animationClips, ['Walk_InPlace', 'Blink']);
  assert.deepEqual(
    loadedClips.map((clip) => clip.name),
    ['Walk_InPlace', 'Blink'],
  );
  const skins = [];
  root.traverse((object) => {
    if (object.isSkinnedMesh) skins.push(object);
  });
  assert.equal(skins.length, 3);
  assert.ok(
    skins.every(
      (mesh) =>
        mesh.skeleton.bones.length === 31 && mesh.morphTargetDictionary.Blink_L !== undefined,
    ),
  );
  owner.dispose();
});

test('failed GLTF parsing leaves a drawable whitebox and schedules reduced-motion redraw', async () => {
  let ready;
  const loaded = new Promise((resolve) => {
    ready = resolve;
  });
  const owner = new Models(() => ready());
  const fallback = new T.Group();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const root = bundledAsset('table', Buffer.from('{}').toString('base64'))(owner, fallback);
    await loaded;
    assert.equal(root.userData.assetState, 'fallback');
    assert.ok(root.children.includes(fallback));
    owner.dispose();
  } finally {
    console.warn = warn;
  }
});

/** Narrow phase: a rotated character AABB includes empty corners around hair/tail. */
// Only this neutral-pose routing audit caches vertices; moving poses are sampled separately.
const neutralVertices = new WeakMap();
function characterIntersectsBox(root, box) {
  let hit = false;
  const triangle = new T.Triangle();
  root.traverse((node) => {
    if (hit || !node.isMesh) return;
    const position = node.geometry.getAttribute('position');
    const index = node.geometry.index;
    const count = index ? index.count : position.count;
    let fixed = neutralVertices.get(node);
    if (!fixed) {
      fixed = Array.from({ length: position.count }, (_, i) =>
        node.getVertexPosition(i, new T.Vector3()),
      );
      neutralVertices.set(node, fixed);
    }
    for (let i = 0; i < count && !hit; i += 3) {
      for (const [offset, point] of [
        [0, triangle.a],
        [1, triangle.b],
        [2, triangle.c],
      ])
        point
          .copy(fixed[index ? index.getX(i + offset) : i + offset])
          .applyMatrix4(node.matrixWorld);
      hit = box.intersectsTriangle(triangle);
    }
  });
  return hit;
}

// Triangle/triangle SAT includes in-plane edge normals so coplanar triangles
// receive the same exact separation check as noncoplanar surface crossings.
function trianglesIntersect(a, b) {
  const av = [a.a, a.b, a.c],
    bv = [b.a, b.b, b.c];
  const edges = (v) => [v[1].clone().sub(v[0]), v[2].clone().sub(v[1]), v[0].clone().sub(v[2])];
  const ae = edges(av),
    be = edges(bv);
  const an = new T.Vector3().crossVectors(ae[0], ae[1]);
  const bn = new T.Vector3().crossVectors(be[0], be[1]);
  const axes = [
    an,
    bn,
    ...ae.flatMap((x) => be.map((y) => new T.Vector3().crossVectors(x, y))),
    ...ae.map((x) => new T.Vector3().crossVectors(an, x)),
    ...be.map((x) => new T.Vector3().crossVectors(bn, x)),
  ];
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-24) continue;
    axis.normalize();
    const ap = av.map((v) => v.dot(axis)),
      bp = bv.map((v) => v.dot(axis));
    if (Math.max(...ap) < Math.min(...bp) - 1e-10 || Math.max(...bp) < Math.min(...ap) - 1e-10)
      return false;
  }
  return true;
}

function triangleTree(items) {
  const box = new T.Box3();
  for (const item of items) box.union(item.box);
  if (items.length <= 12) return { box, items };
  const size = box.getSize(new T.Vector3());
  const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
  items.sort((a, b) => a.center[axis] - b.center[axis]);
  const mid = Math.floor(items.length / 2);
  return { box, children: [triangleTree(items.slice(0, mid)), triangleTree(items.slice(mid))] };
}

function treesIntersect(a, b) {
  if (!a.box.intersectsBox(b.box)) return false;
  if (a.children) return a.children.some((child) => treesIntersect(child, b));
  if (b.children) return b.children.some((child) => treesIntersect(a, child));
  return a.items.some((x) =>
    b.items.some((y) => x.box.intersectsBox(y.box) && trianglesIntersect(x.triangle, y.triangle)),
  );
}

function furnitureTransform(name) {
  return new T.Matrix4().compose(
    new T.Vector3(...KITCHEN_PLACEMENT[name]),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), KITCHEN_ROTATION[name] ?? 0),
    new T.Vector3(...(KITCHEN_SCALE[name] ?? [1, 1, 1])),
  );
}

async function furnitureTriangles(bytes, matrix) {
  const stripped = geometryOnly(bytes);
  const { scene } = await new GLTFLoader().parseAsync(
    stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
    '',
  );
  scene.applyMatrix4(matrix);
  scene.updateMatrixWorld(true);
  const items = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const position = node.geometry.getAttribute('position'),
      index = node.geometry.index;
    const count = index ? index.count : position.count;
    for (let i = 0; i < count; i += 3) {
      const triangle = new T.Triangle();
      [triangle.a, triangle.b, triangle.c].forEach((point, j) =>
        point
          .fromBufferAttribute(position, index ? index.getX(i + j) : i + j)
          .applyMatrix4(node.matrixWorld),
      );
      const box = new T.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
      items.push({ triangle, box, center: box.getCenter(new T.Vector3()) });
    }
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material])
      material.dispose();
  });
  return items;
}

test('furniture triangle narrow phase rejects crossing and coplanar overlap but accepts separated surfaces', () => {
  const a = new T.Triangle(new T.Vector3(0, 0, 0), new T.Vector3(2, 0, 0), new T.Vector3(0, 2, 0));
  const cross = new T.Triangle(
    new T.Vector3(0.5, 0.5, -1),
    new T.Vector3(0.5, 0.5, 1),
    new T.Vector3(1, 0.5, 0),
  );
  assert.equal(trianglesIntersect(a, cross), true);
  assert.equal(
    trianglesIntersect(
      a,
      new T.Triangle(
        new T.Vector3(0.1, 0.1, 0),
        new T.Vector3(0.5, 0.1, 0),
        new T.Vector3(0.1, 0.5, 0),
      ),
    ),
    true,
  );
  const separate = new T.Triangle(
    new T.Vector3(1.5, 1.5, 0),
    new T.Vector3(2, 1.5, 0),
    new T.Vector3(1.5, 2, 0),
  );
  assert.equal(
    new T.Box3()
      .setFromPoints([a.a, a.b, a.c])
      .intersectsBox(new T.Box3().setFromPoints([separate.a, separate.b, separate.c])),
    true,
  );
  assert.equal(trianglesIntersect(a, separate), false);
  const item = (triangle) => {
    const box = new T.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
    return { triangle, box, center: box.getCenter(new T.Vector3()) };
  };
  assert.equal(treesIntersect(triangleTree([item(a)]), triangleTree([item(cross)])), true);
  assert.equal(treesIntersect(triangleTree([item(a)]), triangleTree([item(separate)])), false);
});
test('scene-only corner sink scale preserves the authored asset, vertical scale and floor contact', async () => {
  const { manifest, bytes } = await delivery('sink-cabinet');
  const facts = validateAsset(manifest, bytes);
  const matrix = furnitureTransform('sink-cabinet');
  const triangles = await furnitureTriangles(bytes, matrix);
  const actual = new T.Box3();
  for (const item of triangles) actual.union(item.box);
  const expected = new T.Box3(
    new T.Vector3(...facts.bounds.min),
    new T.Vector3(...facts.bounds.max),
  ).applyMatrix4(matrix);
  assert.ok(
    actual.min.distanceTo(expected.min) < 1e-7 && actual.max.distanceTo(expected.max) < 1e-7,
  );
  const size = actual.getSize(new T.Vector3());
  assert.ok(Math.abs(size.x - 3.08) < 1e-7);
  assert.ok(Math.abs(size.z - 0.8) < 1e-7);
  assert.equal(KITCHEN_SCALE['sink-cabinet'][1], 1);
  assert.ok(Math.abs(size.y - facts.dimensions.height) < 1e-7);
  assert.ok(Math.abs(actual.min.y - 0.025) < 1e-7);
  for (const [value, target] of [
    [actual.min.x, -2.29],
    [actual.max.x, 0.79],
    [actual.min.z, -1.8],
    [actual.max.z, -1],
  ])
    assert.ok(
      Math.abs(value - target) < 0.0001,
      'expanded sink follows the requested corner envelope',
    );
  const surface = new T.Vector3(...manifest.anchors.work_surface).applyMatrix4(matrix);
  assert.ok(
    Math.abs(surface.y - (0.9 + KITCHEN_PLACEMENT['sink-cabinet'][1])) < 1e-7,
    'keep authored countertop height above the grounded root',
  );
  assert.ok(
    Math.abs(facts.dimensions.width - 1.6499232649803162) < 1e-7,
    'original GLB width stays unchanged',
  );
  assert.ok(
    Math.abs(facts.dimensions.depth - 0.6502208113670349) < 1e-7,
    'original GLB depth stays unchanged',
  );
  kitchenRouteAudit.expandedSink = {
    scale: KITCHEN_SCALE['sink-cabinet'],
    position: KITCHEN_PLACEMENT['sink-cabinet'],
    bounds: { min: actual.min.toArray(), max: actual.max.toArray() },
    countertopY: surface.y,
  };
});

test('furniture and delivered actor activity transitions keep the aisle clear', async () => {
  const obstacles = [];
  for (const name of [
    'table',
    'storage-cabinet',
    'refrigerator',
    'sink-cabinet',
    'utensil-rail',
    'stove',
    'wall-cabinet',
    'range-hood',
    'trash-can',
    'wall-shelf',
    'wall-art',
    'window',
    'whale-mitt',
    'wall-clock',
    'board-cloth',
    'wall-calendar',
    'spice-rack',
    'open-cubby',
    'black-utensil-rail',
    'wall-storage-box',
    'floor-mat',
    'pendant-light',
  ]) {
    const { manifest, bytes } = await delivery(name);
    const facts = validateAsset(manifest, bytes);
    obstacles.push({
      name,
      bytes,
      box: new T.Box3(
        new T.Vector3(...facts.bounds.min),
        new T.Vector3(...facts.bounds.max),
      ).applyMatrix4(furnitureTransform(name)),
    });
  }
  // New seats stay in front of the table, outside all existing station routes.
  const plantDelivery = await delivery('wall-plant');
  const plantFacts = validateAsset(plantDelivery.manifest, plantDelivery.bytes);
  assert.deepEqual(KITCHEN_INSTANCE_GROUPS['wall-plants'], [
    'wall-plant-left',
    'wall-plant-right',
    'wall-plant-window-left',
    'wall-plant-window-middle',
    'wall-plant-window-right',
  ]);
  for (const name of KITCHEN_INSTANCE_GROUPS['wall-plants']) {
    obstacles.push({
      name,
      bytes: plantDelivery.bytes,
      box: new T.Box3(
        new T.Vector3(...plantFacts.bounds.min),
        new T.Vector3(...plantFacts.bounds.max),
      ).applyMatrix4(furnitureTransform(name)),
    });
  }
  const chairDelivery = await delivery('chair');
  const chairFacts = validateAsset(chairDelivery.manifest, chairDelivery.bytes);
  for (const name of ['chair-left', 'chair-right']) {
    obstacles.push({
      name,
      bytes: chairDelivery.bytes,
      box: new T.Box3(
        new T.Vector3(...chairFacts.bounds.min),
        new T.Vector3(...chairFacts.bounds.max),
      ).translate(new T.Vector3(...KITCHEN_PLACEMENT[name])),
    });
  }
  // The rug is a walkable decoration, placed outside the swept character bounds
  // so the current fixed foot-height system does not intersect its raised surface.
  const rugDelivery = await delivery('rug');
  const rugFacts = validateAsset(rugDelivery.manifest, rugDelivery.bytes);
  const rugBox = new T.Box3(
    new T.Vector3(...rugFacts.bounds.min),
    new T.Vector3(...rugFacts.bounds.max),
  ).translate(new T.Vector3(...KITCHEN_PLACEMENT.rug));
  obstacles.push({ name: 'rug', box: rugBox, bytes: rugDelivery.bytes });
  const triangleCache = new Map();
  const meshTriangles = async (obstacle) => {
    if (!triangleCache.has(obstacle.name))
      triangleCache.set(
        obstacle.name,
        await furnitureTriangles(obstacle.bytes, furnitureTransform(obstacle.name)),
      );
    return triangleCache.get(obstacle.name);
  };
  kitchenRouteAudit.furnitureBroadPhaseOverlaps = [];
  for (let i = 0; i < obstacles.length; i++)
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i],
        b = obstacles[j];
      if (!a.box.intersectsBox(b.box)) continue;
      const overlap = a.box.clone().intersect(b.box);
      const at = (await meshTriangles(a)).filter((item) => item.box.intersectsBox(overlap));
      const bt = (await meshTriangles(b)).filter((item) => item.box.intersectsBox(overlap));
      const intersects =
        at.length > 0 && bt.length > 0 && treesIntersect(triangleTree(at), triangleTree(bt));
      kitchenRouteAudit.furnitureBroadPhaseOverlaps.push({
        pair: [a.name, b.name],
        candidateTriangles: [at.length, bt.length],
        intersects,
      });
      assert.equal(intersects, false, `${a.name}/${b.name}: actual transformed triangle surfaces`);
    }
  for (const obstacle of obstacles) {
    assert.ok(obstacle.box.min.x > -2.315, `${obstacle.name} clears the left wall`);
    assert.ok(obstacle.box.min.z >= -1.8150001, `${obstacle.name} clears the rear wall`);
    assert.ok(obstacle.box.max.z < 3.1, `${obstacle.name} stays on the platform`);
  }
  const sink = obstacles.find(({ name }) => name === 'sink-cabinet').box;
  const refrigerator = obstacles.find(({ name }) => name === 'refrigerator').box;
  assert.ok(sink.max.x < refrigerator.min.x, 'sink and refrigerator keep their planned gap');
  assert.ok(
    refrigerator.min.x - sink.max.x > 0.05,
    'expanded corner sink retains the requested 5 cm refrigerator gap',
  );
  const { bytes: pendantBytes, manifest: pendantManifest } = await delivery('pendant-light');
  const pendantFacts = validateAsset(pendantManifest, pendantBytes);
  const pendantBox = new T.Box3(
    new T.Vector3(...pendantFacts.bounds.min),
    new T.Vector3(...pendantFacts.bounds.max),
  ).translate(new T.Vector3(...KITCHEN_PLACEMENT['pendant-light']));
  assert.equal(pendantBox.intersectsBox(refrigerator), false, 'pendant clears refrigerator topper');
  assert.ok(pendantBox.max.x < 2.5, 'pendant stays inside the room');
  const rail = obstacles.find(({ name }) => name === 'utensil-rail').box;
  assert.ok(rail.min.y > 1.04, 'utensils hang above the worktop');
  const leftWallManifest = (await delivery('left-wall')).manifest;
  const leftWall = new T.Box3(
    new T.Vector3(...leftWallManifest.bounds.min),
    new T.Vector3(...leftWallManifest.bounds.max),
  ).applyMatrix4(furnitureTransform('left-wall'));
  assert.ok(
    rail.min.x > leftWall.max.x && rail.min.x - leftWall.max.x < 0.03,
    'resized prep rail mounts stay just inside the actual left-wall surface',
  );
  const activities = kitchenRouteAudit.activities;
  const checkSnapshots = new Map();
  for (const seat of [0, 1]) {
    let ready;
    const loaded = new Promise((resolve) => {
      ready = resolve;
    });
    const owner = new Models(() => ready());
    const characterBytes = await readFile(
      new URL('../assets/models/character/deepseek.glb', import.meta.url),
    );
    const character = bundledAsset('deepseek', geometryOnly(characterBytes).toString('base64'))(
      owner,
      new T.Group(),
    );
    await loaded;
    assert.equal(character.userData.assetState, 'ready');
    const body = character.getObjectByName('body') ?? character.children[0];
    assert.ok(body);
    const baseY = body.position.y;
    const bodyMeshes = new Set();
    body.traverse((node) => {
      if (node.isMesh) bodyMeshes.add(node);
    });
    character.traverse((node) => {
      if (node.isMesh)
        assert.ok(
          bodyMeshes.has(node),
          'bounds translation requires every mesh to share the body bob',
        );
    });
    const rigged = [...bodyMeshes].some((node) => node.isSkinnedMesh);
    const baseGroundY = rigged ? 0.025 : 0.04;
    const boundsByYaw = new Map();
    const check = (state, elapsed, label, reduced = false) => {
      const groundY = kitchenActorGroundY(state.position, baseGroundY, rigged ? 0 : 0.012);
      kitchenRouteAudit.poseChecks++;
      kitchenRouteAudit.phases[state.phase] = (kitchenRouteAudit.phases[state.phase] ?? 0) + 1;
      const motion = reduced ? 0 : Math.sin(elapsed * (state.moving ? 10 : 3));
      const bob = rigged ? 0 : state.moving ? Math.abs(motion) * 0.045 : motion * 0.012;
      let cached = boundsByYaw.get(state.yaw);
      if (!cached) {
        character.position.set(0, 0, 0);
        character.rotation.y = state.yaw;
        body.position.y = baseY;
        character.updateMatrixWorld(true);
        cached = {
          broad: new T.Box3().setFromObject(character),
          precise: new T.Box3().setFromObject(character, true),
        };
        boundsByYaw.set(state.yaw, cached);
      }
      character.position.set(state.position[0], groundY, state.position[1]);
      character.rotation.y = state.yaw;
      body.position.y = baseY + bob;
      character.updateMatrixWorld(true);
      // Cache by the exact double yaw, with no rounding or angle bins. All meshes
      // share the same rigid translation, including the body bob verified above.
      const translation = new T.Vector3(state.position[0], groundY + bob, state.position[1]);
      const bounds = cached.broad.clone().translate(translation);
      const precise = cached.precise.clone().translate(translation);
      if (
        state.phase === 'turn' &&
        Math.abs(state.position[0] - 1.4) < 1e-8 &&
        Math.abs(state.position[1] + 0.18) < 1e-8
      ) {
        kitchenRouteAudit.doorTurnPoseChecks = (kitchenRouteAudit.doorTurnPoseChecks ?? 0) + 1;
        kitchenRouteAudit.doorTurnYawMin = Math.min(
          kitchenRouteAudit.doorTurnYawMin ?? Infinity,
          state.yaw,
        );
        kitchenRouteAudit.doorTurnYawMax = Math.max(
          kitchenRouteAudit.doorTurnYawMax ?? -Infinity,
          state.yaw,
        );
      }
      if (
        state.phase === 'idle' &&
        Math.abs(state.position[0] - 1.4) < 1e-8 &&
        Math.abs(state.position[1] + 0.18) < 1e-8 &&
        reduced
      ) {
        const fridge = obstacles.find(({ name }) => name === 'refrigerator').box;
        const table = obstacles.find(({ name }) => name === 'table').box;
        kitchenRouteAudit.doorFinalBounds = {
          min: precise.min.toArray(),
          max: precise.max.toArray(),
        };
        kitchenRouteAudit.doorFinalAabbGaps = {
          refrigerator: precise.min.z - fridge.max.z,
          table: table.min.z - precise.max.z,
        };
      }
      if (kitchenRouteAudit.poseChecks <= 16 || kitchenRouteAudit.poseChecks % 1024 === 0) {
        const reference = new T.Box3().setFromObject(character, true);
        assert.ok(
          reference.min.distanceTo(precise.min) < 1e-6 &&
            reference.max.distanceTo(precise.max) < 1e-6,
          `${label}: exact-yaw cache agrees with actual transformed vertices within Float32 skin-weight precision`,
        );
        kitchenRouteAudit.boundsReferenceChecks =
          (kitchenRouteAudit.boundsReferenceChecks ?? 0) + 1;
      }
      assert.ok(
        precise.min.x > -2.315 &&
          precise.max.x < 2.5 &&
          precise.min.z > -1.815 &&
          precise.max.z < 3,
        `${label}: actual mesh stays inside walls/floor ${JSON.stringify(precise)}`,
      );
      assert.ok(precise.min.y >= 0.025 - 1e-6, `${label}: feet stay above the delivered floor`);
      for (const obstacle of obstacles)
        assert.equal(
          bounds.intersectsBox(obstacle.box) &&
            precise.intersectsBox(obstacle.box) &&
            characterIntersectsBox(character, obstacle.box),
          false,
          `${label} ${state.phase} at ${state.position} yaw ${state.yaw}: ${obstacle.name}`,
        );
    };
    const step = (state, plan, delta, elapsed, label) => {
      const next = advanceKitchenMotion(state, plan, delta);
      const dx = next.position[0] - state.position[0],
        dz = next.position[1] - state.position[1];
      const distance = Math.hypot(dx, dz);
      assert.ok(distance <= 1.3 * delta + 1e-8, `${label}: metre/delta speed`);
      if (distance > 1e-8) {
        const alignment = (Math.sin(next.yaw) * dx + Math.cos(next.yaw) * dz) / distance;
        assert.ok(
          next.phase === 'retreat' ? alignment < -0.999999 : alignment > 0.999999,
          `${label}: face forward when walking; only prefix retreat walks backwards`,
        );
        assert.equal(next.yaw, state.yaw, `${label}: turn in place before moving`);
      }
      check(next, elapsed, label);
      return next;
    };
    const run = (initial, activity, delta, label, collect = false) => {
      const plan = planAction(activity, seat);
      let state = initial,
        settled = 0;
      const frames = [];
      check(state, 0, `${label} initial`);
      for (let frame = 0; frame < Math.ceil(30 / delta); frame++) {
        state = step(state, plan, delta, (frame + 1) * delta, `${label} frame ${frame}`);
        if (collect && state.phase !== 'idle') frames.push(state);
        settled = state.phase === 'idle' ? settled + delta : 0;
        if (settled >= 2.2) break;
      }
      assert.ok(settled >= 2.2, `${label}: converges including an idle bob cycle`);
      assert.deepEqual(state.position, plan.target, `${label}: final target`);
      assert.ok(
        Math.abs(
          Math.atan2(
            Math.sin(state.yaw - kitchenFacing(plan.station, seat)),
            Math.cos(state.yaw - kitchenFacing(plan.station, seat)),
          ),
        ) < 1e-8,
        `${label}: final facing`,
      );
      if (collect) {
        // Every authored straight/turn, inbound or outbound, is interrupted at its midpoint.
        const segments = new Map();
        for (const pose of frames) {
          const segment = `${pose.returning}:${pose.phase}:${JSON.stringify(pose.route[0])}`;
          if (!segments.has(segment)) segments.set(segment, []);
          segments.get(segment).push(pose);
        }
        for (const [segment, poses] of segments) {
          const pose = poses[Math.floor(poses.length / 2)];
          const signature = `${seat}:${delta}:${pose.destination}:${segment}:${JSON.stringify(pose.trail)}`;
          checkSnapshots.set(signature, { pose, delta, label });
        }
      }
      return state;
    };
    try {
      for (const delta of kitchenRouteAudit.deltas) {
        const settled = new Map();
        for (const to of activities) {
          settled.set(
            to,
            run(createKitchenMotion(seat), to, delta, `${seat} spawn->${to} dt ${delta}`, true),
          );
          kitchenRouteAudit.routes++;
        }
        for (const from of activities)
          for (const to of activities) {
            run(settled.get(from), to, delta, `${seat} ${from}->${to} dt ${delta}`, true);
            kitchenRouteAudit.routes++;
          }
        for (const initial of [createKitchenMotion(seat), ...settled.values()])
          for (const to of activities) {
            const plan = planAction(to, seat);
            const reduced = advanceKitchenMotion(initial, plan, 0, true);
            assert.deepEqual(
              reduced.position,
              plan.target,
              'reduced motion reaches the final target in one zero-delta call',
            );
            assert.equal(reduced.phase, 'idle');
            assert.equal(reduced.yaw, kitchenFacing(plan.station, seat));
            check(reduced, 0, `${seat} reduced ->${to}`, true);
            kitchenRouteAudit.reducedTargets++;
          }
      }
      for (const { pose, delta, label } of checkSnapshots.values()) {
        if (pose.seat !== seat) continue;
        for (const to of activities) {
          run(pose, to, delta, `${label} interrupted->${to}`);
          kitchenRouteAudit.interruptions++;
          const plan = planAction(to, seat);
          const reduced = advanceKitchenMotion(pose, plan, 0, true);
          assert.deepEqual(reduced.position, plan.target);
          assert.equal(reduced.yaw, kitchenFacing(plan.station, seat));
          assert.equal(reduced.phase, 'idle');
          check(reduced, 0, `${label} reduced interruption->${to}`, true);
          kitchenRouteAudit.reducedTargets++;
        }
        let state = pose;
        for (const to of activities)
          for (let frame = 0; frame < 7; frame++)
            state = step(
              state,
              planAction(to, seat),
              delta,
              frame * delta,
              `${label} repeated->${to}`,
            );
        run(state, 'searching', delta, `${label} latest destination wins`);
        kitchenRouteAudit.repeatedInterruptions++;
        const reduced = advanceKitchenMotion(pose, planAction('searching', seat), 0, true);
        check(reduced, 0, `${label} reduced interruption`, true);
        assert.deepEqual(reduced.position, planAction('searching', seat).target);
        // Re-enabling animation must return safely from the reduced-motion endpoint too.
        run(reduced, 'working', delta, `${label} reduced->animated cooking`);
        kitchenRouteAudit.reducedTargets++;
      }
    } finally {
      owner.dispose();
    }
  }
  assert.equal(kitchenRouteAudit.routes, 252, 'all activity pairs, spawn, seats and frame rates');
  assert.ok(kitchenRouteAudit.interruptions > 0 && kitchenRouteAudit.repeatedInterruptions > 0);
  assert.ok(kitchenRouteAudit.reducedTargets >= 252);
  assert.ok(kitchenRouteAudit.doorTurnYawMin <= Math.PI / 2 + 1e-8);
  assert.ok(kitchenRouteAudit.doorTurnYawMax >= Math.PI - 1e-8);
});

test('delivered animated gait clears current furniture during fridge travel, return, turns and interruption', async () => {
  const obstacles = [];
  for (const id of Object.keys(KITCHEN_PLACEMENT)) {
    if (['floor', 'left-wall', 'right-wall'].includes(id)) continue;
    const name = id.startsWith('wall-plant-')
      ? 'wall-plant'
      : id.startsWith('chair-')
        ? 'chair'
        : id;
    const { manifest } = await delivery(name);
    obstacles.push({
      name: id,
      box: new T.Box3(
        new T.Vector3(...manifest.bounds.min),
        new T.Vector3(...manifest.bounds.max),
      ).applyMatrix4(furnitureTransform(id)),
    });
  }
  const raw = geometryOnly(
    await readFile(new URL('../assets/models/character/deepseek.glb', import.meta.url)),
  );
  let checks = 0;
  const phases = new Set();
  for (const seat of [0, 1]) {
    const { scene, animations } = await new GLTFLoader().parseAsync(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      '',
    );
    const character = new T.Group();
    character.add(scene);
    const owner = new Models();
    owner.ownObject(character);
    const animation = createCharacterAnimation(scene, animations, () => 0);
    owner.onDispose(() => animation.dispose());
    let state = createKitchenMotion(seat);
    try {
      for (const activity of [
        'working',
        'searching',
        'editing',
        'searching',
        'working',
        'waiting',
        'idle',
      ]) {
        const plan = planAction(activity, seat);
        let settled = 0;
        for (let frame = 0; frame < 60 * 45; frame++) {
          const next = advanceKitchenMotion(state, plan, 1 / 60, false, animation.walkSpeed);
          const distance = Math.hypot(
            next.position[0] - state.position[0],
            next.position[1] - state.position[1],
          );
          animation.update(
            1 / 60,
            distance * 60 * (next.phase === 'retreat' ? -1 : 1),
            false,
            plan.pose === 'search' && next.phase === 'idle' && !next.returning,
          );
          state = next;
          phases.add(state.phase);
          if (frame % 9 === 0) {
            character.position.set(
              state.position[0],
              kitchenActorGroundY(state.position, 0.025),
              state.position[1],
            );
            character.rotation.y = state.yaw;
            character.updateMatrixWorld(true);
            scene.traverse((node) => {
              if (node.isSkinnedMesh) {
                node.boundingBox = null;
                node.boundingSphere = null;
                neutralVertices.delete(node);
              }
            });
            const bounds = new T.Box3().setFromObject(scene, true);
            assert.ok(
              bounds.min.y >= 0.025 - 1e-5,
              `animated sole ${bounds.min.y} at ${seat}/${activity}/${frame}/${state.phase}`,
            );
            assert.ok(
              bounds.min.x > -2.315 &&
                bounds.max.x < 2.5 &&
                bounds.min.z > -1.815 &&
                bounds.max.z < 3,
              'animated silhouette inside shell',
            );
            for (const obstacle of obstacles)
              assert.equal(
                bounds.intersectsBox(obstacle.box) && characterIntersectsBox(scene, obstacle.box),
                false,
                `${seat}/${activity}/${state.phase}: animated mesh vs ${obstacle.name}`,
              );
            checks++;
          }
          settled = state.phase === 'idle' ? settled + 1 / 60 : 0;
          // Interrupt one outbound journey to exercise the reverse prefix.
          if (
            activity === 'searching' &&
            state.moving &&
            frame > 100 &&
            phases.has('idle') &&
            !phases.has('interrupted')
          ) {
            phases.add('interrupted');
            break;
          }
          if (settled > (plan.pose === 'search' ? 5.2 : 0.25)) break;
        }
      }
    } finally {
      owner.dispose();
    }
  }
  assert.ok(checks > 300);
  assert.ok(phases.has('turn') && phases.has('walk') && phases.has('retreat'));
  console.log(
    'Animated kitchen route audit',
    JSON.stringify({ checks, sampleSeconds: 0.15, seats: 2, phases: [...phases] }),
  );
});

test('table stays near the right edge with both stools following its outward offset', async () => {
  const table = KITCHEN_PLACEMENT.table;
  assert.deepEqual(table.slice(0, 2), [1.45, 0]);
  assert.ok(Math.abs(table[2] - 1.15) < 1e-8);
  const { manifest, bytes } = await delivery('table');
  const facts = validateAsset(manifest, bytes);
  const rightGap = 2.5 - table[0] - facts.bounds.max[0];
  assert.ok(rightGap > 0.05 && rightGap < 0.15, 'keep a small right-hand floor margin');
  assert.ok(
    table[2] > KITCHEN_PLACEMENT.stove[2],
    'table retains its previously accepted outward placement',
  );
  assert.ok(Math.abs(table[2] - 0.15 - 1) < 1e-8, 'retain the requested total outward offset');
  for (const name of ['chair-left', 'chair-right']) {
    assert.ok(Math.abs(KITCHEN_PLACEMENT[name][2] - 2.03) < 1e-8);
    assert.ok(Math.abs(KITCHEN_PLACEMENT[name][2] - table[2] - 0.88) < 1e-8);
  }
});

test('four-session roaming aisle permits full turns of the actual face-blink-r2 silhouette', async () => {
  const { ROAM_POINTS, ROAM_SCALE } = await import('../lib/office/roaming.js');
  const obstacles = [];
  for (const id of Object.keys(KITCHEN_PLACEMENT)) {
    if (['floor', 'left-wall', 'right-wall'].includes(id)) continue;
    const name = id.startsWith('wall-plant-')
      ? 'wall-plant'
      : id.startsWith('chair-')
        ? 'chair'
        : id;
    const { manifest } = await delivery(name);
    obstacles.push({
      name: id,
      box: new T.Box3(
        new T.Vector3(...manifest.bounds.min),
        new T.Vector3(...manifest.bounds.max),
      ).applyMatrix4(furnitureTransform(id)),
    });
  }
  const raw = geometryOnly(
    await readFile(new URL('../assets/models/character/deepseek.glb', import.meta.url)),
  );
  const { scene } = await new GLTFLoader().parseAsync(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    '',
  );
  const character = new T.Group();
  character.add(scene);
  character.scale.setScalar(ROAM_SCALE);
  let checks = 0;
  const samples = [...ROAM_POINTS];
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [0, 4],
    [4, 5],
  ])
    for (const ratio of [0.25, 0.5, 0.75])
      samples.push([
        ROAM_POINTS[a][0] * (1 - ratio) + ROAM_POINTS[b][0] * ratio,
        ROAM_POINTS[a][1] * (1 - ratio) + ROAM_POINTS[b][1] * ratio,
      ]);
  for (const [x, z] of samples)
    for (let step = 0; step < 8; step++) {
      character.position.set(x, kitchenActorGroundY([x, z], 0.054), z);
      character.rotation.y = (step * Math.PI) / 4;
      character.updateMatrixWorld(true);
      const bounds = new T.Box3().setFromObject(scene, true);
      assert.ok(
        bounds.min.x > -2.315 && bounds.max.x < 2.5 && bounds.min.z > -1.815 && bounds.max.z < 3,
        `roaming silhouette inside room: ${x},${z},yaw${step} ${JSON.stringify(bounds)}`,
      );
      for (const obstacle of obstacles)
        assert.equal(
          bounds.intersectsBox(obstacle.box) && characterIntersectsBox(scene, obstacle.box),
          false,
          `roam ${x},${z},yaw${step} vs ${obstacle.name}`,
        );
      checks++;
    }
  assert.equal(checks, 168);
});
