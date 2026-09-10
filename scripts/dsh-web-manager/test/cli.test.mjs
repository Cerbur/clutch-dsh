import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { runCli } from '../src/cli.mjs';

test('cli module', async (t) => {
  let tmpConfigDir;
  let fakeDshRepo;
  const originalDwmDir = process.env.DWM_DIR;
  const originalLog = console.log;
  const originalError = console.error;
  let loggedLines = [];
  let errorLines = [];

  before(() => {
    tmpConfigDir = mkdtempSync(path.join(tmpdir(), 'dwm-test-cli-'));
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
    console.log = originalLog;
    console.error = originalError;
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

  function captureLogs() {
    loggedLines = [];
    errorLines = [];
    console.log = (...args) => loggedLines.push(args.join(' '));
    console.error = (...args) => errorLines.push(args.join(' '));
  }

  function restoreLogs() {
    console.log = originalLog;
    console.error = originalError;
  }

  await t.test('runCli([]) shows help and returns 0', async () => {
    captureLogs();
    try {
      const code = await runCli([]);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('DeepSeek Harness Web Manager')));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["help", "start"]) and ["start", "--help"] show command help', async () => {
    captureLogs();
    try {
      const code1 = await runCli(['help', 'start']);
      assert.equal(code1, 0);
      assert.ok(loggedLines.some((l) => l.includes('dwm start [options] [args...]')));

      loggedLines = [];
      const code2 = await runCli(['start', '--help']);
      assert.equal(code2, 0);
      assert.ok(loggedLines.some((l) => l.includes('dwm start [options] [args...]')));

      loggedLines = [];
      const code3 = await runCli(['home', '-h']);
      assert.equal(code3, 0);
      assert.ok(loggedLines.some((l) => l.includes('dwm home [show]')));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["version"]) prints version and returns 0', async () => {
    captureLogs();
    try {
      const code = await runCli(['version']);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('dwm v')));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["home", path]) sets DSH home', async () => {
    captureLogs();
    try {
      const code = await runCli(['home', fakeDshRepo]);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('DSH home set to:')));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["home", "show"]) displays DSH home', async () => {
    captureLogs();
    try {
      const code = await runCli(['home', 'show']);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('DSH Home Configuration:')));
      assert.ok(loggedLines.some((l) => l.includes(fakeDshRepo)));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["home", "set", path]) sets DSH home explicitly', async () => {
    captureLogs();
    try {
      const code = await runCli(['home', 'set', fakeDshRepo]);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('DSH home set to:')));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["status"]) prints status', async () => {
    captureLogs();
    try {
      const code = await runCli(['status']);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('DSH Home:')));
      assert.ok(loggedLines.some((l) => l.includes('Web Status:')));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["down"]) stops web service gracefully', async () => {
    captureLogs();
    try {
      const code = await runCli(['down']);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('not running')));
    } finally {
      restoreLogs();
    }
  });

  await t.test('runCli(["uninstall"]) executes uninstallation', async () => {
    captureLogs();
    try {
      const code = await runCli(['uninstall']);
      assert.equal(code, 0);
      assert.ok(loggedLines.some((l) => l.includes('uninstallation complete')));
    } finally {
      restoreLogs();
    }
  });

  await t.test(
    'runCli(["start"]) fails with helpful error when no DSH home configured',
    async () => {
      // Clear dshHome in config
      const { saveConfig } = await import('../src/config.mjs');
      saveConfig({});
      captureLogs();
      try {
        const code = await runCli(['start']);
        assert.equal(code, 1);
        assert.ok(errorLines.some((l) => l.includes('No DSH home configured')));
      } finally {
        restoreLogs();
      }
    },
  );

  await t.test('runCli(["unknown-cmd"]) exits with 1', async () => {
    captureLogs();
    try {
      const code = await runCli(['unknown-command-xyz']);
      assert.equal(code, 1);
      assert.ok(errorLines.some((l) => l.includes('Unknown command')));
    } finally {
      restoreLogs();
    }
  });
});
