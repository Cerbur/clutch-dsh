import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { spawnSync } from 'node:child_process';
import { upgradeDwm } from '../src/upgrade.mjs';

test('upgrade module', async (t) => {
  let tmpDir;
  let dummyScript;
  let failingScript;

  before(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'dwm-test-upgrade-'));

    dummyScript = path.join(tmpDir, 'mock-upgrade.sh');
    writeFileSync(
      dummyScript,
      '#!/usr/bin/env bash\nif [ "$DWM_REF" = "test-ref" ]; then echo "ref-matched"; fi\necho "mock upgrade success"\nexit 0\n',
      'utf8',
    );
    chmodSync(dummyScript, 0o755);

    failingScript = path.join(tmpDir, 'mock-fail.sh');
    writeFileSync(
      failingScript,
      '#!/usr/bin/env bash\necho "mock upgrade failure" >&2\nexit 42\n',
      'utf8',
    );
    chmodSync(failingScript, 0o755);
  });

  after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test('upgradeDwm succeeds when script succeeds', async () => {
    const res = await upgradeDwm({ scriptPath: dummyScript, silent: true });
    assert.equal(res.success, true);
  });

  await t.test('upgradeDwm passes ref to environment', async () => {
    const res = await upgradeDwm({ scriptPath: dummyScript, ref: 'test-ref', silent: true });
    assert.equal(res.success, true);
  });

  await t.test('upgradeDwm reports failure when script fails', async () => {
    const res = await upgradeDwm({ scriptPath: failingScript, silent: true });
    assert.equal(res.success, false);
    assert.ok(res.error.includes('exit code 42'));
  });

  await t.test('upgrade.sh --help works', async () => {
    const script = path.resolve('upgrade.sh');
    const child = spawnSync('bash', [script, '--help'], { encoding: 'utf8' });
    assert.equal(child.status, 0);
    assert.ok(child.stdout.includes('DeepSeek Harness Web Manager (dwm) Upgrader'));
    assert.ok(child.stdout.includes('Usage: bash upgrade.sh'));
  });
});
