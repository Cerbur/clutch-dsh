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
import { bundledAsset } from '../lib/client/scene/kitchen/asset.js';

async function delivery() {
  return {
    bytes: await readFile(new URL('../assets/models/kitchen/trash-can.glb', import.meta.url)),
    manifest: JSON.parse(
      await readFile(new URL('../assets/models/kitchen/trash-can.manifest.json', import.meta.url)),
    ),
  };
}

// Same inline transport as the Client; no bitmap decoding is needed for this asset.
const inlineHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('.glb?inline'))
      return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
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
const { buildTrashCan } = await import('../lib/client/scene/kitchen/trash-can.js');
inlineHook.deregister();

function rewriteGlb(bytes, edit) {
  const size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size));
  edit(doc);
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const result = Buffer.concat([bytes.subarray(0, 20), padded, bytes.subarray(20 + size)]);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  return result;
}

test('trash-can r2 has its own metric, textureless three-material delivery contract', async () => {
  const { bytes, manifest } = await delivery();
  assert.equal(manifest.revision, '2026-10-28-candy-r1');
  assert.equal(manifest.style.parentRevision, '2026-10-27-r2');
  assert.equal(
    manifest.style.parentSha256,
    '5e564460e4fab56449e2b2a1daf3c83872d9574baddae71393081d351150f83d',
  );
  const facts = validateAsset(manifest, bytes);
  assert.equal(facts.assetId, 'kitchen/trash-can');
  assert.ok(bytes.length < 2 * 1024 * 1024);
  for (const [key, expected] of Object.entries({
    triangles: 19197,
    meshes: 3,
    primitives: 6,
    materials: 3,
    images: 0,
  }))
    assert.equal(facts[key], expected, key);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
  assert.equal(doc.animations?.length ?? 0, 0);
  assert.equal(doc.textures?.length ?? 0, 0);
  assert.ok(doc.materials.every((material) => material.doubleSided));
  assert.equal(ASSET_RULES['kitchen/trash-can'].triangles, 20000);
  assert.equal(ASSET_RULES['kitchen/trash-can'].bytes, 2 * 1024 * 1024);
  assert.equal(ASSET_RULES['kitchen/refrigerator'].triangles, 30000);
  assert.equal(ASSET_RULES['kitchen/refrigerator'].bytes, 8 * 1024 * 1024);
});

test('trash-can budgets and semantic nodes cannot borrow the refrigerator contract', async () => {
  const { bytes, manifest } = await delivery();
  assert.throws(() => validateAsset({ ...manifest, file: 'refrigerator.glb' }, bytes), /contract/);
  assert.throws(
    () =>
      validateAsset(
        {
          ...manifest,
          coordinates: { ...manifest.coordinates, origin: 'cabinet-bottom-center' },
        },
        bytes,
      ),
    /contract/,
  );
  for (const budgets of [{ triangles: 19196 }, { bytes: bytes.length - 1 }])
    assert.throws(() => validateAsset({ ...manifest, budgets }, bytes), /budget exceeded/);
  for (const [label, edit] of [
    [
      'triangles',
      (doc) => {
        for (const mesh of doc.meshes) mesh.primitives.push(...mesh.primitives);
      },
    ],
    ['materials', (doc) => doc.materials.push({})],
    ['meshes', (doc) => doc.meshes.push({ primitives: [] })],
    [
      'images',
      (doc) => {
        doc.images = [{ bufferView: 0, mimeType: 'image/png' }];
      },
    ],
  ]) {
    const changed = rewriteGlb(bytes, edit);
    assert.throws(
      () =>
        validateAsset(
          {
            ...manifest,
            bytes: changed.length,
            geometry: {},
            sha256: createHash('sha256').update(changed).digest('hex'),
            budgets: { triangles: 30000, bytes: 8 * 1024 * 1024 },
          },
          changed,
        ),
      /trash-can budget exceeded/,
      label,
    );
  }
  // Legal container padding still cannot relax the importer's independent byte ceiling.
  const oversized = Buffer.concat([bytes, Buffer.alloc(2 * 1024 * 1024)]);
  oversized.writeUInt32LE(oversized.length, 8);
  const binHeader = 20 + oversized.readUInt32LE(12);
  oversized.writeUInt32LE(oversized.length - binHeader - 8, binHeader);
  assert.throws(
    () =>
      validateAsset(
        {
          ...manifest,
          bytes: oversized.length,
          sha256: createHash('sha256').update(oversized).digest('hex'),
          budgets: { triangles: 30000, bytes: 8 * 1024 * 1024 },
        },
        oversized,
      ),
    /trash-can budget exceeded/,
  );
  for (const name of ASSET_RULES['kitchen/trash-can'].nodes) {
    const changed = rewriteGlb(bytes, (doc) => {
      doc.nodes.find((node) => node.name === name).name = 'missing-node';
    });
    assert.throws(
      () =>
        validateAsset(
          {
            ...manifest,
            bytes: changed.length,
            requiredNodes: [],
            sha256: createHash('sha256').update(changed).digest('hex'),
          },
          changed,
        ),
      /Missing required node/,
      name,
    );
  }
});

