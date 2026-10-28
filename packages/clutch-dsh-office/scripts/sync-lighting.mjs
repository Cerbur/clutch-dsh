import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  kitchenAssetName,
} from '../lib/office/kitchen-layout.js';

const MIB = 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SIGNATURE_VERSION = 'three-attributes-sha256-v1';
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LIGHTING_LIMITS = Object.freeze({ atlasBytes: 24 * MIB, uvBytes: 8 * MIB });
export const CURRENT_LIGHTING_LAYOUT = {
  positions: KITCHEN_PLACEMENT,
  rotations: KITCHEN_ROTATION,
  scales: KITCHEN_SCALE,
};

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value))
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

function sameKeys(actual, expected) {
  return (
    record(actual) && isDeepStrictEqual(Object.keys(actual).sort(), Object.keys(expected).sort())
  );
}

const assetName = kitchenAssetName;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** RGBM is four raw numeric channels, never an sRGB color or premultiplied-alpha texture. */
export function inspectLightingPng(bytes) {
  requireCondition(
    Buffer.isBuffer(bytes) &&
      bytes.length >= 33 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.toString('ascii', 12, 16) === 'IHDR',
    'Invalid or truncated PNG IHDR',
  );
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  requireCondition(
    width > 0 && height > 0 && width <= 4096 && height <= 4096,
    'PNG dimensions exceed 4096',
  );
  requireCondition(
    bytes[24] === 8 && bytes[25] === 6 && bytes[26] === 0 && bytes[27] === 0 && bytes[28] === 0,
    'RGBM atlas must be a non-interlaced 8-bit RGBA PNG',
  );
  let offset = 8;
  let idat = false;
  let ended = false;
  while (offset < bytes.length) {
    requireCondition(offset + 12 <= bytes.length, 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset);
    const end = offset + length + 12;
    requireCondition(end <= bytes.length, 'Truncated PNG chunk payload');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    requireCondition(
      crc32(bytes.subarray(offset + 4, end - 4)) === bytes.readUInt32BE(end - 4),
      `PNG ${type} checksum mismatch`,
    );
    requireCondition(type !== 'IHDR' || offset === 8, 'Duplicate PNG IHDR');
    if (type === 'IDAT') idat = true;
    offset = end;
    if (type === 'IEND') {
      requireCondition(
        length === 0 && offset === bytes.length,
        'Invalid PNG IEND or trailing bytes',
      );
      ended = true;
      break;
    }
  }
  requireCondition(idat && ended, 'PNG must contain IDAT and IEND');
  return { width, height, bitDepth: 8, channels: 4 };
}

