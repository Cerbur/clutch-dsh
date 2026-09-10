import console from 'node:console';
import process from 'node:process';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { uninstallDwm } from '../src/uninstall.mjs';
import { getPidPath, getStatePath } from '../src/config.mjs';

test('uninstall module', async (t) => {
  let tmpConfigDir;
  const originalDwmDir = process.env.DWM_DIR;
  const originalLog = console.log;
  const originalError = console.error;

  before(() => {
    tmpConfigDir = mkdtempSync(path.join(tmpdir(), 'dwm-test-uninstall-'));
    process.env.DWM_DIR = tmpConfigDir;
    console.log = () => {};
    console.error = () => {};
  });

  after(() => {
    if (originalDwmDir !== undefined) {
      process.env.DWM_DIR = originalDwmDir;
    } else {
      delete process.env.DWM_DIR;
    }
    console.log = originalLog;
    console.error = originalError;
    try {
      rmSync(tmpConfigDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test('uninstallDwm cleans runtime states without purge', async () => {
    const pidFile = getPidPath();
    const stateFile = getStatePath();
    writeFileSync(pidFile, '12345\n', 'utf8');
    writeFileSync(stateFile, JSON.stringify({ running: false }), 'utf8');

    const res = await uninstallDwm({ purge: false });
    assert.equal(res.success, true);
    assert.equal(existsSync(pidFile), false);
    assert.equal(existsSync(stateFile), false);
    assert.equal(existsSync(tmpConfigDir), true);
  });

  await t.test('uninstallDwm with purge: true deletes entire config directory', async () => {
    const res = await uninstallDwm({ purge: true });
    assert.equal(res.success, true);
    assert.equal(res.purged, true);
    assert.equal(existsSync(tmpConfigDir), false);
  });
});
