import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSET_RULES, validateAsset } from '../scripts/sync-asset.mjs';
import { Models } from '../lib/client/scene/models.js';
import { createKitchenPalette } from '../lib/client/scene/kitchen/shared.js';
import { KITCHEN_PLACEMENT } from '../lib/office/kitchen-layout.js';

// Match the Client's inline transport without requiring browser texture decoding.
const inlineHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.glb?inline')) {
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.glb?inline')) {
      const bytes = readFileSync(new URL(url.slice(0, -'?inline'.length)));
      return {
        format: 'module',
        source: `export default ${JSON.stringify(bytes.toString('base64'))};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const { buildWallShelf } = await import('../lib/client/scene/kitchen/wall-shelf.js');
const { buildWallArt } = await import('../lib/client/scene/kitchen/wall-art.js');
const { buildChairs } = await import('../lib/client/scene/kitchen/chair.js');
const { buildRug } = await import('../lib/client/scene/kitchen/rug.js');
const { buildWindow } = await import('../lib/client/scene/kitchen/window.js');
const { buildWhaleMitt } = await import('../lib/client/scene/kitchen/whale-mitt.js');
const { buildWallClock } = await import('../lib/client/scene/kitchen/wall-clock.js');
const { buildBoardCloth } = await import('../lib/client/scene/kitchen/board-cloth.js');
const { buildWallCalendar } = await import('../lib/client/scene/kitchen/wall-calendar.js');
const { buildWallPlants } = await import('../lib/client/scene/kitchen/wall-plant.js');
inlineHook.deregister();

const components = [
  ['wall-shelf', '2026-10-27-r3', buildWallShelf],
  ['wall-art', '2026-10-27-r1', buildWallArt],
  ['chair', '2026-10-27-r1', buildChairs],
  ['rug', '2026-10-27-r1', buildRug],
  ['window', '2026-10-28-r1', buildWindow],
  ['whale-mitt', 'new-static', buildWhaleMitt],
  ['wall-clock', 'new-static', buildWallClock],
  ['board-cloth', 'new-static', buildBoardCloth],
  ['wall-calendar', 'new-static', buildWallCalendar],
];

async function delivery(name) {
  const url = new URL(`../assets/models/kitchen/${name}`, import.meta.url);
  return {
    bytes: await readFile(new URL(url.href + '.glb')),
    manifest: JSON.parse(await readFile(new URL(url.href + '.manifest.json'))),
  };
}

function renameNode(bytes, name) {
  const size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size));
  doc.nodes.find((node) => node.name === name).name = 'missing-semantic-node';
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = bytes.subarray(20 + size);
  const result = Buffer.concat([bytes.subarray(0, 20), padded, binary]);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  return result;
}

for (const [name, revision] of components) {
  test(`${name} validates its adopted revision, origin, hard budget and semantic nodes`, async () => {
    const { bytes, manifest } = await delivery(name);
    assert.equal(
      manifest.revision,
      revision === 'new-static'
        ? '2026-10-28-r1'
        : name === 'window'
          ? '2026-10-28-candy-r2'
          : '2026-10-28-candy-r1',
    );
    if (revision !== 'new-static') assert.equal(manifest.style.parentRevision, revision);
    const facts = validateAsset(manifest, bytes);
    assert.equal(facts.assetId, `kitchen/${name}`);
    assert.equal(facts.primitives, 1);
    assert.equal(facts.materials, 1);
    assert.throws(
      () =>
        validateAsset(
          { ...manifest, coordinates: { ...manifest.coordinates, origin: 'wrong-origin' } },
          bytes,
        ),
      /contract/,
    );
    const rule = ASSET_RULES[manifest.assetId];
    // A delivery cannot relax the independent importer ceiling.
    const tightBudget = { triangles: facts.triangles - 1, bytes: rule.bytes * 2 };
    assert.throws(
      () => validateAsset({ ...manifest, budgets: tightBudget, budget: tightBudget }, bytes),
      /budget exceeded/,
    );
    for (const node of rule.nodes) {
      const changed = renameNode(bytes, node);
      const sha256 = createHash('sha256').update(changed).digest('hex');
      assert.throws(
        () =>
          validateAsset({ ...manifest, sha256, bytes: changed.length, requiredNodes: [] }, changed),
        /Missing required node/,
        node,
      );
    }
    const wrongFile = { ...manifest, file: 'refrigerator.glb' };
    assert.throws(() => validateAsset(wrongFile, bytes), /contract/);
  });
}

test('new components keep the existing refrigerator ceiling', async () => {
  const { bytes, manifest } = await delivery('refrigerator');
  validateAsset(manifest, bytes);
  const { bytes: shelf } = await delivery('wall-shelf');
  // Even a forged, generous delivery cannot use the refrigerator's ID for 52k faces.
  assert.throws(
    () =>
      validateAsset(
        {
          ...manifest,
          sha256: createHash('sha256').update(shelf).digest('hex'),
          bytes: shelf.length,
          geometry: {},
          budgets: { triangles: 55000, bytes: 8 * 1024 * 1024 },
          budget: { triangles: 55000, bytes: 8 * 1024 * 1024 },
        },
        shelf,
      ),
    /refrigerator budget exceeded/,
  );
});

function parsedAsset() {
  const scene = new T.Group();
  const geometry = new T.BoxGeometry(0.5, 0.62, 0.5);
  const texture = new T.Texture();
  let closed = 0;
  texture.source.data = { close: () => closed++ };
  const material = new T.MeshStandardMaterial({
    map: texture,
    roughnessMap: texture,
    roughness: 0.64,
  });
  const mesh = new T.Mesh(geometry, material);
  mesh.name = 'chair_mesh';
  scene.add(mesh);
  const disposed = { geometry: 0, material: 0, texture: 0 };
  for (const [key, resource] of Object.entries({ geometry, material, texture })) {
    resource.addEventListener('dispose', () => disposed[key]++);
  }
  return { scene, geometry, material, texture, disposed, closed: () => closed };
}

for (const [name, , build] of components) {
  if (name !== 'chair') {
    test(`${name} builder keeps the parsed PBR and unit transform and redraws once`, async (t) => {
      const loaded = parsedAsset();
      const parse = t.mock.method(GLTFLoader.prototype, 'parseAsync', async () => ({
        scene: loaded.scene,
      }));
      let redraws = 0;
      const owner = new Models(() => redraws++);
      const root = build(owner, createKitchenPalette(owner));
      await t.waitFor(() => assert.notEqual(root.userData.assetState, 'loading'));
      assert.equal(root.name, name);
      assert.equal(root.userData.assetState, 'ready');
      assert.deepEqual(root.position.toArray(), [0, 0, 0]);
      assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
      assert.deepEqual(loaded.scene.scale.toArray(), [1, 1, 1]);
      assert.equal(root.children.length, 1);
      assert.equal(root.children[0], loaded.scene);
      assert.equal(root.getObjectByName('chair_mesh').material, loaded.material);
      assert.equal(loaded.material.map, loaded.texture);
      assert.equal(redraws, 1);
      assert.equal(parse.mock.callCount(), 1);
      const { bytes } = await delivery(name);
      assert.deepEqual(Buffer.from(parse.mock.calls[0].arguments[0]), bytes);
      owner.dispose();
      assert.deepEqual(loaded.disposed, { geometry: 1, material: 1, texture: 1 });
      assert.equal(loaded.closed(), 1);
    });
  }
  test(`${name} builder retains fallback on failure and disposes a late parse`, async (t) => {
    let reject;
    const parse = t.mock.method(
      GLTFLoader.prototype,
      'parseAsync',
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    t.mock.method(console, 'warn', () => {});
    let redraws = 0;
    const owner = new Models(() => redraws++);
    const root = build(owner, createKitchenPalette(owner));
    const fallback = root.children[0];
    assert.ok(new T.Box3().setFromObject(fallback).isEmpty() === false);
    assert.equal(root.userData.assetState, 'loading');
    await t.waitFor(() => assert.equal(typeof reject, 'function'));
    reject(new Error('bad GLB'));
    await t.waitFor(() => assert.notEqual(root.userData.assetState, 'loading'));
    assert.equal(root.userData.assetState, 'fallback');
    assert.equal(root.children[0], fallback);
    assert.equal(redraws, 1);
    owner.dispose();

    const late = parsedAsset();
    let finish;
    parse.mock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const closedOwner = new Models(() => redraws++);
    const closedRoot = build(closedOwner, createKitchenPalette(closedOwner));
    await t.waitFor(() => assert.equal(typeof finish, 'function'));
    closedOwner.dispose();
    finish({ scene: late.scene });
    await t.waitFor(() => assert.equal(late.closed(), 1));
    assert.deepEqual(late.disposed, { geometry: 1, material: 1, texture: 1 });
    assert.equal(late.closed(), 1);
    assert.equal(redraws, 1);
    assert.equal(closedRoot.children[0].name.endsWith('-whitebox'), true);
    assert.equal(closedRoot.getObjectByName('chair_mesh'), undefined);
  });
}

test('two chairs parse once, share PBR resources and release once under one owner', async (t) => {
  const loaded = parsedAsset();
  let finish;
  const parse = t.mock.method(
    GLTFLoader.prototype,
    'parseAsync',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let redraws = 0;
  const owner = new Models(() => redraws++);
  const own = t.mock.method(owner, 'ownObject', Models.prototype.ownObject);
  const root = buildChairs(owner, createKitchenPalette(owner));
  assert.equal(root.name, 'chairs');
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  const fallback = root.children[0];
  for (const key of ['chair-left', 'chair-right']) {
    assert.deepEqual(fallback.getObjectByName(key).position.toArray(), [...KITCHEN_PLACEMENT[key]]);
  }
  await t.waitFor(() => assert.equal(typeof finish, 'function'));
  assert.equal(parse.mock.callCount(), 1);
  const { bytes } = await delivery('chair');
  assert.deepEqual(Buffer.from(parse.mock.calls[0].arguments[0]), bytes);
  finish({ scene: loaded.scene });
  await t.waitFor(() => assert.notEqual(root.userData.assetState, 'loading'));
  assert.equal(root.userData.assetState, 'ready');
  assert.equal(root.children.includes(fallback), false);
  assert.equal(own.mock.callCount(), 1);
  assert.equal(redraws, 1);
  const left = root.getObjectByName('chair-left');
  const right = root.getObjectByName('chair-right');
  assert.notEqual(left, right);
  for (const instance of [left, right]) {
    assert.deepEqual(instance.position.toArray(), [...KITCHEN_PLACEMENT[instance.name]]);
    assert.deepEqual(instance.scale.toArray(), [1, 1, 1]);
    const mesh = instance.getObjectByName('chair_mesh');
    assert.equal(mesh.geometry, loaded.geometry);
    assert.equal(mesh.material, loaded.material);
    assert.equal(mesh.material.map, loaded.texture);
    assert.equal(mesh.material.roughness, 0.64);
  }
  const originalRight = right.position.clone();
  left.position.x += 1;
  assert.ok(right.position.equals(originalRight));
  left.removeFromParent();
  assert.deepEqual(loaded.disposed, { geometry: 0, material: 0, texture: 0 });
  owner.dispose();
  owner.dispose();
  assert.deepEqual(loaded.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(loaded.closed(), 1);
});

test('two wall plants parse once, share PBR resources and release once under one owner', async (t) => {
  const loaded = parsedAsset();
  let finish;
  const parse = t.mock.method(
    GLTFLoader.prototype,
    'parseAsync',
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let redraws = 0;
  const owner = new Models(() => redraws++);
  const own = t.mock.method(owner, 'ownObject', Models.prototype.ownObject);
  const root = buildWallPlants(owner, createKitchenPalette(owner));
  assert.equal(root.name, 'wall-plants');
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  const fallback = root.children[0];
  for (const key of ['wall-plant-left', 'wall-plant-right']) {
    assert.deepEqual(fallback.getObjectByName(key).position.toArray(), [...KITCHEN_PLACEMENT[key]]);
  }
  await t.waitFor(() => assert.equal(typeof finish, 'function'));
  assert.equal(parse.mock.callCount(), 1);
  const { bytes } = await delivery('wall-plant');
  assert.deepEqual(Buffer.from(parse.mock.calls[0].arguments[0]), bytes);
  finish({ scene: loaded.scene });
  await t.waitFor(() => assert.notEqual(root.userData.assetState, 'loading'));
  assert.equal(root.userData.assetState, 'ready');
  assert.equal(root.children.includes(fallback), false);
  assert.equal(own.mock.callCount(), 1);
  assert.equal(redraws, 1);
  const left = root.getObjectByName('wall-plant-left');
  const right = root.getObjectByName('wall-plant-right');
  assert.notEqual(left, right);
  for (const instance of [left, right]) {
    assert.deepEqual(instance.position.toArray(), [...KITCHEN_PLACEMENT[instance.name]]);
    assert.deepEqual(instance.scale.toArray(), [1, 1, 1]);
    const mesh = instance.getObjectByName('chair_mesh');
    assert.equal(mesh.geometry, loaded.geometry);
    assert.equal(mesh.material, loaded.material);
    assert.equal(mesh.material.map, loaded.texture);
    assert.equal(mesh.material.roughness, 0.64);
  }
  assert.equal(left.rotation.y, Math.PI / 2);
  assert.equal(right.rotation.y, 0);
  const originalRight = right.position.clone();
  left.position.x += 1;
  assert.ok(right.position.equals(originalRight));
  left.removeFromParent();
  assert.deepEqual(loaded.disposed, { geometry: 0, material: 0, texture: 0 });
  owner.dispose();
  owner.dispose();
  assert.deepEqual(loaded.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(loaded.closed(), 1);
});
