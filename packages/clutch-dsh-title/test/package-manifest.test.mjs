import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { EMOJI_TEMPLATE } from '../lib/templates.js';

const packageDirectory = path.resolve(import.meta.dirname, '..');

test('package manifest exposes a public DSH plugin with a settings browser entry', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.name, '@cerbur/clutch-dsh-title');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.exports['./client'].default, './lib/client.js');
  assert.equal(packageJson.dsh.client.platform, 'web');
  assert.ok(packageJson.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'));
  assert.equal(packageJson.clutchDsh.role, 'plugin');
  assert.equal(packageJson.clutchDsh.serviceDefinition, '@cerbur/clutch-dsh-title');
  assert.equal(packageJson.publishConfig.access, 'public');
  const supportedDshVersions = '>=0.1.2-rc.1 || >=0.1.7-rc.1';
  assert.equal(
    packageJson.peerDependencies['@deepseek-ai/dsh-session-title'],
    supportedDshVersions,
  );
  assert.equal(
    packageJson.peerDependencies['@deepseek-ai/dsh-session-title-llm'],
    supportedDshVersions,
  );
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-llm'], supportedDshVersions);
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-session'], supportedDshVersions);
  assert.equal(packageJson.peerDependencies['@deepseek-ai/cordis'], '^4.0.1');
  assert.equal(packageJson.dependencies['@deepseek-ai/schemastery'], '^3.18.4');
  assert.equal(packageJson.scripts.prepublishOnly, 'pnpm run build');
  assert.equal(packageJson.scripts.test, 'pnpm run build && node --test test/*.test.mjs');
  assert.deepEqual(packageJson.files, ['lib', 'cordis.patch.yml', 'assets']);
});

test('bundle patch disables the default provider before inserting this provider', async () => {
  const patch = await readFile(path.join(packageDirectory, 'cordis.patch.yml'), 'utf8');

  assert.match(
    patch,
    /id:\s*session-title-llm[\s\S]*name:\s*['"]@deepseek-ai\/dsh-session-title-first-prompt-llm['"][\s\S]*disabled:\s*true/,
  );
  assert.match(
    patch,
    /id:\s*clutch-dsh-title[\s\S]*name:\s*['"]@cerbur\/clutch-dsh-title['"][\s\S]*config:\s*[\s\S]*preset:\s*default/,
  );
  const patches = parse(patch);
  const config = patches
    .flatMap((entry) => entry.insert ?? [])
    .find((entry) => entry.id === 'clutch-dsh-title')?.config;
  assert.ok(config);
  assert.deepEqual(parse(config.templates.emoji), parse(EMOJI_TEMPLATE));
});
