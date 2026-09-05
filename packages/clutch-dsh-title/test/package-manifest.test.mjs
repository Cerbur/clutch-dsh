import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const packageDirectory = path.resolve(import.meta.dirname, '..');

test('package manifest exposes a public host-only DSH plugin', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
  );

  assert.equal(packageJson.name, '@cerbur/clutch-dsh-title');
  assert.equal(packageJson.type, 'module');
  assert.equal(packageJson.clutchDsh.role, 'plugin');
  assert.equal(packageJson.clutchDsh.serviceDefinition, '@cerbur/clutch-dsh-title');
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-session-title'], '>=0.1.2-rc.1');
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-session-title-llm'], '>=0.1.2-rc.1');
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-llm'], '>=0.1.2-rc.1');
  assert.equal(packageJson.peerDependencies['@deepseek-ai/dsh-session'], '>=0.1.2-rc.1');
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
});
