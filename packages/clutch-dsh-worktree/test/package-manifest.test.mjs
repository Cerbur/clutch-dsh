import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const packageManifest = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const tsconfig = JSON.parse(
  await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8'),
);

test('prepares Git dependencies from source with the publish build layout', () => {
  assert.equal(packageManifest.packageManager, 'pnpm@10.32.1');
  assert.equal(packageManifest.scripts.prepare, 'pnpm run build');
  assert.equal(packageManifest.scripts.prepack, undefined);
  assert.equal(
    packageManifest.scripts.build,
    'tsc -p tsconfig.json && node scripts/generate-typert.mjs && node scripts/build-client.mjs',
  );
  assert.deepEqual(packageManifest.files, ['lib', 'cordis.patch.yml']);
  assert.equal(tsconfig.compilerOptions.rootDir, 'src');
  assert.equal(tsconfig.compilerOptions.outDir, 'lib');
  assert.ok(tsconfig.compilerOptions.lib.includes('DOM.Iterable'));
});
