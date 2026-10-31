import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimeModelPath } from '../scripts/runtime-models.mjs';
import { inlineAssets } from '../scripts/inline-assets.mjs';
import { fileURLToPath } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const windows = (path) => path.replaceAll('/', '\\');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'office-windows-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const kitchen = join(root, 'assets/models/kitchen');
  await mkdir(join(kitchen, 'optimized'), { recursive: true });
  await mkdir(join(kitchen, 'transport'), { recursive: true });
  const original = Buffer.from('old glossy hood'),
    optimized = Buffer.from('reviewed coated hood'),
    transport = Buffer.from('lossless transport');
  const name = 'range-hood.glb';
  await writeFile(join(kitchen, name), original);
  await writeFile(join(kitchen, 'optimized', name), optimized);
  await writeFile(join(kitchen, 'transport', name), transport);
  await writeFile(
    join(kitchen, 'optimized/manifest.json'),
    JSON.stringify({
      assets: { [name]: { sourceSha256: hash(original), sha256: hash(optimized) } },
    }),
  );
  await writeFile(
    join(kitchen, 'transport/manifest.json'),
    JSON.stringify({
      assets: {
        [name]: { sourceSha256: hash(optimized), sha256: hash(transport), bytes: transport.length },
      },
    }),
  );
  return { root, kitchen, name, optimized, transport };
}

test('backslash paths select the reviewed derivative and still reject corruption', async (t) => {
  const f = await fixture(t);
  const input = windows(join(f.kitchen, f.name));
  assert.equal(await runtimeModelPath(input), join(f.kitchen, 'optimized', f.name));
  await writeFile(join(f.kitchen, 'optimized', f.name), 'damaged');
  await assert.rejects(runtimeModelPath(input), /checksum/);
});

test('Windows importer and module paths produce the same production transport and bake provenance', async (t) => {
  const f = await fixture(t),
    indexFile = join(f.root, 'lib/asset-index.json');
  const plugin = inlineAssets({ mode: 'external', root: f.root, indexFile });
  const id = await plugin.resolveId(
    '../../../../assets/models/kitchen/range-hood.glb?inline',
    windows(join(f.root, 'src/client/scene/kitchen/range-hood.ts')),
  );
  const result = await plugin.load(windows(id));
  const descriptor = JSON.parse(result.code.replace(/^export default /, '').replace(/;$/, ''));
  assert.equal(descriptor.assetId, 'models/kitchen/transport/range-hood.glb');
  assert.equal(descriptor.sha256, hash(f.transport));
  assert.equal(descriptor.bakeSourceSha256, hash(f.optimized));
  await plugin.writeBundle();
  const index = JSON.parse(await readFile(indexFile, 'utf8'));
  assert.equal(index.assets[0].path, 'assets/models/kitchen/transport/range-hood.glb');
  await writeFile(join(f.kitchen, 'transport', f.name), 'damaged');
  await assert.rejects(plugin.load(windows(id)), /checksum/);
});

test('backslash selection matches every real baked source, including the coated hood', async () => {
  const kitchen = fileURLToPath(new URL('../assets/models/kitchen/', import.meta.url));
  const bake = JSON.parse(
    await readFile(new URL('../assets/lighting/kitchen/manifest.json', import.meta.url)),
  );
  let mismatchedOriginals = 0;
  for (const source of bake.sources) {
    const name = source.assetId.split('/').at(-1) + '.glb';
    const original = join(kitchen, name);
    const selected = await runtimeModelPath(windows(original));
    assert.equal(hash(await readFile(selected)), source.sha256, source.id);
    if (hash(await readFile(original)) !== source.sha256) mismatchedOriginals++;
  }
  assert.ok(
    mismatchedOriginals > 0,
    'unselected original GLBs must not masquerade as the baked sources',
  );
});
