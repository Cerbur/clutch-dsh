import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import {
  CURRENT_LIGHTING_LAYOUT,
  LIGHTING_LIMITS,
  inspectLightingPng,
  syncLighting,
  validateLighting,
} from '../scripts/sync-lighting.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const clone = (value) => structuredClone(value);
const ids = Object.keys(CURRENT_LIGHTING_LAYOUT.positions);
const asset = (id) =>
  id.startsWith('chair-') ? 'chair' : id.startsWith('wall-plant-') ? 'wall-plant' : id;

function chunk(type, bytes) {
  const name = Buffer.from(type);
  const payload = Buffer.concat([name, bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}

function png(width = 4, height = 4, bitDepth = 8) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = bitDepth;
  header[9] = 6;
  const rows = [];
  for (let row = 0; row < height; row++) {
    const bytes = Buffer.alloc(width * 4 + 1);
    for (let x = 0; x < width; x++) Buffer.from([255, 128, 64, 51]).copy(bytes, 1 + x * 4);
    rows.push(bytes);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function fixture() {
  const atlas = png();
  const glbs = Object.fromEntries(
    ids.map((id) => [asset(id), Buffer.from(`current GLB bytes: ${asset(id)}`)]),
  );
  const sourceHashes = Object.fromEntries(ids.map((id) => [id, hash(glbs[asset(id)])]));
  let offset = 0;
  const instances = Object.fromEntries(
    ids.map((id) => {
      const meshes = Array.from({ length: id === 'floor' ? 2 : 1 }, (_, meshIndex) => {
        const entry = {
          meshIndex,
          name: `${id}_${meshIndex}`,
          vertexCount: 3,
          offset,
          geometrySignature: hash(Buffer.from(`${id}/${meshIndex}`)),
        };
        offset += 12;
        return entry;
      });
      return [id, meshes];
    }),
  );
  const uv = Buffer.alloc(offset);
  for (let index = 0; index < uv.length; index += 2) uv.writeUInt16LE(index % 65536, index);
  const manifest = {
    schemaVersion: 1,
    assetId: 'kitchen/lighting',
    revision: 'unit-bake-r1',
    status: 'ready',
    geometrySignatureVersion: 'three-attributes-sha256-v1',
    atlas: {
      file: 'diffuse.png',
      encoding: 'RGBM',
      range: 8,
      width: 4,
      height: 4,
      sha256: hash(atlas),
    },
    uv: { file: 'uv.bin', encoding: 'uint16-le-normalized', sha256: hash(uv), bytes: uv.length },
    layout: clone(CURRENT_LIGHTING_LAYOUT),
    instances,
    sources: ids.map((id) => ({ id, assetId: `kitchen/${asset(id)}`, sha256: sourceHashes[id] })),
  };
  return { manifest, atlas, uv, sourceHashes, glbs };
}

function validate(f) {
  return validateLighting(f.manifest, f.atlas, f.uv, { sourceHashes: f.sourceHashes });
}

function compactFixture() {
  const f = fixture();
  f.manifest.receiverIds = ['floor', 'left-wall', 'right-wall'];
  const chunks = [];
  let offset = 0;
  for (const [id, entries] of Object.entries(f.manifest.instances))
    for (const entry of entries) {
      if (f.manifest.receiverIds.includes(id)) {
        const length = entry.vertexCount * 4;
        chunks.push(f.uv.subarray(entry.offset, entry.offset + length));
        entry.offset = offset;
        offset += length;
      } else delete entry.offset;
    }
  f.uv = Buffer.concat(chunks);
  f.manifest.uv = { ...f.manifest.uv, scope: 'receivers', bytes: offset, sha256: hash(f.uv) };
  return f;
}

test('compact shell UV retains all current sources and all primitive metadata', () => {
  const legacy = fixture(),
    f = compactFixture(),
    result = validate(f);
  assert.equal(result.instances, ids.length);
  assert.equal(result.meshes, ids.length + 1);
  assert.equal(result.vertexCount, (ids.length + 1) * 3);
  assert.equal(result.uv.bytes, 4 * 3 * 4);
  assert.deepEqual(f.manifest.sources, legacy.manifest.sources);
  for (const id of ids)
    f.manifest.instances[id].forEach((entry, i) => {
      const original = clone(legacy.manifest.instances[id][i]);
      const actual = clone(entry);
      delete original.offset;
      delete actual.offset;
      assert.deepEqual(actual, original);
      assert.equal('offset' in entry, f.manifest.receiverIds.includes(id));
    });
});

test('legacy explicit receiver selection still requires every occluder UV span', () => {
  const f = fixture();
  f.manifest.receiverIds = ['floor', 'left-wall', 'right-wall'];
  assert.equal(validate(f).uv.bytes, (ids.length + 1) * 3 * 4);
  delete f.manifest.instances.table[0].offset;
  assert.throws(() => validate(f), /UV span out of bounds: table/);
});

test('compact rejects missing receiver offsets, extra occluder offsets and unknown scopes', () => {
  for (const [edit, reason] of [
    [
      (m) => {
        delete m.instances.floor[0].offset;
      },
      /UV span out of bounds: floor/,
    ],
    [
      (m) => {
        m.instances.table[0].offset = 0;
      },
      /Unexpected nonreceiver UV offset: table/,
    ],
    [
      (m) => {
        m.uv.scope = 'all';
      },
      /Unsupported UV scope/,
    ],
    [
      (m) => {
        m.uv.scope = null;
      },
      /Unsupported UV scope/,
    ],
    [
      (m) => {
        delete m.receiverIds;
      },
      /explicit receiverIds/,
    ],
  ]) {
    const f = compactFixture();
    edit(f.manifest);
    assert.throws(() => validate(f), reason);
  }
});

test('compact occluders retain source, primitive and geometry metadata validation', () => {
  for (const [edit, reason] of [
    [
      (f) => {
        f.sourceHashes.table = hash(Buffer.from('changed occluder'));
      },
      /Source GLB mismatch: table/,
    ],
    [
      (f) => {
        delete f.manifest.instances.table;
      },
      /all current/,
    ],
    [
      (f) => {
        f.manifest.sources.pop();
      },
      /GLB source/,
    ],
    [
      (f) => {
        f.manifest.instances.table = [];
      },
      /Missing mesh records: table/,
    ],
    [
      (f) => {
        f.manifest.instances.table[0].meshIndex = 1;
      },
      /mesh indices: table/,
    ],
    [
      (f) => {
        f.manifest.instances.table[0].vertexCount = 4;
      },
      /vertexCount: table/,
    ],
    [
      (f) => {
        delete f.manifest.instances.table[0].name;
      },
      /vertexCount: table/,
    ],
    [
      (f) => {
        f.manifest.instances.table[0].geometrySignature = 'bad';
      },
      /geometry signature: table/,
    ],
  ]) {
    const f = compactFixture();
    edit(f);
    assert.throws(() => validate(f), reason);
  }
});

test('compact receiver spans must cover exactly the sidecar without gaps or overlaps', () => {
  for (const offset of [0, 4, -4, 1, 1000]) {
    const f = compactFixture();
    f.manifest.instances.floor[1].offset = offset;
    assert.throws(() => validate(f), /UV span/);
  }
  const f = compactFixture();
  f.uv = Buffer.concat([f.uv, Buffer.alloc(4)]);
  f.manifest.uv.bytes = f.uv.length;
  f.manifest.uv.sha256 = hash(f.uv);
  assert.throws(() => validate(f), /unreferenced trailing bytes/);
});

test('accepts all current placements, shared chair source and every triangle-corner UV span', () => {
  const f = fixture();
  const result = validate(f);
  assert.equal(result.instances, ids.length);
  assert.equal(result.meshes, ids.length + 1);
  assert.equal(result.vertexCount, (ids.length + 1) * 3);
  assert.equal(result.uv.bytes, (ids.length + 1) * 3 * 4);
  assert.equal(result.atlas.range, 8);
  assert.deepEqual(inspectLightingPng(f.atlas), { width: 4, height: 4, bitDepth: 8, channels: 4 });
  assert.equal(
    f.manifest.sources.find((s) => s.id === 'chair-left').sha256,
    f.manifest.sources.find((s) => s.id === 'chair-right').sha256,
  );
  // JSON key order is not a layout change; numeric values and missing/default fields are.
  f.manifest.layout.positions = Object.fromEntries(
    Object.entries(f.manifest.layout.positions).reverse(),
  );
  f.manifest.instances = Object.fromEntries(Object.entries(f.manifest.instances).reverse());
  f.manifest.sources.reverse();
  assert.equal(validate(f).instances, ids.length);
  f.manifest.atlas.range = 64;
  assert.equal(validate(f).atlas.range, 64);
  // The first frozen baker omitted this optional top-level label.
  delete f.manifest.geometrySignatureVersion;
  assert.equal(validate(f).instances, ids.length);
});

test('rejects atlas and UV content/hash mismatches', () => {
  for (const field of ['atlas', 'uv']) {
    const f = fixture();
    f[field] = Buffer.from(f[field]);
    f[field][f[field].length - 1] ^= 1;
    assert.throws(() => validate(f), /hash mismatch/);
  }
});

test('rejects stale positions, rotations and nonuniform scales', () => {
  for (const edit of [
    (layout) => {
      layout.positions.table[2] += 0.4;
    },
    (layout) => {
      layout.rotations.stove += 0.01;
    },
    (layout) => {
      layout.scales['sink-cabinet'][0] = 1;
    },
    (layout) => {
      delete layout.scales['sink-cabinet'];
    },
  ]) {
    const f = fixture();
    edit(f.manifest.layout);
    assert.throws(() => validate(f), /Stale lighting layout/);
  }
});

test('rejects missing/extra instances, missing meshes and duplicated source IDs', () => {
  for (const edit of [
    (m) => {
      delete m.instances.rug;
    },
    (m) => {
      m.instances.character = m.instances.rug;
    },
    (m) => {
      m.instances.rug = [];
    },
    (m) => {
      m.sources[1] = clone(m.sources[0]);
    },
    (m) => {
      m.sources.pop();
    },
  ]) {
    const f = fixture();
    edit(f.manifest);
    assert.throws(() => validate(f), /instances|mesh records|source instance|GLB source/);
  }
});

test('rejects current-source hash mismatches and incorrect source asset IDs', () => {
  for (const edit of [
    (f) => {
      f.sourceHashes.floor = hash(Buffer.from('replaced GLB'));
    },
    (f) => {
      f.manifest.sources[0].assetId = 'character/deepseek';
    },
    (f) => {
      f.manifest.sources[0].sha256 = 'not-a-sha';
    },
  ]) {
    const f = fixture();
    edit(f);
    assert.throws(() => validate(f), /Source GLB mismatch/);
  }
});

test('rejects overlapping, gapped, negative, misaligned or truncated UV spans', () => {
  for (const edit of [
    (f) => {
      f.manifest.instances.floor[1].offset = 0;
    },
    (f) => {
      f.manifest.instances.floor[0].offset = 4;
    },
    (f) => {
      f.manifest.instances.floor[0].offset = -4;
    },
    (f) => {
      f.manifest.instances.floor[0].offset = 1;
    },
    (f) => {
      f.manifest.instances.floor[0].vertexCount = 900;
    },
    (f) => {
      f.uv = f.uv.subarray(0, f.uv.length - 4);
      f.manifest.uv.bytes = f.uv.length;
      f.manifest.uv.sha256 = hash(f.uv);
    },
    (f) => {
      f.uv = Buffer.concat([f.uv, Buffer.alloc(4)]);
      f.manifest.uv.bytes = f.uv.length;
      f.manifest.uv.sha256 = hash(f.uv);
    },
  ]) {
    const f = fixture();
    edit(f);
    assert.throws(() => validate(f), /UV span|UV sidecar/);
  }
});

test('rejects zero/fractional/nontriangle counts, unsafe integers and nonconsecutive ordinals', () => {
  for (const count of [0, -3, 4, 3.5, Number.MAX_SAFE_INTEGER, Infinity]) {
    const f = fixture();
    f.manifest.instances.floor[0].vertexCount = count;
    assert.throws(() => validate(f), /vertexCount|UV span/);
  }
  for (const index of [1, -1, 0.5]) {
    const f = fixture();
    f.manifest.instances.floor[0].meshIndex = index;
    assert.throws(() => validate(f), /Non-consecutive/);
  }
  const f = fixture();
  f.manifest.instances.floor[0].geometrySignature = 'a'.repeat(63);
  assert.throws(() => validate(f), /geometry signature/);
});

test('rejects truncated IHDR, CRC failures, 16-bit output and oversized/mismatched dimensions', () => {
  const f = fixture();
  for (const length of [0, 8, 16, 24, 29, 32])
    assert.throws(() => inspectLightingPng(f.atlas.subarray(0, length)), /IHDR/);
  assert.throws(() => inspectLightingPng(png(4, 4, 16)), /8-bit RGBA/);
  assert.throws(() => inspectLightingPng(png(4097, 1)), /dimensions/);
  const bad = Buffer.from(f.atlas);
  bad[29] ^= 1;
  assert.throws(() => inspectLightingPng(bad), /checksum/);
  assert.throws(() => inspectLightingPng(f.atlas.subarray(0, 33)), /IDAT/);
  f.manifest.atlas.width = 8;
  assert.throws(() => validate(f), /dimensions differ/);
});

test('rejects unsupported contracts, path overrides, ranges, byte declarations and budgets', () => {
  for (const edit of [
    (f) => {
      f.manifest.schemaVersion = 2;
    },
    (f) => {
      f.manifest.assetId = 'kitchen/floor';
    },
    (f) => {
      f.manifest.status = 'accepted';
    },
    (f) => {
      f.manifest.geometrySignatureVersion = 'unversioned';
    },
    (f) => {
      f.manifest.atlas.file = '../diffuse.png';
    },
    (f) => {
      f.manifest.uv.file = '/tmp/uv.bin';
    },
    (f) => {
      f.manifest.atlas.range = 7;
    },
    (f) => {
      f.manifest.atlas.range = 65;
    },
    (f) => {
      f.manifest.atlas.range = NaN;
    },
    (f) => {
      f.manifest.atlas.encoding = 'sRGB';
    },
    (f) => {
      f.manifest.uv.encoding = 'float32';
    },
    (f) => {
      f.manifest.uv.bytes++;
    },
    (f) => {
      f.atlas = Buffer.alloc(LIGHTING_LIMITS.atlasBytes + 1);
    },
    (f) => {
      f.uv = Buffer.alloc(LIGHTING_LIMITS.uvBytes + 1);
    },
  ]) {
    const f = fixture();
    edit(f);
    assert.throws(() => validate(f));
  }
});

async function withDiskFixture(run, makeFixture = fixture) {
  const dir = await mkdtemp(join(tmpdir(), 'office-lighting-test-'));
  try {
    const f = makeFixture();
    const delivery = join(dir, 'delivery');
    const models = join(dir, 'models');
    const output = join(dir, 'adopted');
    await mkdir(delivery);
    await mkdir(models);
    await mkdir(output);
    for (const [name, bytes] of Object.entries(f.glbs))
      await writeFile(join(models, `${name}.glb`), bytes);
    for (const [name, bytes] of [
      ['manifest.json', JSON.stringify(f.manifest, null, 2) + '\n'],
      ['diffuse.png', f.atlas],
      ['uv.bin', f.uv],
    ])
      await writeFile(join(delivery, name), bytes);
    await run({ ...f, dir, delivery, models, output, input: join(delivery, 'manifest.json') });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('explicit disk import preserves exactly the three delivery files and all source GLBs', async () => {
  await withDiskFixture(async (f) => {
    const result = await syncLighting(f.input, f.output, { modelRoot: f.models });
    assert.equal(result.instances, ids.length);
    assert.deepEqual((await readdir(f.output)).sort(), ['diffuse.png', 'manifest.json', 'uv.bin']);
    for (const name of await readdir(f.output))
      assert.deepEqual(
        await readFile(join(f.output, name)),
        await readFile(join(f.delivery, name)),
      );
    for (const [name, bytes] of Object.entries(f.glbs))
      assert.deepEqual(await readFile(join(f.models, `${name}.glb`)), bytes);
    assert.ok(!(await readdir(f.dir)).some((name) => name.startsWith('.lighting-import-')));
  });
});

test('compact disk import preserves metadata and rejects an on-disk occluder change before replacing output', async () => {
  await withDiskFixture(async (f) => {
    const result = await syncLighting(f.input, f.output, { modelRoot: f.models });
    assert.equal(result.instances, ids.length);
    assert.equal(result.uv.bytes, 48);
    for (const name of ['manifest.json', 'diffuse.png', 'uv.bin'])
      assert.deepEqual(
        await readFile(join(f.output, name)),
        await readFile(join(f.delivery, name)),
      );
    await writeFile(join(f.models, 'table.glb'), 'changed nonreceiver GLB');
    const sentinel = Buffer.from('previous accepted lighting');
    for (const name of ['manifest.json', 'diffuse.png', 'uv.bin'])
      await writeFile(join(f.output, name), sentinel);
    await assert.rejects(
      syncLighting(f.input, f.output, { modelRoot: f.models }),
      /Source GLB mismatch: table/,
    );
    for (const name of ['manifest.json', 'diffuse.png', 'uv.bin'])
      assert.deepEqual(await readFile(join(f.output, name)), sentinel);
  }, compactFixture);
});

test('bad hashes, stale layouts and actual on-disk source changes cannot overwrite adopted files', async () => {
  for (const reason of ['atlas', 'layout', 'source']) {
    await withDiskFixture(async (f) => {
      const sentinel = Buffer.from('previous accepted lighting');
      for (const name of ['manifest.json', 'diffuse.png', 'uv.bin'])
        await writeFile(join(f.output, name), sentinel);
      if (reason === 'atlas') await writeFile(join(f.delivery, 'diffuse.png'), 'broken PNG');
      if (reason === 'layout') {
        f.manifest.layout.positions.table[0]++;
        await writeFile(f.input, JSON.stringify(f.manifest));
      }
      if (reason === 'source')
        await writeFile(join(f.models, 'floor.glb'), 'new actual source bytes');
      await assert.rejects(
        syncLighting(f.input, f.output, { modelRoot: f.models }),
        /hash mismatch|Stale lighting layout|Source GLB mismatch/,
      );
      for (const name of ['manifest.json', 'diffuse.png', 'uv.bin'])
        assert.deepEqual(await readFile(join(f.output, name)), sentinel);
    });
  }
});

test('rejects arbitrary input/atlas paths before any import write', async () => {
  await withDiskFixture(async (f) => {
    await assert.rejects(
      syncLighting(join(f.delivery, 'other.json'), f.output),
      /must be manifest.json/,
    );
    f.manifest.atlas.file = '../secret.png';
    await writeFile(f.input, JSON.stringify(f.manifest));
    await assert.rejects(syncLighting(f.input, f.output, { modelRoot: f.models }), /filenames/);
    assert.deepEqual(await readdir(f.output), []);
  });
});

test('receiver selection accepts reviewed subsets and rejects missing or duplicate component IDs', () => {
  const valid = fixture();
  valid.manifest.receiverIds = ['floor', 'left-wall', 'right-wall'];
  assert.doesNotThrow(() => validate(valid));
  for (const selection of [[], ['floor', 'floor'], ['missing'], 'floor']) {
    const f = fixture();
    f.manifest.receiverIds = selection;
    assert.throws(() => validate(f), /receiver selection/);
  }
});
