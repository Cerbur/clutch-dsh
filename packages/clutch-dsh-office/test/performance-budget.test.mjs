import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

test('production Client keeps binaries out of JS and the baked shell within its memory budget', async () => {
  const client = new URL('../lib/client.js', import.meta.url);
  assert.ok((await stat(client)).size < 3 * 1024 * 1024, 'Client JS must stay below 3MiB');
  const manifest = JSON.parse(
    await readFile(new URL('../assets/lighting/kitchen/manifest.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual([...manifest.receiverIds].sort(), ['floor', 'left-wall', 'right-wall']);
  assert.equal(manifest.uv.scope, 'receivers');
  assert.ok(manifest.atlas.width * manifest.atlas.height * 4 <= 16 * 1024 * 1024);
  assert.ok(manifest.uv.bytes < 64 * 1024);
  const index = JSON.parse(
    await readFile(new URL('../lib/asset-index.json', import.meta.url), 'utf8'),
  );
  assert.equal(index.assets.filter((a) => a.assetId.endsWith('.glb')).length, 29);
  assert.equal(index.assets.filter((a) => a.assetId === 'models/kitchen/floor-mat.glb').length, 1);
  const script = await readFile(client, 'utf8');
  for (const asset of index.assets) {
    assert.ok(
      script.includes(asset.sha256),
      asset.assetId + ' must have a content-addressed descriptor',
    );
    if (asset.bytes > 1024 * 1024) {
      const file = await readFile(new URL('../' + asset.path, import.meta.url));
      assert.equal(
        script.includes(file.subarray(0, 1024).toString('base64')),
        false,
        'large binary must not be embedded',
      );
    }
  }
});
