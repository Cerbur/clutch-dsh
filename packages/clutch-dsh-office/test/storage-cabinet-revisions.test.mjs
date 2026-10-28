import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { validateAsset } from '../scripts/sync-asset.mjs';

const STATIC_REVISION = '2026-10-28-r1';
const LEGACY_REVISIONS = ['2026-10-27-r1', '2026-10-27-style-r1'];
const STATIC_NODES = ['置物柜', '置物柜_用户原件静态总成'];
const LEGACY_NODES = [
  '置物柜',
  '柜架与层板',
  '下层收纳筐与食材',
  '中层蔬菜托盘',
  '台面调料与盆栽',
  '脚轮_左前',
  '脚轮_左后',
  '脚轮_右前',
  '脚轮_右后',
];

// Self-contained indexed triangles: no historical textured fixture or local asset library.
function fixture(revision, { edit = () => {}, triangles = 1, padding = 0 } = {}) {
  const names = revision === STATIC_REVISION ? STATIC_NODES : LEGACY_NODES;
  const meshNames = revision === STATIC_REVISION ? [names[1]] : names.slice(1, 9);
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
    assetId: 'kitchen/storage-cabinet',
    revision,
    status: 'ready',
    file: 'storage-cabinet.glb',
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
    budgets: { triangles: 30000, bytes: 8 * 1024 * 1024 },
  };
  return { manifest, bytes };
}

test('storage static revision accepts its real nodes without semantic groups or wheel pivots', () => {
  const { manifest, bytes } = fixture(STATIC_REVISION);
  const facts = validateAsset(manifest, bytes);
  assert.deepEqual(facts.nodes, STATIC_NODES);
  assert.equal(facts.meshes, 1);
  assert.equal(facts.primitives, 1);
  assert.equal(facts.materials, 1);
  assert.ok(bytes.length < 4096);
});

for (const name of STATIC_NODES) {
  test(`storage static revision independently requires ${name}`, () => {
    const { manifest, bytes } = fixture(STATIC_REVISION, {
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

test('storage rejects a deleted static assembly node even with empty manifest requiredNodes', () => {
  const { manifest, bytes } = fixture(STATIC_REVISION, {
    edit(doc) {
      doc.nodes.splice(1, 1);
      doc.nodes[0].children = [];
    },
  });
  assert.throws(
    () => validateAsset(manifest, bytes),
    /Missing required node: 置物柜_用户原件静态总成/,
  );
});

for (const revision of LEGACY_REVISIONS) {
  test(`storage ${revision} still rolls back with every original semantic group and wheel pivot`, () => {
    const current = fixture(STATIC_REVISION);
    validateAsset(current.manifest, current.bytes);
    const previous = fixture(revision);
    const facts = validateAsset(previous.manifest, previous.bytes);
    assert.deepEqual(facts.nodes, LEGACY_NODES);
    assert.equal(facts.meshes, 8);
    assert.equal(facts.primitives, 8);
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
    validateAsset(current.manifest, current.bytes);
  });

  test(`storage ${revision} cannot bypass its contract by claiming the static revision`, () => {
    const previous = fixture(revision);
    assert.throws(
      () => validateAsset({ ...previous.manifest, revision: STATIC_REVISION }, previous.bytes),
      /storage-cabinet budget exceeded/,
    );
    // Also exercise the hardcoded node contract after reducing the old fixture to
    // one primitive, so rejection does not depend solely on the geometry ceiling.
    const single = fixture(revision, {
      edit(doc) {
        doc.meshes.splice(1);
        for (const node of doc.nodes) if (node.mesh > 0) delete node.mesh;
      },
    });
    assert.throws(
      () => validateAsset({ ...single.manifest, revision: STATIC_REVISION }, single.bytes),
      /Missing required node: 置物柜_用户原件静态总成/,
    );
  });
}

for (const revision of [...LEGACY_REVISIONS, '2026-10-28-r2', undefined]) {
  test(`storage static geometry cannot bypass the old node contract with revision ${revision}`, () => {
    const { manifest, bytes } = fixture(STATIC_REVISION);
    assert.throws(
      () => validateAsset({ ...manifest, revision }, bytes),
      /Missing required node: 柜架与层板/,
    );
  });
}

for (const revision of [STATIC_REVISION, ...LEGACY_REVISIONS]) {
  test(`storage ${revision} cannot relax the 30k, 8 MiB and single-material ceilings`, () => {
    const options = [
      { triangles: revision === STATIC_REVISION ? 30001 : 3751 },
      { padding: 8 * 1024 * 1024 },
      { edit: (doc) => doc.materials.push({}) },
    ];
    if (revision === STATIC_REVISION)
      options.push(
        { edit: (doc) => doc.meshes[0].primitives.push({ ...doc.meshes[0].primitives[0] }) },
        { edit: (doc) => doc.meshes.push({ primitives: [] }) },
      );
    for (const option of options) {
      const { manifest, bytes } = fixture(revision, option);
      // Independently measured facts must enforce the importer rule even when
      // the manifest omits geometry and advertises larger delivery budgets.
      manifest.geometry = {};
      manifest.budgets = { triangles: 100000, bytes: 16 * 1024 * 1024 };
      assert.throws(() => validateAsset(manifest, bytes), /storage-cabinet budget exceeded/);
    }
    const { manifest, bytes } = fixture(revision);
    for (const budgets of [{ triangles: 0 }, { bytes: bytes.length - 1 }])
      assert.throws(
        () => validateAsset({ ...manifest, budgets }, bytes),
        /storage-cabinet budget exceeded/,
      );
  });
}
