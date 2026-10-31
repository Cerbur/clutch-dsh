import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { runtimeModelPath } from '../scripts/runtime-models.mjs';
import { geometryOnlyGlb } from '../scripts/export-lighting-geometry.mjs';
const root = new URL('../assets/models/kitchen/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('optimized/manifest.json', root)));
const hash = (b) => createHash('sha256').update(b).digest('hex');

test('production medium GLBs decode with the actual Three decoder, retaining primitive counts and reducing real geometry', async () => {
  let before = 0,
    after = 0,
    originalVertices = 0,
    optimizedVertices = 0;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  for (const [name, entry] of Object.entries(manifest.assets)) {
    const original = await readFile(new URL(name, root));
    assert.equal(hash(original), entry.sourceSha256, 'adopted source remains intact: ' + name);
    const path = await runtimeModelPath(new URL(name, root).pathname);
    const bytes = await readFile(path);
    assert.equal(hash(bytes), entry.sha256);
    const parse = async (b) => {
      const stripped = geometryOnlyGlb(b);
      return (
        await loader.parseAsync(
          stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.length),
          '',
        )
      ).scene;
    };
    const a = await parse(original),
      b = await parse(bytes);
    const counts = (scene, unique = false) => {
      let tri = 0,
        vert = 0,
        prim = 0;
      scene.traverse((o) => {
        if (o.isMesh) {
          if (unique && o.geometry.index) {
            const seen = new Set(),
              index = o.geometry.index;
            for (let i = 0; i < index.count; i += 3) {
              const key = [index.getX(i), index.getX(i + 1), index.getX(i + 2)]
                .sort((a, b) => a - b)
                .join(',');
              assert.equal(
                seen.has(key),
                false,
                name + ': duplicate face in decoded runtime geometry',
              );
              seen.add(key);
            }
          }
          tri += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
          vert += o.geometry.attributes.position.count;
          prim++;
          o.geometry.dispose();
          o.material.dispose();
        }
      });
      return { tri, vert, prim };
    };
    const ac = counts(a),
      bc = counts(b, true);
    assert.equal(ac.prim, bc.prim, name);
    assert.equal(bc.tri, entry.triangles, name);
    assert.ok(bc.tri <= ac.tri, name);
    before += ac.tri;
    after += bc.tri;
    originalVertices += ac.vert;
    optimizedVertices += bc.vert;
  }
  assert.ok(after < before * 0.8, `${before} -> ${after} triangles`);
  assert.ok(
    optimizedVertices < originalVertices * 0.9,
    `${originalVertices} -> ${optimizedVertices} vertices`,
  );
});

test('build rejects a stale or corrupt optimized derivative before publishing an asset descriptor', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'office-derivative-test-'));
  const dir = join(temp, 'models/kitchen');
  try {
    await mkdir(join(dir, 'optimized'), { recursive: true });
    const original = Buffer.from('original'),
      variant = Buffer.from('variant');
    const path = join(dir, 'test.glb');
    await writeFile(path, original);
    await writeFile(join(dir, 'optimized/test.glb'), variant);
    await writeFile(
      join(dir, 'optimized/manifest.json'),
      JSON.stringify({
        assets: { 'test.glb': { sourceSha256: hash(original), sha256: hash(variant) } },
      }),
    );
    assert.equal(await runtimeModelPath(path), join(dir, 'optimized/test.glb'));
    await writeFile(join(dir, 'optimized/test.glb'), 'corrupt');
    await assert.rejects(runtimeModelPath(path), /checksum/);
    await writeFile(path, 'changed source');
    await assert.rejects(runtimeModelPath(path), /Stale derivative/);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
