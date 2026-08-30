import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));

test('declares an installable DSH plugin package', () => {
  assert.equal(manifest.name, '@cerbur/clutch-dsh-fireworks');
  assert.equal(manifest.version, '0.1.1');
  assert.deepEqual(manifest.clutchDsh, {
    plugin: '@cerbur/clutch-dsh-fireworks',
    role: 'plugin',
    serviceDefinition: '@cerbur/clutch-dsh-fireworks',
  });
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-runtime',
    '@deepseek-ai/dsh-client-ui-layout',
  ]);
  assert.equal(manifest.scripts.prepare, undefined);
  assert.equal(manifest.scripts.prepublishOnly, 'pnpm run build');
  for (const script of ['build', 'lint', 'typecheck', 'test']) {
    assert.equal(typeof manifest.scripts[script], 'string');
  }
});

test('accepts the DSH prerelease lines used by the package build', () => {
  assert.deepEqual(manifest.peerDependencies, {
    '@deepseek-ai/cordis': '4.0.1',
    '@deepseek-ai/dsh-client-runtime': '>=0.1.1-rc.2 <0.2.0-0',
    '@deepseek-ai/dsh-client-ui-layout': '>=0.1.1-rc.2 <0.2.0-0',
    '@deepseek-ai/dsh-client-ui-slots': '>=0.1.1-rc.2 <0.2.0-0',
    '@deepseek-ai/dsh-session': '>=0.1.1-rc.2 <0.2.0-0',
    '@deepseek-ai/dsh-session-projection': '>=0.1.1-rc.2 <0.2.0-0',
    '@deepseek-ai/dsh-tools': '>=0.1.0-rc.8 <0.2.0-0',
  });
});

test('keeps generated browser artifacts and the patch in the npm file list', () => {
  assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml', 'assets']);
  assert.equal(manifest.exports['./client'].default, './lib/client.js');
  assert.equal(manifest.exports['./contract'].import, './lib/contract/index.js');
});