/** Pure validation; sourceHashes must come from the current bundled GLB bytes, not manifests. */
export function validateLighting(
  manifest,
  atlasBytes,
  uvBytes,
  { layout = CURRENT_LIGHTING_LAYOUT, sourceHashes } = {},
) {
  requireCondition(
    record(manifest) &&
      manifest.schemaVersion === 1 &&
      manifest.assetId === 'kitchen/lighting' &&
      manifest.status === 'ready' &&
      typeof manifest.revision === 'string' &&
      manifest.revision.length > 0 &&
      (manifest.geometrySignatureVersion === undefined ||
        manifest.geometrySignatureVersion === SIGNATURE_VERSION),
    'Unsupported lighting delivery contract',
  );
  requireCondition(
    manifest.atlas?.file === 'diffuse.png' && manifest.uv?.file === 'uv.bin',
    'Lighting delivery filenames must be diffuse.png and uv.bin',
  );
  const atlas = manifest.atlas;
  const uv = manifest.uv;
  const compact = uv.scope === 'receivers';
  requireCondition(uv.scope === undefined || compact, 'Unsupported UV scope');
  requireCondition(
    !compact || manifest.receiverIds !== undefined,
    'Receiver-scoped UV requires explicit receiverIds',
  );
  requireCondition(
    atlas.encoding === 'RGBM' &&
      Number.isFinite(atlas.range) &&
      atlas.range >= 8 &&
      atlas.range <= 64,
    'Unsupported RGBM encoding or range (expected 8..64)',
  );
  requireCondition(uv.encoding === 'uint16-le-normalized', 'Unsupported UV encoding');
  requireCondition(
    Buffer.isBuffer(atlasBytes) &&
      atlasBytes.length > 0 &&
      atlasBytes.length <= LIGHTING_LIMITS.atlasBytes,
    'Lighting atlas byte budget exceeded',
  );
  requireCondition(
    Buffer.isBuffer(uvBytes) && uvBytes.length > 0 && uvBytes.length <= LIGHTING_LIMITS.uvBytes,
    'Lighting UV byte budget exceeded',
  );
  requireCondition(
    SHA256.test(atlas.sha256) && sha256(atlasBytes) === atlas.sha256,
    'Atlas hash mismatch',
  );
  requireCondition(SHA256.test(uv.sha256) && sha256(uvBytes) === uv.sha256, 'UV hash mismatch');
  requireCondition(
    Number.isSafeInteger(uv.bytes) && uv.bytes === uvBytes.length,
    'UV byte size mismatch',
  );
  const image = inspectLightingPng(atlasBytes);
  requireCondition(
    image.width === atlas.width && image.height === atlas.height,
    'Atlas dimensions differ from manifest',
  );
  requireCondition(
    record(manifest.layout) && isDeepStrictEqual(canonical(manifest.layout), canonical(layout)),
    'Stale lighting layout: positions/rotations/scales differ from current exports',
  );
  const ids = Object.keys(layout.positions);
  requireCondition(
    ids.length > 0 && sameKeys(manifest.instances, layout.positions),
    'Lighting instances must match all current placements',
  );
  requireCondition(
    Array.isArray(manifest.sources) &&
      manifest.sources.length === ids.length &&
      record(sourceHashes),
    'Expected one current GLB source per lighting instance',
  );
  if (manifest.receiverIds !== undefined)
    requireCondition(
      Array.isArray(manifest.receiverIds) &&
        manifest.receiverIds.length > 0 &&
        new Set(manifest.receiverIds).size === manifest.receiverIds.length &&
        manifest.receiverIds.every((id) => ids.includes(id)),
      'Invalid lighting receiver selection',
    );
  const seen = new Set();
  for (const source of manifest.sources) {
    requireCondition(
      record(source) && ids.includes(source.id) && !seen.has(source.id),
      'Invalid or duplicate source instance',
    );
    seen.add(source.id);
    const expectedAssetId = `kitchen/${assetName(source.id)}`;
    requireCondition(
      source.assetId === expectedAssetId &&
        SHA256.test(source.sha256) &&
        source.sha256 === sourceHashes[source.id],
      `Source GLB mismatch: ${source.id}`,
    );
  }
  const spans = [];
  let meshCount = 0;
  let vertexCount = 0;
  for (const id of ids) {
    const meshes = manifest.instances[id];
    const needsUV = !compact || manifest.receiverIds.includes(id);
    requireCondition(Array.isArray(meshes) && meshes.length > 0, `Missing mesh records: ${id}`);
    for (const [index, mesh] of meshes.entries()) {
      requireCondition(
        record(mesh) && mesh.meshIndex === index,
        `Non-consecutive mesh indices: ${id}`,
      );
      requireCondition(
        typeof mesh.name === 'string' &&
          Number.isSafeInteger(mesh.vertexCount) &&
          mesh.vertexCount > 0 &&
          mesh.vertexCount % 3 === 0,
        `Invalid triangle corner vertexCount: ${id}/${index}`,
      );
      requireCondition(
        SHA256.test(mesh.geometrySignature),
        `Invalid geometry signature: ${id}/${index}`,
      );
      if (needsUV) {
        const byteLength = mesh.vertexCount * 4;
        requireCondition(
          Number.isSafeInteger(byteLength) &&
            Number.isSafeInteger(mesh.offset) &&
            mesh.offset >= 0 &&
            mesh.offset % 4 === 0 &&
            Number.isSafeInteger(mesh.offset + byteLength) &&
            mesh.offset + byteLength <= uvBytes.length,
          `UV span out of bounds: ${id}/${index}`,
        );
        spans.push({ offset: mesh.offset, end: mesh.offset + byteLength });
      } else {
        requireCondition(!('offset' in mesh), `Unexpected nonreceiver UV offset: ${id}/${index}`);
      }
      meshCount++;
      vertexCount += mesh.vertexCount;
    }
  }
  spans.sort((a, b) => a.offset - b.offset);
  let end = 0;
  for (const span of spans) {
    requireCondition(span.offset === end, 'UV spans overlap or have non-contiguous offsets');
    end = span.end;
  }
  requireCondition(end === uvBytes.length, 'UV sidecar has unreferenced trailing bytes');
  return {
    assetId: manifest.assetId,
    revision: manifest.revision,
    instances: ids.length,
    meshes: meshCount,
    vertexCount,
    atlas: { ...image, range: atlas.range, bytes: atlasBytes.length, sha256: atlas.sha256 },
    uv: { bytes: uvBytes.length, sha256: uv.sha256 },
  };
}

