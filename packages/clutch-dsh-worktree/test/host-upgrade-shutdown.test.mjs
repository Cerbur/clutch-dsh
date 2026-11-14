import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL, URL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { WorktreeRemoteService } from '../lib/host/service.js';
import { WorkspaceShardedSidecarRepository } from '../lib/provider/sidecar/repository.js';
import { WorktreeToolChanges } from '../lib/host/worktree-tool-changes.js';
import { CrossProcessMutationLock } from '../lib/provider/sidecar/mutation-lock.js';
import { createRepositoryFingerprint } from '../lib/provider/git/repository-fingerprint.js';
import { LocalGitAdapter } from '../lib/provider/git/adapter.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

for (const kind of ['shard', 'repository']) {
test(`Host shutdown cancels startup recovery waiting for another ${kind} owner`, { timeout: 8000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'worktree-upgrade-'));
  const root = path.join(temp, 'repo');
  const home = path.join(temp, 'home');
  await mkdir(root);
  const owner = new WorkspaceShardedSidecarRepository({ dshHome: home });
  const checkout = path.join(temp, 'user-worktree');
  await mkdir(checkout);
  await writeFile(path.join(checkout, 'work.txt'), 'keep user work\n');
  await owner.upsertWorktree({ workspaceId: 'ws', worktreeId: 'wt', absolutePath: checkout, branch: 'topic', source: 'external', status: 'active' });
  await owner.upsertBinding({ workspaceId: 'ws', worktreeId: 'wt', sessionId: 'session', status: 'active' });
  const saved = await readFile(owner.getShardPath('ws'), 'utf8');
  let holder = (callback) => owner.runExclusive('ws', callback);
  if (kind === 'repository') {
    const git = (...args) => execFileSync('git', args, { cwd: root, timeout: 10000, maxBuffer: 1024 * 1024 });
    git('init', '-b', 'main');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-m', 'fixture');
    const { identity } = await new LocalGitAdapter().resolveRepositoryIdentity(root);
    const repositoryLock = new CrossProcessMutationLock({ lockRoot: path.join(home, 'clutch-dsh-worktree', 'locks') });
    holder = (callback) => repositoryLock.run(`repository:${createRepositoryFingerprint(identity)}`, callback);
  }
  const acquired = deferred();
  const release = deferred();
  const held = holder(async () => {
    acquired.resolve();
    await release.promise;
  });
  await acquired.promise;
  const ctx = new Context();
  const workspace = { id: 'ws', path: root, sessionIds: [] };
  ctx.provide('workspaceRegistry', { get: () => workspace, list: () => [workspace] });
  ctx.provide('sessions', { get: () => undefined, list: () => [] });
  ctx.provide('sessionPersistence', { list: async () => [] });
  await ctx.plugin(WorktreeRemoteService, { dshHome: home });
  const service = ctx.get('worktreeManager');
  // Barrier on the real contender, before its retry delay. No sleep-based race.
  const lock = kind === 'shard' ? service.manager.context.sidecar.persistence.mutationLock
    : service.manager.context.transaction.dependencies.repositoryLock;
  const contending = deferred();
  const reclaim = lock.reclaimIfDead.bind(lock);
  lock.reclaimIfDead = async (...args) => {
    await reclaim(...args);
    contending.resolve();
  };
  let closing;
  try {
    await contending.promise;
    const queued = assert.rejects(service.listBindings({ workspaceId: 'ws' }), /manager is closing/);
    closing = ctx.fiber.dispose();
    const deadline = new globalThis.AbortController();
    try {
      await Promise.race([
        closing,
        delay(5000, undefined, { signal: deadline.signal }).then(() => {
          assert.fail('Desktop shutdown deadline: worktree Host did not dispose within 5 seconds');
        }),
      ]);
    } finally {
      deadline.abort();
    }
    await queued;
    assert.equal(await readFile(owner.getShardPath('ws'), 'utf8'), saved);
    assert.equal(await readFile(path.join(checkout, 'work.txt'), 'utf8'), 'keep user work\n');
    assert.equal((await readdir(path.join(home, 'clutch-dsh-worktree', 'locks'))).length, 1,
      'only the other owner remains; repository contention must release our shard');
  } finally {
    release.resolve();
    await held;
    await closing;
    await rm(temp, { recursive: true, force: true });
  }
});
}

