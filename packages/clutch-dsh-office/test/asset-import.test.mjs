import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { ASSET_RULES, inspectGlb, syncAsset, validateAsset } from '../scripts/sync-asset.mjs';

test('bundled delivery matches its manifest and retains both door pivots', async () => {
  const bytes = await readFile(
    new URL('../assets/models/kitchen/refrigerator.glb', import.meta.url),
  );
  const manifest = JSON.parse(
    await readFile(new URL('../assets/models/kitchen/refrigerator.manifest.json', import.meta.url)),
  );
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  const facts = inspectGlb(bytes);
  for (const key of ['triangles', 'meshes', 'materials', 'images'])
    assert.equal(facts[key], manifest.geometry[key]);
  assert.ok(facts.nodes.includes('上门'));
  assert.ok(facts.nodes.includes('下门'));
});

test('a mismatched delivery cannot overwrite an already adopted asset', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'office-asset-test-'));
  try {
    const manifest = JSON.parse(
      await readFile(
        new URL('../assets/models/kitchen/refrigerator.manifest.json', import.meta.url),
      ),
    );
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(dir, 'refrigerator.glb'), 'invalid delivery');
    const adopted = join(dir, 'adopted');
    await mkdir(adopted);
    await writeFile(join(adopted, 'refrigerator.glb'), 'previous accepted asset');
    await assert.rejects(syncAsset(join(dir, 'manifest.json'), adopted), /hash/);
    assert.equal(
      await readFile(join(adopted, 'refrigerator.glb'), 'utf8'),
      'previous accepted asset',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('wall, pendant, sink and character adopt under independent namespaces and budgets', async () => {
  const deliveries = [
    ['utensil-rail', 'kitchen'],
    ['left-wall', 'kitchen'],
    ['pendant-light', 'kitchen'],
    ['sink-cabinet', 'kitchen'],
    ['deepseek', 'character'],
  ];
  for (const [name, namespace] of deliveries) {
    const root = new URL(`../assets/models/${namespace}/${name}`, import.meta.url);
    const bytes = await readFile(new URL(`${root.href}.glb`));
    const manifest = JSON.parse(await readFile(new URL(`${root.href}.manifest.json`)));
    const facts = validateAsset(manifest, bytes);
    assert.equal(facts.assetId, manifest.assetId);
    assert.equal(facts.sha256, manifest.sha256);
    assert.equal(facts.triangles, manifest.geometry.triangles);
    assert.ok(ASSET_RULES[manifest.assetId]);
    for (const node of manifest.requiredNodes) assert.ok(facts.nodes.includes(node), node);
  }
  assert.equal(ASSET_RULES['character/deepseek'].origin, 'feet-ground-center');
  assert.equal(ASSET_RULES['kitchen/refrigerator'].triangles, 30000);
});
