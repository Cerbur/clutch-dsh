import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

test('official Forge replay, restoration, legacy pools, shared Sessions and subdirectory recovery', { timeout: 60000 }, async (t) => {
  const source = process.env.DSH_NATIVE_SOURCE;
  if (!source) return t.skip('Set DSH_NATIVE_SOURCE to exercise the official Forge owner.');
  const root = path.resolve(source);
  const temp = await mkdtemp(path.join(tmpdir(), 'clutch-native-forge-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const spec = path.join(temp, 'forge.spec.ts');
  const config = path.join(temp, 'vitest.config.mts');
  const template = await readFile(new URL('./fixtures/native-forge-recovery.spec.txt', import.meta.url), 'utf8');
  const code = template.replace(/'__DSH_SOURCE__([^']+)'/gu,
    (_match, suffix) => JSON.stringify(pathToFileURL(path.join(root, suffix)).href));
  await writeFile(spec, code);
  await writeFile(config, [
    'import base from ' + JSON.stringify(pathToFileURL(path.join(root, 'vitest.config.ts')).href),
    'export default { ...base, test: { ...base.test, projects: undefined, include: ' + JSON.stringify([spec]) +
      ', exclude: [], pool: "forks", fileParallelism: false, testTimeout: 20000, hookTimeout: 20000 } }',
  ].join('\n'));
  const result = await promisify(execFile)(process.execPath, [
    path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config, '--reporter=verbose',
  ], { cwd: root, timeout: 55000, maxBuffer: 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  assert.match(result.stdout, /6 passed/u);
  t.diagnostic(result.stdout);
});
