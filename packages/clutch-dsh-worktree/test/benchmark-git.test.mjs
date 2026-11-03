import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { runBenchmarkGit } from '../scripts/benchmark-git.mjs';

test('benchmark Git returns real stdout and rejects command failures', async () => {
  assert.match(await runBenchmarkGit(['--version'], process.cwd()), /^git version /u);
  await assert.rejects(runBenchmarkGit(['--not-a-git-option'], process.cwd()));
});

for (const platform of ['darwin', 'win32']) {
  test(`benchmark Git bounds cleanup even when ${platform} tree never closes`, async () => {
    const calls = [];
    const killed = [];
    const released = [];
    let callback;
    const execute = (file, args, options, done) => {
      calls.push({ file, args, options });
      if (file === 'git') callback = done;
      return {
        pid: 123,
        stdin: { end() {}, destroy() { released.push(file + ':stdin'); } },
        stdout: { destroy() { released.push(file + ':stdout'); } },
        stderr: { destroy() { released.push(file + ':stderr'); } },
        unref() { released.push(file); },
        kill(signal) { killed.push([file, signal]); },
      };
    };
    const start = Date.now();
    await assert.rejects(runBenchmarkGit(['status', '--porcelain'], process.cwd(), {
      timeoutMs: 10, cleanupTimeoutMs: 10, execute, platform,
      kill: (...args) => killed.push(args),
    }), { code: 'ETIMEDOUT', processTreeDidNotExit: true });
    assert.ok(Date.now() - start < 2_000);
    assert.equal(calls[0].options.shell, false);
    assert.equal(calls[0].options.cwd, process.cwd());
    assert.equal(calls[0].options.maxBuffer, 16 * 1024 * 1024);
    assert.ok(released.includes('git:stdout'));
    assert.ok(released.includes('git'));
    if (platform === 'win32') {
      assert.deepEqual(calls[1].args, ['/pid', '123', '/T', '/F']);
      assert.equal(calls[1].options.shell, false);
      assert.ok(released.includes('taskkill.exe'));
    } else {
      assert.equal(calls[0].options.detached, true);
      assert.ok(killed.some(([pid, signal]) => pid === -123 && signal === 'SIGKILL'));
    }
    // A late close cannot change the already rejected operation.
    callback(null, 'late success');
  });
}

test('benchmark Git preserves timeout failure when termination closes the child', async () => {
  let callback;
  await assert.rejects(runBenchmarkGit([], process.cwd(), {
    timeoutMs: 10, cleanupTimeoutMs: 100,
    platform: 'darwin', kill() {},
    execute(_file, _args, _options, done) {
      callback = done;
      return { pid: 123, kill() { callback(null, ''); } };
    },
  }), { code: 'ETIMEDOUT' });
});

test('Windows Git close waits for tree cleanup instead of killing taskkill early', async () => {
  let gitClose;
  let treeClose;
  let taskkillStarted;
  const started = new Promise((resolve) => { taskkillStarted = resolve; });
  let taskkillKilled = false;
  let settled = false;
  const operation = runBenchmarkGit([], process.cwd(), {
    timeoutMs: 10, cleanupTimeoutMs: 1_000, platform: 'win32',
    execute(file, _args, _options, done) {
      if (file === 'git') gitClose = done;
      else { treeClose = done; taskkillStarted(); }
      return { pid: 123, kill() { if (file !== 'git') taskkillKilled = true; }, unref() {} };
    },
  });
  const result = assert.rejects(operation, { code: 'ETIMEDOUT' }).then(() => { settled = true; });
  await started;
  gitClose(null, '');
  await delay(20);
  assert.equal(settled, false);
  assert.equal(taskkillKilled, false);
  treeClose(null);
  await result;
});
