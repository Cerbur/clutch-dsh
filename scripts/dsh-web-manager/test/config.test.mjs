import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import {
  expandPath,
  loadConfig,
  resolveDshHome,
  saveConfig,
  setDshHome,
  validateDshHome,
} from '../src/config.mjs';

test('config module', async (t) => {
  let tmpConfigDir;
  let fakeDshRepo;
  const originalDwmDir = process.env.DWM_DIR;
  const originalDshHome = process.env.DSH_HOME;

  before(() => {
    tmpConfigDir = mkdtempSync(path.join(tmpdir(), 'dwm-test-config-'));
    process.env.DWM_DIR = tmpConfigDir;

    fakeDshRepo = mkdtempSync(path.join(tmpdir(), 'fake-dsh-repo-'));
    writeFileSync(
      path.join(fakeDshRepo, 'package.json'),
      JSON.stringify({
        name: '@deepseek-ai/dsh-root',
        scripts: {
          dsh: 'node apps/cli/src/bin.ts',
        },
      }),
      'utf8',
    );
  });

  after(() => {
    if (originalDwmDir !== undefined) {
      process.env.DWM_DIR = originalDwmDir;
    } else {
      delete process.env.DWM_DIR;
    }
    if (originalDshHome !== undefined) {
      process.env.DSH_HOME = originalDshHome;
    } else {
      delete process.env.DSH_HOME;
    }
    try {
      rmSync(tmpConfigDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(fakeDshRepo, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  await t.test('expandPath handles various path types', () => {
    assert.equal(expandPath(''), '');
    assert.ok(path.isAbsolute(expandPath('.')));
    assert.ok(path.isAbsolute(expandPath('./foo')));
    assert.ok(path.isAbsolute(expandPath('~/test')));
  });

  await t.test('validateDshHome validates existing DSH repos and rejects invalid dirs', () => {
    const validCheck = validateDshHome(fakeDshRepo);
    assert.equal(validCheck.valid, true);

    const nonExistent = validateDshHome('/path/does/not/exist/99999');
    assert.equal(nonExistent.valid, false);

    const emptyDir = mkdtempSync(path.join(tmpdir(), 'dwm-empty-'));
    try {
      const emptyCheck = validateDshHome(emptyDir);
      assert.equal(emptyCheck.valid, false);
      assert.match(emptyCheck.reason, /package\.json not found/);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  await t.test('saveConfig and loadConfig write and read custom DWM config', () => {
    saveConfig({ dshHome: fakeDshRepo, customKey: 'hello' });
    const cfg = loadConfig();
    assert.equal(cfg.dshHome, fakeDshRepo);
    assert.equal(cfg.customKey, 'hello');
  });

  await t.test('setDshHome updates config with validated path', () => {
    const res = setDshHome(fakeDshRepo);
    assert.equal(res.success, true);
    assert.equal(res.path, fakeDshRepo);

    const fail = setDshHome('/invalid/dir');
    assert.equal(fail.success, false);
  });

  await t.test('resolveDshHome finds the configured path', () => {
    setDshHome(fakeDshRepo);
    const resolved = resolveDshHome();
    assert.equal(resolved.valid, true);
    assert.equal(resolved.path, fakeDshRepo);
    assert.equal(resolved.source, 'config');
  });

  await t.test('resolveDshHome returns none when no DSH home is configured', () => {
    saveConfig({});
    const resolved = resolveDshHome();
    assert.equal(resolved.valid, false);
    assert.equal(resolved.path, null);
    assert.equal(resolved.source, 'none');
  });
});
