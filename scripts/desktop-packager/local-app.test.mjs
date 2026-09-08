import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const helper = join(dirname(fileURLToPath(import.meta.url)), 'local-app.mjs');
function install(t, source) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-electron-install-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const desktop = join(root, 'apps/desktop');
  const electron = join(desktop, 'node_modules/electron');
  const typescript = join(desktop, 'node_modules/typescript');
  mkdirSync(electron, { recursive: true });
  mkdirSync(typescript, { recursive: true });
  writeFileSync(join(desktop, 'package.json'), '{}');
  writeFileSync(join(electron, 'package.json'), '{}');
  writeFileSync(join(typescript, 'index.js'), 'module.exports = {}');
  writeFileSync(join(electron, 'install.js'), source);
  const result = spawnSync(process.execPath, [helper, 'electron', root], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
  });
  return { result, electron };
}
test('runs the dependency installer in a fresh tree even when binary downloads were skipped', (t) => {
  const { result, electron } = install(
    t,
    `
    if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) throw new Error('download still disabled');
    require('node:fs').mkdirSync(require('node:path').join(__dirname, 'dist/Electron.app'), {recursive:true});
  `,
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(electron, 'dist/Electron.app')));
});
test('fails if the installer exits successfully without a binary', (t) => {
  const { result } = install(t, '// no binary produced');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /did not produce dist\/Electron.app/);
});
test('propagates a failing Electron installation', (t) => {
  const { result } = install(t, 'process.exit(7)');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /failed: 7/);
});
