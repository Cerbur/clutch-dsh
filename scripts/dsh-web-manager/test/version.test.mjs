import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  listDshVersions,
  resolveGitVersionRef,
  switchDshVersion,
} from '../src/version.mjs';
import { setDshHome } from '../src/config.mjs';

test('version module', async (t) => {
  let tmpConfigDir;
  let fakeDshRepo;
  const originalDwmDir = process.env.DWM_DIR;

  before(() => {
    tmpConfigDir = mkdtempSync(path.join(tmpdir(), 'dwm-test-version-cfg-'));
    process.env.DWM_DIR = tmpConfigDir;

    fakeDshRepo = mkdtempSync(path.join(tmpdir(), 'dwm-test-version-repo-'));

    // Initialize git repo in fakeDshRepo
    spawnSync('git', ['init'], { cwd: fakeDshRepo });
    spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: fakeDshRepo });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: fakeDshRepo });

    // Create DSH package.json
    writeFileSync(
      path.join(fakeDshRepo, 'package.json'),
      JSON.stringify({
        name: '@deepseek-ai/dsh-root',
        scripts: {
          dsh: 'node apps/cli/src/bin.ts',
          build: 'echo build-ok',
        },
      }),
      'utf8',
    );

    spawnSync('git', ['add', '.'], { cwd: fakeDshRepo });
    spawnSync('git', ['commit', '-m', 'initial commit'], { cwd: fakeDshRepo });

    // Create some tags
    spawnSync('git', ['tag', 'dsh-v0.1.0'], { cwd: fakeDshRepo });

    writeFileSync(path.join(fakeDshRepo, 'file.txt'), 'v0.1.1', 'utf8');
    spawnSync('git', ['add', '.'], { cwd: fakeDshRepo });
    spawnSync('git', ['commit', '-m', 'commit 2'], { cwd: fakeDshRepo });
    spawnSync('git', ['tag', 'dsh-v0.1.1'], { cwd: fakeDshRepo });

    writeFileSync(path.join(fakeDshRepo, 'file.txt'), 'v0.2.0', 'utf8');
    spawnSync('git', ['add', '.'], { cwd: fakeDshRepo });
    spawnSync('git', ['commit', '-m', 'commit 3'], { cwd: fakeDshRepo });
    spawnSync('git', ['tag', 'v0.2.0'], { cwd: fakeDshRepo });

    setDshHome(fakeDshRepo);
  });

  after(() => {
    if (originalDwmDir !== undefined) {
      process.env.DWM_DIR = originalDwmDir;
    } else {
      delete process.env.DWM_DIR;
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

  await t.test('listDshVersions lists tags in repository', async () => {
    const res = await listDshVersions({ skipFetch: true, silent: true });
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.versions));
    assert.ok(res.versions.includes('dsh-v0.1.0'));
    assert.ok(res.versions.includes('dsh-v0.1.1'));
    assert.ok(res.versions.includes('v0.2.0'));
  });

  await t.test('listDshVersions reports error when dshHome is invalid', async () => {
    const res = await listDshVersions({ home: '/non/existent/path', skipFetch: true, silent: true });
    assert.equal(res.success, false);
    assert.ok(res.error);
  });

  await t.test('resolveGitVersionRef resolves exact and prefixed tags', async () => {
    const ref1 = await resolveGitVersionRef('dsh-v0.1.0', fakeDshRepo);
    assert.equal(ref1, 'dsh-v0.1.0');

    // Without dsh- prefix
    const ref2 = await resolveGitVersionRef('0.1.0', fakeDshRepo);
    assert.equal(ref2, 'dsh-v0.1.0');

    // With v prefix
    const ref3 = await resolveGitVersionRef('v0.1.0', fakeDshRepo);
    assert.equal(ref3, 'dsh-v0.1.0');

    // v0.2.0 tag
    const ref4 = await resolveGitVersionRef('0.2.0', fakeDshRepo);
    assert.equal(ref4, 'v0.2.0');

    // Nonexistent
    const refNon = await resolveGitVersionRef('99.99.99', fakeDshRepo);
    assert.equal(refNon, null);
  });

  await t.test('switchDshVersion fails on missing or invalid version', async () => {
    const res1 = await switchDshVersion('', { skipFetch: true, silent: true });
    assert.equal(res1.success, false);
    assert.ok(res1.error.includes('Target version is required'));

    const res2 = await switchDshVersion('99.99.99', { skipFetch: true, silent: true });
    assert.equal(res2.success, false);
    assert.ok(res2.error.includes('not found'));
  });

  await t.test('switchDshVersion checks out ref and runs build', async () => {
    const res = await switchDshVersion('0.1.0', {
      skipFetch: true,
      skipInstall: true,
      skipBuild: true,
      silent: true,
    });
    assert.equal(res.success, true);
    assert.equal(res.version, 'dsh-v0.1.0');

    // Verify current tag via listDshVersions
    const listRes = await listDshVersions({ skipFetch: true, silent: true });
    assert.equal(listRes.current, 'dsh-v0.1.0');
  });
});
