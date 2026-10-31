import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  exportInstanceGeometry,
  geometryOnlyGlb,
  geometrySignature,
} from '../scripts/export-lighting-geometry.mjs';

// Two material-distinct primitives reuse the same indexed attributes. Removing
// materials must not merge them or change the loader's names/traversal order.
function fixture() {
  const bin = Buffer.alloc(104);
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((value, i) =>
    bin.writeFloatLE(value, i * 4),
  );
  [2, 0, 1].forEach((value, i) => bin.writeUInt16LE(value, 96 + i * 2));
  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'part', translation: [1, 2, 3], mesh: 0 },
    ],
    materials: [{ name: 'one' }, { name: 'two', pbrMetallicRoughness: { metallicFactor: 0.5 } }],
    meshes: [
      {
        name: 'primitive',
        primitives: [0, 1].map((material) => ({
          attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
          indices: 3,
          material,
        })),
      },
    ],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 },
      { buffer: 0, byteOffset: 96, byteLength: 6 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const bytes = Buffer.alloc(28 + padded.length + bin.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(bytes, 20);
  bytes.writeUInt32LE(bin.length, 20 + padded.length);
  bytes.writeUInt32LE(0x004e4942, 24 + padded.length);
  bin.copy(bytes, 28 + padded.length);
  return bytes;
}

async function meshes(bytes) {
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const result = [];
  scene.traverse((object) => {
    if (object.isMesh) result.push(object);
  });
  return result;
}

test('texture/material stripping preserves full-GLB primitive traversal, attributes and signatures', async () => {
  const bytes = fixture(),
    snapshot = Buffer.from(bytes);
  const full = await meshes(bytes),
    stripped = await meshes(geometryOnlyGlb(bytes));
  assert.equal(full.length, 2);
  assert.deepEqual(
    stripped.map((mesh) => mesh.name),
    full.map((mesh) => mesh.name),
  );
  assert.deepEqual(
    stripped.map((mesh) => geometrySignature(mesh.geometry)),
    full.map((mesh) => geometrySignature(mesh.geometry)),
  );
  for (let i = 0; i < full.length; i++)
    for (const name of ['position', 'normal', 'uv'])
      assert.deepEqual(
        stripped[i].geometry.getAttribute(name).array,
        full[i].geometry.getAttribute(name).array,
      );
  assert.deepEqual(bytes, snapshot, 'source bytes never change');
});

test('export keeps original indexed corner order and composes scene placement with GLTF node transforms', async () => {
  const bytes = fixture();
  const root = new T.Matrix4().compose(
    new T.Vector3(10, 0, 0),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), Math.PI / 2),
    new T.Vector3(2, 1, 1),
  );
  const result = await exportInstanceGeometry('chair-left', 'kitchen/chair', bytes, root);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.meshes.length, 2);
  for (const [i, mesh] of result.meshes.entries()) {
    assert.equal(mesh.meshIndex, i);
    assert.equal(mesh.vertexCount, 3);
    assert.deepEqual(mesh.source, { nodeIndex: 1, meshIndex: 0, primitiveIndex: i });
    // The source indices are [2,0,1], not the accessor order [0,1,2].
    const expected = [13, 3, -2, 13, 2, -2, 13, 2, -4];
    mesh.positions.forEach((value, j) => assert.ok(Math.abs(value - expected[j]) < 1e-12));
  }
  const other = await exportInstanceGeometry(
    'chair-right',
    'kitchen/chair',
    bytes,
    new T.Matrix4().makeTranslation(3, 0, 0),
  );
  assert.deepEqual(
    result.meshes.map((m) => m.geometrySignature),
    other.meshes.map((m) => m.geometrySignature),
  );
  assert.notDeepEqual(result.meshes[0].positions, other.meshes[0].positions);
});

test('signature independently detects position, index, normal, UV and attribute metadata changes', async () => {
  const [mesh] = await meshes(fixture());
  const signature = geometrySignature(mesh.geometry);
  for (const name of ['position', 'index', 'normal', 'uv']) {
    const geometry = mesh.geometry.clone();
    const attribute = name === 'index' ? geometry.index : geometry.getAttribute(name);
    attribute.array[0] += 1;
    assert.notEqual(geometrySignature(geometry), signature, name);
  }
  const normalized = mesh.geometry.clone();
  normalized.getAttribute('uv').normalized = true;
  assert.notEqual(geometrySignature(normalized), signature);
  const missing = mesh.geometry.clone();
  missing.deleteAttribute('normal');
  assert.notEqual(geometrySignature(missing), signature);
});

test('signature ignores UUID and buffer padding but preserves raw interleaved attribute values', () => {
  const plain = new T.BufferGeometry();
  plain.setAttribute('position', new T.Float32BufferAttribute([1, 2, 3, 4, 5, 6], 3));
  const interleaved = new T.BufferGeometry();
  const data = new T.InterleavedBuffer(new Float32Array([99, 1, 2, 3, 88, 4, 5, 6]), 4);
  interleaved.setAttribute('position', new T.InterleavedBufferAttribute(data, 3, 1));
  assert.notEqual(plain.uuid, interleaved.uuid);
  assert.equal(geometrySignature(plain), geometrySignature(interleaved));
});
