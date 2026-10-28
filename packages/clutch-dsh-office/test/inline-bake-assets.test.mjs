import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inlineAssets } from '../scripts/inline-assets.mjs';

test('all inline extensions load as JavaScript modules and preserve PNG alpha/binary/JSON bytes', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'office-inline-bake-'));
  try {
    const plugin = inlineAssets(),
      bytes = Buffer.from([0, 255, 127, 10, 34]);
    for (const extension of ['glb', 'png', 'bin', 'json']) {
      const file = join(folder, 'asset.' + extension);
      await writeFile(file, bytes);
      const id = plugin.resolveId('./asset.' + extension + '?inline', join(folder, 'entry.js'));
      const module = await plugin.load(id);
      // The virtual ID retains .json/.png/.bin: Rolldown must not infer its parser.
      assert.equal(
        typeof module,
        'object',
        extension + ' must return an explicit module descriptor',
      );
      assert.equal(module.moduleType, 'js', extension + ' must bypass extension-based parsing');
      assert.equal(typeof module.code, 'string');
      const base64 = JSON.parse(module.code.slice('export default '.length, -1));
      assert.deepEqual(Buffer.from(base64, 'base64'), bytes);
      const executed = await import(
        'data:text/javascript;base64,' + Buffer.from(module.code).toString('base64')
      );
      assert.deepEqual(Buffer.from(executed.default, 'base64'), bytes);
    }
    assert.equal(plugin.resolveId('./other.svg?inline', join(folder, 'entry.js')), null);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