test('Host disposal aborts an in-flight Git command and waits for tree cleanup before completing', { timeout: 5000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'worktree-shutdown-git-'));
  const root = path.join(temp, 'repo');
  await mkdir(root);
  const started = deferred();
  const terminated = deferred();
  const exited = deferred();
  const done = deferred();
  const specs = [];
  const ctx = new Context();
  const workspace = { id: 'ws', path: root, sessionIds: [] };
  ctx.provide('workspaceRegistry', { get: () => workspace, list: () => [] });
  ctx.provide('sessions', { get: () => undefined, list: () => [] });
  ctx.provide('sessionPersistence', { list: async () => [] });
  ctx.provide('subprocess', {
    resolveExecutable: async () => '/fixture/git',
    spawn(spec) {
      specs.push(spec);
      started.resolve();
      return {
        done: done.promise,
        collected: {
          stdout: { readFrom: () => ({ text: '', lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
        terminate() {
          done.resolve({ exitCode: null, signal: 'SIGTERM' });
          terminated.resolve();
        },
        waitForExit: () => exited.promise,
      };
    },
  });
  await ctx.plugin(WorktreeRemoteService, { dshHome: path.join(temp, 'home') });
  const service = ctx.get('worktreeManager');
  const operation = service.listBranches({ workspaceId: 'ws' });
  let closing;
  try {
    await started.promise;
    let closed = false;
    closing = Promise.resolve(ctx.fiber.dispose()).then(() => { closed = true; });
    await terminated.promise;
    await setImmediate();
    assert.equal(specs[0].signal.aborted, true);
    assert.equal(closed, false, 'shutdown must retain ownership until Git tree exit');
    exited.resolve(true);
    assert.equal((await operation).ok, false);
    await closing;
    assert.equal(specs.length, 1, 'shutdown must not spawn more Git commands');
    const first = service.manager.close();
    assert.equal(service.manager.close(), first);
    await first;
  } finally {
    exited.resolve(true);
    done.resolve({ exitCode: null, signal: 'SIGTERM' });
    await closing;
    await ctx.fiber.dispose();
    await rm(temp, { recursive: true, force: true });
  }
});

test('native Desktop admission drains an idle Worktree notification request before its control deadline', async (t) => {
  const source = process.env.DSH_NATIVE_SOURCE;
  if (!source) return t.skip('Set DSH_NATIVE_SOURCE to verify the native Desktop update admission.');
  const { installDesktopUpdateTaskControl } = await import(pathToFileURL(path.join(source, 'apps/desktop-host/src/update-tasks.ts')).href);
  const ctx = new Context();
  ctx.provide('agents', { list: () => [] });
  ctx.provide('jobs', { list: () => [] });
  const control = installDesktopUpdateTaskControl(ctx);
  const feed = new WorktreeToolChanges();
  const cancellation = new globalThis.AbortController();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const entered = deferred();
  const request = ctx.waterfall('connection/request', {}, {}, async () => {
    const result = feed.watch(0, cancellation.signal);
    entered.resolve();
    await result;
  });
  try {
    await entered.promise;
    assert.equal(await control('inspect'), false, 'idle notification reads are not active tasks');
    let drained = false;
    const locking = control('lock').then((active) => { drained = true; return active; });
    const refused = [];
    await ctx.waterfall('connection/request', {}, {
      writeHead: (status) => refused.push(status), end() {},
    }, () => assert.fail('locked admission accepted a new request'));
    assert.deepEqual(refused, [503]);
    t.mock.timers.tick(9999);
    await setImmediate();
    assert.equal(drained, true, 'Desktop update: task inspection timed out (10s) while draining Worktree long-poll');
    assert.equal(await locking, false);
    await request;
    assert.equal(feed.waiters.size, 0);
  } finally {
    cancellation.abort();
    await request.catch(() => {});
    feed.dispose();
    await ctx.fiber.dispose();
  }
});

test('native shutdown controller sends the clean-stop acknowledgement with a live cross-process shard owner', { timeout: 10000 }, async (t) => {
  const source = process.env.DSH_NATIVE_SOURCE;
  if (!source) return t.skip('Set DSH_NATIVE_SOURCE to verify native shutdown IPC and the real 5s deadline.');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'worktree-native-shutdown-'));
  const home = path.join(temp, 'home');
  const root = path.join(temp, 'repo');
  await mkdir(root);
  const owner = new WorkspaceShardedSidecarRepository({ dshHome: home });
  const acquired = deferred();
  const release = deferred();
  const held = owner.runExclusive('ws', async () => { acquired.resolve(); await release.promise; });
  await acquired.promise;
  const messages = [];
  let stderr = '';
  const child = fork(new URL('./fixtures/desktop-upgrade-shutdown.mjs', import.meta.url), [source, home, root], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], timeout: 7500, killSignal: 'SIGKILL',
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  child.on('message', (message) => {
    messages.push(message.type);
    if (message.type === 'ready') child.send({ type: 'shutdown' });
  });
  try {
    assert.deepEqual(await closed, { code: 0, signal: null }, stderr);
    assert.deepEqual(messages, ['ready', 'shutdown-complete'], 'exit 0 alone is not a clean Desktop handoff');
    assert.equal((await readdir(path.join(home, 'clutch-dsh-worktree', 'locks'))).length, 1,
      'the other process retains its live shard lock');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    release.resolve();
    await held;
    await rm(temp, { recursive: true, force: true });
  }
});
