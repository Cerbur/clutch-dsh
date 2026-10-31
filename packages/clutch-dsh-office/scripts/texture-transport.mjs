import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import process from 'node:process';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function readGlb(bytes) {
  const size = bytes.readUInt32LE(12);
  return { json: JSON.parse(bytes.subarray(20, 20 + size)), binary: bytes.subarray(28 + size) };
}
function writeGlb(json, binary) {
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(padded);
  const bin = Buffer.alloc(Math.ceil(binary.length / 4) * 4);
  binary.copy(bin);
  const result = Buffer.alloc(28 + padded.length + bin.length);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(result, 20);
  result.writeUInt32LE(bin.length, 20 + padded.length);
  result.writeUInt32LE(0x004e4942, 24 + padded.length);
  bin.copy(result, 28 + padded.length);
  return result;
}

/** Repack only image bufferViews. Geometry (including compressed streams) stays byte exact. */
export async function compressTextureTransport(bytes) {
  const { json, binary } = readGlb(bytes);
  const replacement = new Map();
  const converted = [];
  for (const [index, image] of (json.images ?? []).entries()) {
    if (image.mimeType !== 'image/png') continue;
    const view = json.bufferViews[image.bufferView];
    if (view.buffer !== 0) throw new Error('Image outside binary buffer');
    const original = binary.subarray(
      view.byteOffset ?? 0,
      (view.byteOffset ?? 0) + view.byteLength,
    );
    const webp = await sharp(original).webp({ lossless: true, effort: 6 }).toBuffer();
    if (webp.length >= original.length) continue;
    const pixels = async (b) => sharp(b).ensureAlpha().raw().toBuffer();
    if (!(await pixels(original)).equals(await pixels(webp))) throw new Error('Non-lossless image');
    replacement.set(image.bufferView, webp);
    image.mimeType = 'image/webp';
    converted.push(index);
  }
  if (!converted.length) return bytes;
  for (const texture of json.textures ?? []) {
    if (!converted.includes(texture.source)) continue;
    texture.extensions ??= {};
    texture.extensions.EXT_texture_webp = { source: texture.source };
    delete texture.source;
  }
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'EXT_texture_webp'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'EXT_texture_webp'])];
  const chunks = [];
  let offset = 0;
  const append = (data) => {
    const start = offset;
    chunks.push(data);
    offset += data.length;
    const padding = (4 - (offset % 4)) % 4;
    chunks.push(Buffer.alloc(padding));
    offset += padding;
    return start;
  };
  for (const [i, view] of json.bufferViews.entries()) {
    if (view.buffer === 0) {
      const data =
        replacement.get(i) ??
        binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      view.byteOffset = append(data);
      view.byteLength = data.length;
    }
    const compressed = view.extensions?.EXT_meshopt_compression;
    if (compressed?.buffer === 0) {
      const data = binary.subarray(
        compressed.byteOffset ?? 0,
        (compressed.byteOffset ?? 0) + compressed.byteLength,
      );
      compressed.byteOffset = append(data);
    }
  }
  json.buffers[0].byteLength = offset;
  return writeGlb(json, Buffer.concat(chunks));
}

export async function generateTextureTransport(root) {
  const sourceDir = join(root, 'assets/models/kitchen/optimized');
  const targetDir = join(root, 'assets/models/kitchen/transport');
  const source = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8'));
  const manifest = { schemaVersion: 1, encoding: 'lossless-webp-png-only', assets: {} };
  await mkdir(targetDir, { recursive: true });
  for (const [name, entry] of Object.entries(source.assets)) {
    const original = await readFile(join(sourceDir, name));
    if (hash(original) !== entry.sha256) throw new Error('Source checksum mismatch: ' + name);
    const bytes = await compressTextureTransport(original);
    await writeFile(join(targetDir, name), bytes);
    manifest.assets[name] = {
      sourceSha256: hash(original),
      sha256: hash(bytes),
      sourceBytes: original.length,
      bytes: bytes.length,
    };
    process.stdout.write(`${name}: ${original.length} -> ${bytes.length}\n`);
  }
  await writeFile(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await generateTextureTransport(fileURLToPath(new URL('..', import.meta.url)));
