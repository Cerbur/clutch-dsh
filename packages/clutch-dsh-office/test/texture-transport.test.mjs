import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { readGlb } from '../scripts/texture-transport.mjs';

const root = new URL('../assets/models/kitchen/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('transport/manifest.json', root)));
const hash = (b) => createHash('sha256').update(b).digest('hex');
test('all transport derivatives preserve every decoded pixel, geometry stream and material contract', async () => {
  let before = 0,
    after = 0;
  for (const [name, entry] of Object.entries(manifest.assets)) {
    const source = await readFile(new URL('optimized/' + name, root));
    const target = await readFile(new URL('transport/' + name, root));
    assert.equal(hash(source), entry.sourceSha256, name);
    assert.equal(hash(target), entry.sha256, name);
    before += source.length;
    after += target.length;
    const a = readGlb(source),
      b = readGlb(target);
    for (const key of [
      'meshes',
      'nodes',
      'materials',
      'accessors',
      'scenes',
      'skins',
      'animations',
    ])
      assert.deepEqual(b.json[key], a.json[key], name + ':' + key);
    const imageViews = new Set((a.json.images ?? []).map((image) => image.bufferView));
    for (const [i, view] of a.json.bufferViews.entries()) {
      const next = b.json.bufferViews[i];
      const slice = (bin, v) => bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
      if (view.buffer === 0) {
        const oldBytes = slice(a.binary, view),
          newBytes = slice(b.binary, next);
        if (imageViews.has(i)) {
          const pixels = (bytes) => sharp(bytes).ensureAlpha().raw().toBuffer();
          assert.deepEqual(await pixels(newBytes), await pixels(oldBytes), name + ': pixels');
        } else assert.deepEqual(newBytes, oldBytes, name + ': geometry');
      }
      if (view.extensions?.EXT_meshopt_compression)
        assert.deepEqual(
          slice(b.binary, next.extensions.EXT_meshopt_compression),
          slice(a.binary, view.extensions.EXT_meshopt_compression),
          name + ': compressed geometry',
        );
    }
    for (const [i, texture] of (a.json.textures ?? []).entries()) {
      const next = b.json.textures[i];
      assert.equal(next.extensions?.EXT_texture_webp?.source ?? next.source, texture.source);
      assert.equal(next.sampler, texture.sampler);
    }
  }
  assert.ok(after < before * 0.8, `${before} -> ${after}`);
});
