import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { validateAsset } from '../scripts/sync-asset.mjs';

const R2 = '2026-10-27-r2';
const LEGACY_REVISIONS = ['2026-10-27-r1', '2026-10-27-style-r1'];
const STATIC_NODES = ['水槽柜', '水槽柜静态总成', 'work_surface', 'wash_anchor', 'prep_anchor'];
const LEGACY_NODES = [
  '水槽柜',
  '柜体',
  '台面与挡水板',
  '水槽与龙头',
  '砧板与蔬菜',
  '左柜门',
  '右柜门',
  '侧柜门',
  '抽屉',
  'work_surface',
  'wash_anchor',
  'prep_anchor',
];

// Tiny, self-contained indexed GLBs exercise the contract without library paths
// or a copy of a historical textured delivery. Each legacy part has its own mesh.
function fixture(revision, { edit = () => {}, triangles = 1, padding = 0 } = {}) {
  const names = revision === R2 ? STATIC_NODES : LEGACY_NODES;
  const meshNames = revision === R2 ? [names[1]] : names.slice(1, 9);
  const anchors = {
    work_surface: [0, 0.9, 0],
    wash_anchor: [0, 0.91, 0],
    prep_anchor: [0.53, 0.93, 0],
  };
  const binary = Buffer.alloc(Math.ceil((72 + triangles * 6) / 4) * 4 + padding);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, i) => binary.writeFloatLE(value, i * 4));
  [0, 1, 0, 0, 1, 0, 0, 1, 0].forEach((value, i) => binary.writeFloatLE(value, 36 + i * 4));
  for (let i = 0; i < triangles * 3; i++) binary.writeUInt16LE(i % 3, 72 + i * 2);
  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: names.map((name, i) => ({
      name,
      ...(i === 0 ? { children: names.slice(1).map((_, j) => j + 1) } : {}),
      ...(meshNames.includes(name) ? { mesh: meshNames.indexOf(name) } : {}),
      ...(anchors[name] ? { translation: anchors[name] } : {}),
    })),
    meshes: meshNames.map(() => ({
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    })),
    materials: [{}],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: triangles * 6 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 1],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: triangles * 3, type: 'SCALAR' },
    ],
  };
  edit(doc);
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const bytes = Buffer.alloc(28 + padded.length + binary.length);
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(bytes, 20);
  bytes.writeUInt32LE(binary.length, 20 + padded.length);
  bytes.writeUInt32LE(0x004e4942, 24 + padded.length);
  binary.copy(bytes, 28 + padded.length);
  const primitives = doc.meshes.flatMap((mesh) => mesh.primitives);
  const manifest = {
    schemaVersion: 1,
    assetId: 'kitchen/sink-cabinet',
    revision,
    status: 'ready',
    file: 'sink-cabinet.glb',
    coordinates: { unit: 'meter', up: '+Y', forward: '+Z', origin: 'floor-center' },
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    geometry: {
      triangles: primitives.length * triangles,
      meshes: doc.meshes.length,
      primitives: primitives.length,
      materials: doc.materials.length,
      images: 0,
    },
    // Omit declared nodes deliberately: the importer must enforce its own contract.
    requiredNodes: [],
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    dimensions: { width: 1, height: 1, depth: 1 },
    anchors,
    budgets: { triangles: 40000, bytes: 8 * 1024 * 1024 },
  };
  return { manifest, bytes };
}

test('sink r2 accepts the static assembly and anchors without door/drawer pivots', () => {
  const { manifest, bytes } = fixture(R2);
  const facts = validateAsset(manifest, bytes);
  assert.deepEqual(facts.nodes, STATIC_NODES);
  assert.equal(facts.primitives, 1);
  assert.equal(facts.meshes, 1);
  assert.equal(facts.materials, 1);
  assert.ok(bytes.length < 4096);
});

test('sink r2 rejects a removed static mesh node even with an empty requiredNodes list', () => {
  const { manifest, bytes } = fixture(R2, {
    edit(doc) {
      doc.nodes.splice(1, 1);
      doc.nodes[0].children = doc.nodes.slice(1).map((_, i) => i + 1);
    },
  });
  assert.throws(() => validateAsset(manifest, bytes), /Missing required node: 水槽柜静态总成/);
});

for (const name of STATIC_NODES) {
  test(`sink r2 independently requires ${name}`, () => {
    const { manifest, bytes } = fixture(R2, {
      edit(doc) {
        doc.nodes.find((node) => node.name === name).name = 'uncontracted-node';
      },
    });
    assert.throws(
      () => validateAsset(manifest, bytes),
      new RegExp(`Missing required node: ${name}`),
    );
  });
}

for (const revision of LEGACY_REVISIONS) {
  test(`sink ${revision} can roll back after r2 without changing its eight-part contract`, () => {
    const current = fixture(R2);
    validateAsset(current.manifest, current.bytes);
    const previous = fixture(revision);
    const facts = validateAsset(previous.manifest, previous.bytes);
    assert.deepEqual(facts.nodes, LEGACY_NODES);
    assert.equal(facts.primitives, 8);
    // Resolving a revision must not mutate the shared default or r2 rules.
    validateAsset(current.manifest, current.bytes);
    for (const name of LEGACY_NODES) {
      const broken = fixture(revision, {
        edit(doc) {
          doc.nodes.find((node) => node.name === name).name = 'uncontracted-node';
        },
      });
      assert.throws(
        () => validateAsset(broken.manifest, broken.bytes),
        new RegExp(`Missing required node: ${name}`),
      );
    }
  });

  test(`sink ${revision} cannot masquerade as r2`, () => {
    const { manifest, bytes } = fixture(revision);
    assert.throws(
      () => validateAsset({ ...manifest, revision: R2 }, bytes),
      /sink-cabinet budget exceeded/,
    );
    // A single primitive with legacy names must still fail the r2 node contract.
    const single = fixture(R2, {
      edit(doc) {
        doc.nodes[1].name = '柜体';
      },
    });
    assert.throws(
      () => validateAsset({ ...single.manifest, requiredNodes: LEGACY_NODES }, single.bytes),
      /Missing required node: 水槽柜静态总成/,
    );
  });
}

for (const revision of [...LEGACY_REVISIONS, '2026-10-27-r3', undefined]) {
  test(`static sink cannot bypass the old node contract with revision ${revision}`, () => {
    const { manifest, bytes } = fixture(R2);
    assert.throws(
      () => validateAsset({ ...manifest, revision }, bytes),
      /Missing required node: 柜体/,
    );
  });
}

for (const revision of [R2, ...LEGACY_REVISIONS]) {
  test(`sink ${revision} keeps independent triangle, byte, material and primitive ceilings`, () => {
    for (const options of [
      { triangles: revision === R2 ? 40001 : 5001 },
      { padding: 8 * 1024 * 1024 },
      { edit: (doc) => doc.materials.push({}) },
      { edit: (doc) => doc.meshes[0].primitives.push({ ...doc.meshes[0].primitives[0] }) },
    ]) {
      const { manifest, bytes } = fixture(revision, options);
      manifest.budgets = { triangles: 100000, bytes: 16 * 1024 * 1024 };
      assert.throws(() => validateAsset(manifest, bytes), /sink-cabinet budget exceeded/);
    }
    const { manifest, bytes } = fixture(revision);
    for (const budgets of [{ triangles: 0 }, { bytes: bytes.length - 1 }])
      assert.throws(
        () => validateAsset({ ...manifest, budgets }, bytes),
        /sink-cabinet budget exceeded/,
      );
  });
}
