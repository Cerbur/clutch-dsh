import assert from 'node:assert/strict';
import semver from 'semver';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));

test('declares an installable DSH plugin package', () => {
  assert.equal(manifest.name, '@cerbur/clutch-dsh-fireworks');
  assert.equal(manifest.version, '0.1.3');
  assert.deepEqual(manifest.clutchDsh, {
    plugin: '@cerbur/clutch-dsh-fireworks',
    role: 'plugin',
    serviceDefinition: '@cerbur/clutch-dsh-fireworks',
  });
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(manifest.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-session',
  ]);
  assert.equal(manifest.scripts.prepare, undefined);
  assert.equal(manifest.scripts.prepublishOnly, 'pnpm run build');
  for (const script of ['build', 'lint', 'typecheck', 'test']) {
    assert.equal(typeof manifest.scripts[script], 'string');
  }
});

test('accepts the minimum and DSH 0.1.7 prerelease host versions', () => {
  const dshPeerNames = Object.keys(manifest.peerDependencies)
    .filter((name) => name.startsWith('@deepseek-ai/dsh-'))
    .sort();
  assert.deepEqual(dshPeerNames, [
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-session',
    '@deepseek-ai/dsh-session-projection',
    '@deepseek-ai/dsh-tools',
  ]);

  for (const name of dshPeerNames) {
    assert.equal(
      manifest.peerDependencies[name],
      '>=0.1.7-rc.1',
      `${name} peer dependency must be >=0.1.7-rc.1`,
    );
  }

  for (const version of ['0.1.7-rc.1', '0.1.7-rc.2', '0.1.7', '0.1.8']) {
    for (const name of dshPeerNames) {
      const range = manifest.peerDependencies[name];
      assert.equal(
        semver.satisfies(version, range),
        true,
        `${name} must accept DSH ${version} (range: ${range})`,
      );
    }
  }

  for (const version of ['0.1.2-rc.1', '0.1.5-rc.1', '0.1.6']) {
    for (const name of dshPeerNames) {
      const range = manifest.peerDependencies[name];
      assert.equal(
        semver.satisfies(version, range),
        false,
        `${name} must reject DSH ${version} below 0.1.7-rc.1 (range: ${range})`,
      );
    }
  }

  for (const version of ['4.0.1', '4.0.4']) {
    assert.equal(
      semver.satisfies(version, manifest.peerDependencies['@deepseek-ai/cordis']),
      true,
      `@deepseek-ai/cordis must accept ${version}`,
    );
  }
});

test('keeps generated browser artifacts and the patch in the npm file list', () => {
  assert.deepEqual(manifest.files, ['lib', 'cordis.patch.yml', 'assets']);
  assert.equal(manifest.exports['./client'].default, './lib/client.js');
  assert.equal(manifest.exports['./contract'].import, './lib/contract/index.js');
});
