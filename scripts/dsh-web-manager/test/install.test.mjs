import process from 'node:process';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const installScript = path.resolve(__dirname, '..', 'install.sh');

test('install script', async (t) => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dwm-install-test-'));
  });

  after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test('install.sh --help exits with 0 and prints usage', () => {
    const res = spawnSync('bash', [installScript, '--help'], { encoding: 'utf8' });
    assert.equal(res.status, 0);
    assert.match(res.stdout, /DeepSeek Harness Web Manager \(dwm\) Installer/);
    assert.match(res.stdout, /Usage: bash install\.sh/);
  });

  await t.test('install.sh fails gracefully when missing required tools', () => {
    // Fake environment where git/npm/node is missing:
    // Create a bin with only minimal utilities (like echo, sh, etc.) but no node/git/npm
    const fakeBin = path.join(tmpDir, 'bin-no-tools');
    mkdirSync(fakeBin, { recursive: true });
    // Provide a fake node that fails requirement or missing git
    const fakeNode = path.join(fakeBin, 'node');
    writeFileSync(fakeNode, '#!/bin/sh\necho "v14.0.0"\n', { mode: 0o755 });

    const res = spawnSync('bash', [installScript], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr || '', /Node\.js 18\+ is required/);
  });
});