async function readBounded(path, limit) {
  const info = await stat(path);
  requireCondition(
    info.isFile() && info.size > 0 && info.size <= limit,
    `Lighting file byte budget exceeded: ${basename(path)}`,
  );
  const bytes = await readFile(path);
  requireCondition(
    bytes.length > 0 && bytes.length <= limit,
    `Lighting file byte budget exceeded: ${basename(path)}`,
  );
  return bytes;
}

/** Explicit import only. No GLBs, layout source, library receipts or DSH files are written. */
export async function syncLighting(
  manifestPath,
  output = join(PACKAGE_ROOT, 'assets/lighting/kitchen'),
  {
    modelRoot = join(PACKAGE_ROOT, 'assets/models/kitchen'),
    layout = CURRENT_LIGHTING_LAYOUT,
  } = {},
) {
  requireCondition(
    basename(manifestPath) === 'manifest.json',
    'Lighting input must be manifest.json',
  );
  const manifestBytes = await readBounded(manifestPath, MIB);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  requireCondition(
    manifest.atlas?.file === 'diffuse.png' && manifest.uv?.file === 'uv.bin',
    'Lighting delivery filenames must be diffuse.png and uv.bin',
  );
  const directory = dirname(manifestPath);
  const [atlasBytes, uvBytes] = await Promise.all([
    readBounded(join(directory, 'diffuse.png'), LIGHTING_LIMITS.atlasBytes),
    readBounded(join(directory, 'uv.bin'), LIGHTING_LIMITS.uvBytes),
  ]);
  const sourceHashes = {};
  const hashesByAsset = new Map();
  for (const id of Object.keys(layout.positions)) {
    const name = assetName(id);
    if (!hashesByAsset.has(name))
      hashesByAsset.set(name, sha256(await readFile(join(modelRoot, `${name}.glb`))));
    sourceHashes[id] = hashesByAsset.get(name);
  }
  const facts = validateLighting(manifest, atlasBytes, uvBytes, { layout, sourceHashes });
  // Every check finishes before creating/replacing adopted output; stage complete files first.
  await mkdir(dirname(output), { recursive: true });
  const stage = await mkdtemp(join(dirname(output), '.lighting-import-'));
  try {
    for (const [name, bytes] of [
      ['manifest.json', manifestBytes],
      ['uv.bin', uvBytes],
      ['diffuse.png', atlasBytes],
    ])
      await writeFile(join(stage, name), bytes);
    await mkdir(output, { recursive: true });
    for (const name of ['diffuse.png', 'uv.bin', 'manifest.json'])
      await rename(join(stage, name), join(output, name));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return facts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  requireCondition(
    process.argv.length === 3,
    'Usage: node scripts/sync-lighting.mjs /absolute/delivery/manifest.json',
  );
  process.stdout.write(
    JSON.stringify(await syncLighting(resolve(process.argv[2])), null, 2) + '\n',
  );
}