function assertIndependentPivots(root) {
  root.updateMatrixWorld(true);
  const body = root.getObjectByName('桶身');
  const bodyBounds = new T.Box3().setFromObject(body);
  const bodyMatrix = body.matrixWorld.clone();
  for (const [name, position, angle] of [
    ['桶盖', [0, 0.85, -0.326427], -55],
    ['踏板', [0, 0.128472, 0.242167], 8],
  ]) {
    const pivot = root.getObjectByName(name);
    assert.ok(pivot);
    assert.deepEqual(pivot.quaternion.toArray(), [0, 0, 0, 1]);
    assert.ok(pivot.position.distanceTo(new T.Vector3(...position)) < 1e-5);
    const fixedOrigin = pivot.getWorldPosition(new T.Vector3());
    const original = pivot.matrixWorld.clone();
    const front = new T.Vector3(0, 0, 0.1).applyMatrix4(pivot.matrixWorld);
    pivot.rotateX(T.MathUtils.degToRad(angle));
    root.updateMatrixWorld(true);
    assert.equal(pivot.matrixWorld.equals(original), false);
    assert.ok(pivot.getWorldPosition(new T.Vector3()).distanceTo(fixedOrigin) < 1e-6);
    const movedFront = new T.Vector3(0, 0, 0.1).applyMatrix4(pivot.matrixWorld);
    assert.ok(name === '桶盖' ? movedFront.y > front.y : movedFront.y < front.y);
    assert.ok(body.matrixWorld.equals(bodyMatrix));
    assert.ok(new T.Box3().setFromObject(body).equals(bodyBounds));
    pivot.rotation.set(0, 0, 0);
  }
}

test('trash-can builder loads actual PBR at unit scale and keeps lid/pedal independent', async (t) => {
  const { bytes, manifest } = await delivery();
  const parsed = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const meshes = [];
  parsed.scene.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  const materials = new Set(
    meshes.flatMap((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])),
  );
  assert.equal(materials.size, 3);
  const pbr = [...materials].map((material) => material.toJSON());
  const parse = t.mock.method(GLTFLoader.prototype, 'parseAsync', async () => parsed);
  let redraws = 0;
  const owner = new Models(() => redraws++);
  t.after(() => owner.dispose());
  const root = buildTrashCan(owner, createKitchenPalette(owner));
  await t.waitFor(() => assert.notEqual(root.userData.assetState, 'loading'));
  assert.equal(root.name, 'trash-can');
  assert.equal(root.userData.assetState, 'ready');
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  assert.deepEqual(root.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(parsed.scene.scale.toArray(), [1, 1, 1]);
  assert.equal(root.children[0], parsed.scene);
  assert.equal(root.children.length, 1);
  assert.deepEqual(
    [...materials].map((material) => material.toJSON()),
    pbr,
  );
  assert.equal(redraws, 1);
  assert.equal(parse.mock.callCount(), 1);
  assert.deepEqual(Buffer.from(parse.mock.calls[0].arguments[0]), bytes);
  const bounds = new T.Box3().setFromObject(root);
  for (const side of ['min', 'max'])
    bounds[side]
      .toArray()
      .forEach((value, i) => assert.ok(Math.abs(value - manifest.bounds[side][i]) < 1e-4));
  assertIndependentPivots(root);
  const disposed = [...materials].map(() => 0);
  [...materials].forEach((material, i) =>
    material.addEventListener('dispose', () => disposed[i]++),
  );
  owner.dispose();
  owner.dispose();
  assert.deepEqual(disposed, [1, 1, 1]);
});

test('trash-can builder retains its whitebox on failure and frees a late parse', async (t) => {
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
  t.after(() => owner.dispose());
  const root = buildTrashCan(owner, createKitchenPalette(owner));
  const fallback = root.children[0];
  assert.equal(fallback.name, 'trash-can-whitebox');
  assert.equal(new T.Box3().setFromObject(fallback).isEmpty(), false);
  await t.waitFor(() => assert.equal(typeof reject, 'function'));
  reject(new Error('bad GLB'));
  await t.waitFor(() => assert.notEqual(root.userData.assetState, 'loading'));
  assert.equal(root.userData.assetState, 'fallback');
  assert.equal(root.children[0], fallback);
  assert.equal(redraws, 1);
  owner.dispose();

  const late = new T.Group();
  const geometry = new T.BoxGeometry();
  const material = new T.MeshStandardMaterial();
  late.add(new T.Mesh(geometry, material));
  let geometryDisposals = 0;
  let materialDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  let finish;
  parse.mock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const closedOwner = new Models(() => redraws++);
  const closedRoot = buildTrashCan(closedOwner, createKitchenPalette(closedOwner));
  await t.waitFor(() => assert.equal(typeof finish, 'function'));
  closedOwner.dispose();
  finish({ scene: late });
  await t.waitFor(() => {
    assert.equal(geometryDisposals, 1);
    assert.equal(materialDisposals, 1);
  });
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(closedRoot.children[0].name, 'trash-can-whitebox');
  assert.equal(closedRoot.children.includes(late), false);
  assert.equal(redraws, 1);
});

test('trash-can runtime uses the shared loader for reduced-motion redraw', async () => {
  const { bytes } = await delivery();
  let ready;
  const loaded = new Promise((resolve) => {
    ready = resolve;
  });
  const owner = new Models(() => ready());
  try {
    const root = bundledAsset('trash-can', bytes.toString('base64'))(owner, new T.Group());
    await loaded;
    assert.equal(root.userData.assetState, 'ready');
    assertIndependentPivots(root);
  } finally {
    owner.dispose();
  }
});
