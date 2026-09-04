import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { LocalGitAdapter } from '../lib/index.js';

function collectedReader(text, lossy = false) {
  return {
    readFrom(fromByte) {
      assert.equal(fromByte, 0);
      return {
        text,
        nextOffset: Buffer.byteLength(text),
        lossy,
      };
    },
  };
}

function createFakeRuntime({
  stdout = '',
  stderr = '',
  lossy = false,
  outcome = { exitCode: 0, signal: null },
  resolveError,
  pending = false,
  responses = [],
} = {}) {
  const resolveCalls = [];
  const spawnCalls = [];
  const handles = [];
  return {
    resolveCalls,
    spawnCalls,
    handles,
    async resolveExecutable(command, env, signal) {
      resolveCalls.push({ command, env, signal });
      if (resolveError) throw resolveError;
      return '/execution-world/bin/git';
    },
    spawn(spec) {
      spawnCalls.push(spec);
      const response = responses[spawnCalls.length - 1] ?? {};
      const responseStdout = response.stdout ?? stdout;
      const responseStderr = response.stderr ?? stderr;
      const responseLossy = response.lossy ?? lossy;
      const responseOutcome = response.outcome ?? outcome;
      let resolveDone;
      const done = pending
        ? new Promise((resolve) => {
          resolveDone = resolve;
        })
        : Promise.resolve(responseOutcome);
      const finish = () => resolveDone?.(responseOutcome);
      const handle = {
        pid: 42,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: collectedReader(responseStdout, responseLossy),
          stderr: collectedReader(responseStderr, responseLossy),
        },
        done,
        terminated: false,
        terminate() {
          this.terminated = true;
          finish();
        },
        async waitForExit() {
          await done;
          return true;
        },
      };
      handles.push(handle);
      spec.signal?.addEventListener('abort', () => {
        handle.terminated = true;
        finish();
      }, { once: true });
      if (spec.signal?.aborted) finish();
      return handle;
    },
  };
}

test('runs Git through the injected DSH subprocess runtime with explicit direct argv', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = createFakeRuntime({ stdout: 'main\0feature/x\0' });
    const git = new LocalGitAdapter({
      subprocess: runtime,
      timeoutMs: 500,
      graceMs: 25,
      maxOutputBytes: 1024,
    });

    assert.deepEqual(await git.listBranches(workspaceRoot), ['main', 'feature/x']);
    assert.deepEqual(runtime.resolveCalls.map(({ command }) => command), ['git']);
    assert.deepEqual(runtime.spawnCalls[0].argv, [
      '/execution-world/bin/git',
      'for-each-ref',
      '--format=%(refname:short)%00',
      'refs/heads/',
    ]);
    assert.equal(runtime.spawnCalls[0].cwd, workspaceRoot);
    assert.equal(runtime.spawnCalls[0].stdio.stdin, 'ignore');
    assert.deepEqual(runtime.spawnCalls[0].stdio.stdout, { maxBytes: 1024 });
    assert.deepEqual(runtime.spawnCalls[0].stdio.stderr, { maxBytes: 1024 });
    assert.equal(runtime.spawnCalls[0].graceMs, 25);
    assert.equal(runtime.spawnCalls[0].env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(runtime.spawnCalls[0].env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(runtime.spawnCalls[0].env.GIT_DIR, undefined);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('reads branch checkout paths with one NUL-delimited for-each-ref invocation', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = createFakeRuntime({ stdout: `main\0${workspaceRoot}\0\nfeature/x\0\0\n` });
    const git = new LocalGitAdapter({ subprocess: runtime });

    assert.deepEqual(await git.listBranchesWithWorktreePaths(workspaceRoot), [
      { name: 'main', worktreePath: workspaceRoot },
      { name: 'feature/x' },
    ]);
    assert.equal(runtime.spawnCalls.length, 1);
    assert.deepEqual(runtime.spawnCalls[0].argv.slice(1), [
      'for-each-ref',
      '--format=%(refname:short)%00%(worktreepath)%00',
      'refs/heads/',
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('falls back to separate branch and worktree reads when worktreepath is unsupported', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = createFakeRuntime({
      responses: [
        {
          stderr: 'fatal: unknown field name: worktreepath\n',
          outcome: { exitCode: 128, signal: null },
        },
        { stdout: 'main\0feature/x\0' },
        { stdout: `worktree ${workspaceRoot}\nHEAD 0123456789abcdef0123456789abcdef01234567\nbranch refs/heads/main\n\n` },
      ],
    });
    const git = new LocalGitAdapter({ subprocess: runtime });

    assert.deepEqual(await git.listBranchesWithWorktreePaths(workspaceRoot), [
      { name: 'main', worktreePath: workspaceRoot },
      { name: 'feature/x' },
    ]);
    assert.equal(runtime.spawnCalls.length, 3);
    assert.deepEqual(runtime.spawnCalls.slice(1).map(({ argv }) => argv.slice(1)), [
      ['for-each-ref', '--format=%(refname:short)%00', 'refs/heads/'],
      ['worktree', 'list', '--porcelain'],
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('resolves repository identity with one direct rev-parse invocation', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    await mkdir(path.join(workspaceRoot, '.git'));
    const headCommit = '0123456789abcdef0123456789abcdef01234567';
    const runtime = createFakeRuntime({
      stdout: `${workspaceRoot}\n${path.join(workspaceRoot, '.git')}\n${headCommit}\n`,
    });
    const git = new LocalGitAdapter({ subprocess: runtime });

    const inspection = await git.resolveRepositoryIdentity(workspaceRoot);

    assert.deepEqual(inspection, {
      identity: {
        topLevel: await realpath(workspaceRoot),
        commonDirectory: await realpath(path.join(workspaceRoot, '.git')),
      },
      headCommit,
    });
    assert.deepEqual(runtime.resolveCalls.map(({ command }) => command), ['git']);
    assert.equal(runtime.spawnCalls.length, 1);
    assert.deepEqual(runtime.spawnCalls[0].argv.slice(1), [
      'rev-parse',
      '--show-toplevel',
      '--git-common-dir',
      '--verify',
      'HEAD^{commit}',
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('maps a runtime executable-resolution failure to the stable missing-Git error', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const missing = Object.assign(new Error('git was not found'), { code: 'ENOENT' });
    const runtime = createFakeRuntime({ resolveError: missing });
    const git = new LocalGitAdapter({ subprocess: runtime });

    await assert.rejects(git.listBranches(workspaceRoot), (error) => {
      assert.equal(error?.code, 'GIT_NOT_INSTALLED');
      assert.equal(error?.details?.gitExitCode, 'ENOENT');
      assert.deepEqual(error?.details?.gitArgs, [
        'for-each-ref',
        '--format=%(refname:short)%00',
        'refs/heads/',
      ]);
      return true;
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('preserves runtime non-zero exit diagnostics through Provider error mapping', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = createFakeRuntime({
      stderr: 'fatal: repository is unavailable\n',
      outcome: { exitCode: 128, signal: null },
    });
    const git = new LocalGitAdapter({ subprocess: runtime });

    await assert.rejects(git.listBranches(workspaceRoot), (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitExitCode, 128);
      assert.equal(error?.details?.gitStderr, 'fatal: repository is unavailable\n');
      assert.equal(error?.details?.workspaceRoot, workspaceRoot);
      return true;
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('classifies runtime deadline cancellation separately from caller abort', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const timedOutRuntime = createFakeRuntime({ pending: true });
    const timedOutGit = new LocalGitAdapter({
      subprocess: timedOutRuntime,
      timeoutMs: 20,
      graceMs: 10,
    });
    await assert.rejects(timedOutGit.listBranches(workspaceRoot), (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitTimedOut, true);
      assert.equal(error?.details?.gitAborted, undefined);
      return true;
    });
    assert.equal(timedOutRuntime.handles[0].terminated, true);

    const abortController = new globalThis.AbortController();
    const abortedRuntime = createFakeRuntime({ pending: true });
    const abortedGit = new LocalGitAdapter({
      subprocess: abortedRuntime,
      timeoutMs: 5_000,
      graceMs: 10,
    });
    const pending = abortedGit.listBranches(workspaceRoot, { signal: abortController.signal });
    await delay(20);
    abortController.abort();
    await assert.rejects(pending, (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitTimedOut, undefined);
      assert.equal(error?.details?.gitAborted, true);
      return true;
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('returns a bounded provider error when the subprocess tree never settles', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    let terminateCalls = 0;
    let cleanupSignal;
    const runtime = {
      async resolveExecutable() {
        return '/execution-world/bin/git';
      },
      spawn() {
        const handle = {
          pid: 42,
          stdin: undefined,
          stdout: undefined,
          stderr: undefined,
          collected: {
            stdout: collectedReader(''),
            stderr: collectedReader(''),
          },
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate() {
            terminateCalls += 1;
          },
          waitForExit(signal) {
            cleanupSignal = signal;
            return new Promise((resolve) => {
              if (signal?.aborted) {
                resolve(false);
                return;
              }
              signal?.addEventListener('abort', () => resolve(false), { once: true });
            });
          },
        };
        return handle;
      },
    };
    const git = new LocalGitAdapter({
      subprocess: runtime,
      timeoutMs: 500,
      graceMs: 5,
      cleanupTimeoutMs: 20,
    });

    const operation = git.listBranches(workspaceRoot);
    await assert.rejects(
      Promise.race([
        operation,
        delay(250).then(() => {
          throw new Error('provider did not bound subprocess cleanup');
        }),
      ]),
      (error) => {
        assert.equal(error?.code, 'GIT_OPERATION_FAILED');
        assert.equal(error?.details?.gitTimedOut, undefined);
        assert.equal(error?.details?.gitProcessTreeDidNotExit, true);
        return true;
      },
    );
    assert.equal(terminateCalls, 1);
    assert.equal(cleanupSignal?.aborted, true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('does not classify command-deadline expiration during post-completion cleanup as a Git timeout', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = {
      async resolveExecutable() {
        return '/execution-world/bin/git';
      },
      spawn() {
        return {
          pid: 42,
          stdin: undefined,
          stdout: undefined,
          stderr: undefined,
          collected: {
            stdout: collectedReader(''),
            stderr: collectedReader(''),
          },
          done: Promise.resolve({ exitCode: 0, signal: null }),
          terminate() {},
          waitForExit() {
            return new Promise(() => {});
          },
        };
      },
    };
    const git = new LocalGitAdapter({
      subprocess: runtime,
      // `done` is already settled, so its await resumes before this short
      // deadline timer gets a chance to run. Cleanup then deliberately waits
      // beyond the command deadline.
      timeoutMs: 1,
      cleanupTimeoutMs: 20,
    });

    await assert.rejects(git.listBranches(workspaceRoot), (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitTimedOut, undefined);
      assert.equal(error?.details?.gitProcessTreeDidNotExit, true);
      return true;
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('maps lossy collected output to bounded truncation diagnostics', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = createFakeRuntime({
      stdout: 'tail-output',
      lossy: true,
    });
    const git = new LocalGitAdapter({
      subprocess: runtime,
      maxOutputBytes: 16,
    });

    await assert.rejects(git.listBranches(workspaceRoot), (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitOutputTruncated, true);
      assert.equal(error?.details?.gitStdout, 'tail-output');
      return true;
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('keeps Git mutations on the normal lock environment while reads disable optional locks', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = createFakeRuntime();
    const git = new LocalGitAdapter({ subprocess: runtime });

    await git.listBranches(workspaceRoot);
    await git.createWorktree(workspaceRoot, path.join(workspaceRoot, 'worktree'), 'main');
    await git.removeWorktree(workspaceRoot, path.join(workspaceRoot, 'worktree'));

    assert.equal(runtime.spawnCalls[0].env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(runtime.spawnCalls[1].env.GIT_OPTIONAL_LOCKS, undefined);
    assert.equal(runtime.spawnCalls[2].env.GIT_OPTIONAL_LOCKS, undefined);
    assert.equal('shell' in runtime.spawnCalls[0], false);
    assert.equal(runtime.spawnCalls.every(({ argv }) =>
      !argv.some((argument) => /powershell|cmd(?:\.exe)?|bash/i.test(argument))), true);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('removes an ambient optional-lock override before running a Git mutation', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  const previous = process.env.GIT_OPTIONAL_LOCKS;
  process.env.GIT_OPTIONAL_LOCKS = '0';
  try {
    const runtime = createFakeRuntime();
    const git = new LocalGitAdapter({ subprocess: runtime });

    await git.createWorktree(workspaceRoot, path.join(workspaceRoot, 'worktree'), 'main');

    assert.equal(runtime.spawnCalls[0].env.GIT_OPTIONAL_LOCKS, undefined);
  } finally {
    if (previous === undefined) delete process.env.GIT_OPTIONAL_LOCKS;
    else process.env.GIT_OPTIONAL_LOCKS = previous;
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('places embedded executable arguments after the resolved executable', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  try {
    const runtime = createFakeRuntime({ stdout: 'main\0' });
    const git = new LocalGitAdapter({
      subprocess: runtime,
      executable: '/execution-world/bin/node',
      executableArgs: ['--embedded-git-shim'],
    });

    await git.listBranches(workspaceRoot);
    assert.deepEqual(runtime.spawnCalls[0].argv, [
      '/execution-world/bin/git',
      '--embedded-git-shim',
      'for-each-ref',
      '--format=%(refname:short)%00',
      'refs/heads/',
    ]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('does not trigger unhandled rejection when cancelled before or during executable resolution', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  const unhandled = [];
  const onUnhandled = (error) => { unhandled.push(error); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const runtime = {
      async resolveExecutable(_command, _env, signal) {
        await delay(10);
        signal?.throwIfAborted();
        return '/bin/git';
      },
      spawn() {
        throw new Error('should not spawn');
      },
    };
    const controller = new globalThis.AbortController();
    const git = new LocalGitAdapter({ subprocess: runtime, signal: controller.signal });
    const task = git.listBranches(workspaceRoot);
    controller.abort(new Error('Worktree manager is closing'));
    await assert.rejects(task);
    await delay(30);
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('immediately rejects and does not run when signal is pre-aborted', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-subprocess-git-'));
  let resolveCalled = false;
  try {
    const runtime = {
      async resolveExecutable() {
        resolveCalled = true;
        return '/bin/git';
      },
      spawn() {
        throw new Error('should not spawn');
      },
    };
    const controller = new globalThis.AbortController();
    controller.abort(new Error('pre-aborted'));
    const git = new LocalGitAdapter({ subprocess: runtime, signal: controller.signal });
    await assert.rejects(git.listBranches(workspaceRoot));
    assert.equal(resolveCalled, false);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
