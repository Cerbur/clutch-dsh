import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import { URL } from 'node:url';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rename, readdir, open, rm, stat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorktreeManager, WorkspaceShardedSidecarRepository, LocalGitAdapter } from '../lib/index.js';
import { runWorktreeBatch } from '../lib/client/dashboard/batch-manage.js';
import { createWorktreeRemoteProjection } from '../lib/host/remote.js';
import { createWorktreeConnectionAdapter } from '../lib/client/worktree-connection.js';

const workspaceId = 'ws_archive_recovery';
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
}

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archive-recovery-'));
  const workspaceRoot = path.join(root, 'repo');
  const dshHome = path.join(root, 'home');
  await mkdir(workspaceRoot);
  await mkdir(dshHome);
  git(workspaceRoot, ['init', '-b', 'main']);
  git(workspaceRoot, ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture']);
  const dsh = {
    getWorkspace: async (id) => id === workspaceId ? { workspaceId, rootPath: workspaceRoot } : undefined,
    listSessions: async () => [],
    getSession: async () => undefined,
  };
  const sidecar = new WorkspaceShardedSidecarRepository({ dshHome });
  const manager = createWorktreeManager({ dsh, dshHome, sidecar, ...options });
  t.after(() => manager.close());
  t.diagnostic('fixture: ' + root);
  const remote = createWorktreeRemoteProjection(manager);
  const client = createWorktreeConnectionAdapter({
    async call(channel, endpoint, payload) {
      assert.equal(channel, '/api');
      const method = endpoint.split('/').at(-1);
      return { ok: true, value: JSON.parse(JSON.stringify(await remote[method](payload.args.input))) };
    },
  });
  t.after(() => client.dispose());
  const create = (newBranch) => manager.createWorktree({ workspaceId, branch: 'main', newBranch });
  const input = async (record) => ({ workspaceId, worktreeId: record.worktreeId, mutationToken: (await manager.listWorktrees({ workspaceId })).find(w => w.worktreeId === record.worktreeId).mutationToken });
  return { root, workspaceRoot, dshHome, dsh, sidecar, manager, client, create, input };
}

test('pending clean with residual directory and lost Git registration has a data-preserving escape', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const broken = await f.create('broken');
  const healthy = await f.create('healthy');
  await f.manager.removeWorktree(await f.input(broken));
  const saved = path.join(f.root, 'saved-checkout');
  await rename(broken.absolutePath, saved);
  git(f.workspaceRoot, ['worktree', 'prune', '--expire=now']);
  await rename(saved, broken.absolutePath);
  await writeFile(path.join(broken.absolutePath, 'valuable.txt'), 'must survive recovery\n');
  assert.ok(!git(f.workspaceRoot, ['worktree', 'list', '--porcelain']).includes(broken.absolutePath));
  const before = await f.sidecar.read(workspaceId);
  const pendingOperation = {
    id: 'op_lost_registration', type: 'clean-worktree', phase: 'recovery-needed',
    workspaceId, worktreeId: broken.worktreeId, targetPath: broken.absolutePath,
    branch: broken.branch, source: broken.source, repositoryFingerprint: before.repositoryFingerprint,
    startedAt: '2026-11-05T15:53:47.915Z',
  };
  const recoveryIssues = [{ code: 'WORKTREE_IDENTITY_CHANGED', operationId: pendingOperation.id, worktreeId: broken.worktreeId, observedAt: pendingOperation.startedAt }];
  await writeFile(f.sidecar.getShardPath(workspaceId), JSON.stringify({ ...before, pendingOperation, recoveryIssues }));
  await assert.rejects(f.manager.recoverWorktrees({ workspaceId }), (error) => {
    assert.equal(error.code, 'WORKTREE_IDENTITY_CHANGED');
    assert.equal(error.details.quarantineOperationId, pendingOperation.id);
    return true;
  });
  await assert.rejects(f.create('blocked'), { code: 'WORKTREE_RECOVERY_REQUIRED' });
  t.diagnostic('Exact symptom reproduced: WORKTREE_IDENTITY_CHANGED on recovery; WORKTREE_RECOVERY_REQUIRED on unrelated creation');
  const originalText = await readFile(f.sidecar.getShardPath(workspaceId), 'utf8');
  // Exercise the production Client connection and Host JSON error/result projection.
  await assert.rejects(f.client.recoverWorktrees({ workspaceId }), error => {
    assert.equal(error.code, 'WORKTREE_IDENTITY_CHANGED');
    assert.equal(error.details.quarantineOperationId, pendingOperation.id);
    return true;
  });
  const beforeCancel = await f.sidecar.read(workspaceId);
  await f.client.recoverWorktrees({ workspaceId, quarantineOperationId: pendingOperation.id });
  const cancelled = await f.sidecar.read(workspaceId);
  assert.deepEqual(cancelled.worktrees, beforeCancel.worktrees);
  assert.deepEqual(cancelled.bindings, beforeCancel.bindings);
  assert.equal(cancelled.repositoryFingerprint, beforeCancel.repositoryFingerprint);
  // Recovery refreshes observedAt; the backup must match the precise pre-cancellation shard.
  const quarantineBackups = await backups(f);
  assert.equal(quarantineBackups.length, 1);
  assert.deepEqual(JSON.parse(quarantineBackups[0].text), beforeCancel);
  assert.equal(JSON.parse(originalText).pendingOperation.id, pendingOperation.id);
  await f.manager.removeWorktree(await f.input(healthy));
  await f.create('unblocked');
  const after = await f.sidecar.read(workspaceId);
  assert.equal(after.pendingOperation, undefined);
  assert.equal(after.worktrees.find(w => w.worktreeId === broken.worktreeId).diskCleanup, undefined);
  assert.equal(await readFile(path.join(broken.absolutePath, 'valuable.txt'), 'utf8'), 'must survive recovery\n');
});

async function seedPending(f, record, overrides = {}) {
  const before = await f.sidecar.read(workspaceId);
  const pendingOperation = {
    id: 'op_cleanup', type: 'clean-worktree', phase: 'recovery-needed', workspaceId,
    worktreeId: record.worktreeId, targetPath: record.absolutePath, branch: record.branch,
    source: record.source, repositoryFingerprint: before.repositoryFingerprint,
    startedAt: '2026-11-05T15:53:47.915Z', ...overrides,
  };
  const snapshot = { ...before, pendingOperation, recoveryIssues: [{
    code: 'WORKTREE_IDENTITY_CHANGED', operationId: pendingOperation.id,
    worktreeId: record.worktreeId, observedAt: pendingOperation.startedAt,
  }] };
  await writeFile(f.sidecar.getShardPath(workspaceId), JSON.stringify(snapshot));
  return snapshot;
}
const cancel = (manager, id = 'op_cleanup') => manager.recoverWorktrees({ workspaceId, quarantineOperationId: id });
async function backups(f) {
  const directory = path.join(f.dshHome, 'clutch-dsh-worktree', 'cleanup-quarantine');
  return Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(async name =>
    ({ path: path.join(directory, name), text: await readFile(path.join(directory, name), 'utf8') })));
}

for (const failAt of [1, 2]) {
  test('quarantine survives file fsync failure at write ' + failAt + ' and restart', { timeout: 15_000 }, async (t) => {
    const f = await fixture(t);
    const record = await f.create('durability');
    await f.manager.removeWorktree(await f.input(record));
    const original = await seedPending(f, record);
    const originalText = await readFile(f.sidecar.getShardPath(workspaceId), 'utf8');
    const handle = await open(f.sidecar.getShardPath(workspaceId), 'r');
    const prototype = Object.getPrototypeOf(handle);
    await handle.close();
    const sync = prototype.sync;
    let writes = 0;
    const failure = t.mock.method(prototype, 'sync', async function () {
      if ((await this.stat()).isFile() && ++writes === failAt) {
        throw Object.assign(new Error('injected fsync EIO'), { code: 'EIO' });
      }
      return sync.call(this);
    });
    await assert.rejects(cancel(f.manager), { code: 'SIDECAR_UNAVAILABLE' });
    failure.mock.restore();
    assert.equal(await readFile(f.sidecar.getShardPath(workspaceId), 'utf8'), originalText);
    await f.manager.close();
    const restarted = createWorktreeManager({ dsh: f.dsh, dshHome: f.dshHome });
    t.after(() => restarted.close());
    await cancel(restarted);
    const after = await f.sidecar.read(workspaceId);
    assert.deepEqual(after.worktrees, original.worktrees);
    assert.deepEqual(after.bindings, original.bindings);
    assert.equal(after.repositoryFingerprint, original.repositoryFingerprint);
    assert.equal(after.revision, String(BigInt(original.revision) + 1n));
    const saved = await backups(f);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].text, originalText);
    assert.equal((await stat(saved[0].path)).mode & 0o777, 0o600);
    await cancel(restarted);
    assert.deepEqual(await f.sidecar.read(workspaceId), after);
  });
}

test('quarantine preserves bindings and unrelated issues; stale IDs cannot cancel new operations', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const record = await f.create('exact');
  await f.manager.removeWorktree(await f.input(record));
  const snapshot = await seedPending(f, record);
  const unrelated = { code: 'WORKTREE_IDENTITY_CHANGED', operationId: 'other-operation', worktreeId: record.worktreeId, observedAt: snapshot.pendingOperation.startedAt };
  const bindings = [{ workspaceId, worktreeId: record.worktreeId, sessionId: 'original-session', status: 'active' }];
  await writeFile(f.sidecar.getShardPath(workspaceId), JSON.stringify({ ...snapshot, bindings, recoveryIssues: [...snapshot.recoveryIssues, unrelated] }));
  await assert.rejects(cancel(f.manager, 'wrong-id'), { code: 'WORKTREE_RECOVERY_REQUIRED' });
  await cancel(f.manager);
  const after = await f.sidecar.read(workspaceId);
  assert.deepEqual(after.bindings, bindings);
  assert.deepEqual(after.recoveryIssues, [unrelated]);
  assert.deepEqual(after.worktrees, snapshot.worktrees);
  await seedPending(f, record, { id: 'new-operation' });
  await assert.rejects(cancel(f.manager), { code: 'WORKTREE_RECOVERY_REQUIRED' });
  assert.equal((await f.sidecar.read(workspaceId)).pendingOperation.id, 'new-operation');
});

test('backup symlink is rejected without modifying its target or retiring journal', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const record = await f.create('symlink');
  await f.manager.removeWorktree(await f.input(record));
  const original = await seedPending(f, record);
  await cancel(f.manager);
  const [backup] = await backups(f);
  const sentinel = path.join(f.root, 'sentinel');
  await writeFile(sentinel, 'untouched');
  await rm(backup.path); // Exact fixture-owned backup, never a production path.
  await symlink(sentinel, backup.path);
  await writeFile(f.sidecar.getShardPath(workspaceId), JSON.stringify(original));
  await assert.rejects(cancel(f.manager), { code: 'SIDECAR_UNAVAILABLE' });
  assert.equal(await readFile(sentinel, 'utf8'), 'untouched');
  assert.equal((await f.sidecar.read(workspaceId)).pendingOperation.id, 'op_cleanup');
});

test('batch archive and clean have bounded partial failure and retry without stranding siblings', { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  const records = [];
  for (const branch of ['batch-one', 'batch-dirty', 'batch-three']) records.push(await f.create(branch));
  const results = [];
  const batch = async (action) => runWorktreeBatch(action, await f.manager.listWorktrees({ workspaceId }), async (kind, record) => {
    const input = await f.input(record);
    if (kind === 'archive') await f.manager.removeWorktree(input);
    else await f.manager.cleanWorktree({ ...input, confirmed: true, tasksStopped: true });
  }, () => true, result => results.push(result));
  await batch('archive');
  assert.equal(results.filter(result => result.error).length, 0);
  assert.equal(results.length, 3);
  for (const record of records) await f.manager.removeWorktree(await f.input(record));
  const dirtyPath = path.join(records[1].absolutePath, 'valuable.txt');
  await writeFile(dirtyPath, 'keep dirty files');
  results.length = 0;
  await batch('clean');
  assert.equal(results.length, 3);
  assert.equal(results.filter(result => result.error).length, 1);
  assert.equal(results[1].record.worktreeId, records[1].worktreeId);
  assert.equal(await readFile(dirtyPath, 'utf8'), 'keep dirty files');
  assert.equal((await f.sidecar.read(workspaceId)).pendingOperation, undefined);
  await f.create('after-partial-failure');
  await rm(dirtyPath); // Only the test-created untracked file.
  const cleanup = async () => f.manager.cleanWorktree({ ...await f.input(records[1]), confirmed: true, tasksStopped: true });
  await cleanup();
  await cleanup();
  assert.equal((await f.sidecar.read(workspaceId)).worktrees.find(w => w.worktreeId === records[1].worktreeId).diskCleanup, 'completed');
});

test('concurrent cleanup and archives serialize behind a deterministic Git barrier', { timeout: 20_000 }, async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  // Release the injected barrier before fixture teardown even if this test times out.
  t.after(() => release.resolve());
  const adapter = new LocalGitAdapter();
  const f = await fixture(t, { git: adapter });
  const cleaned = await f.create('concurrent-clean');
  const other = await f.create('concurrent-archive');
  await f.manager.removeWorktree(await f.input(cleaned));
  const remove = adapter.removeWorktree.bind(adapter);
  adapter.removeWorktree = async (...args) => { entered.resolve(); await release.promise; return remove(...args); };
  const clean = f.manager.cleanWorktree({ ...await f.input(cleaned), confirmed: true, tasksStopped: true });
  await entered.promise;
  const input = await f.input(other);
  const calls = [f.manager.removeWorktree(input), f.manager.removeWorktree(input)];
  release.resolve();
  const settled = await Promise.allSettled([clean, ...calls]);
  assert.equal(settled[0].status, 'fulfilled');
  for (const outcome of settled.slice(1)) {
    if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'WORKTREE_STATE_CONFLICT');
  }
  await f.manager.removeWorktree(await f.input(other));
  await f.manager.removeWorktree(await f.input(other));
  await f.create('after-concurrency');
  assert.equal((await f.sidecar.read(workspaceId)).pendingOperation, undefined);
});

test('real cleanup residual failure can be cancelled; no sibling or native Session is deleted', { timeout: 20_000 }, async (t) => {
  const adapter = new LocalGitAdapter();
  const f = await fixture(t, { git: adapter });
  const broken = await f.create('actual-residual');
  const healthy = await f.create('actual-healthy');
  for (const record of [broken, healthy]) await f.manager.removeWorktree(await f.input(record));
  const nativePath = path.join(f.dshHome, 'native-session-sentinel.json');
  const nativeText = JSON.stringify({ sessionId: 'native', messages: ['untouched'], cwd: broken.absolutePath });
  await writeFile(nativePath, nativeText);
  const remove = adapter.removeWorktree.bind(adapter);
  adapter.removeWorktree = async (root, target) => {
    const pointer = await readFile(path.join(target, '.git'), 'utf8');
    await remove(root, target);
    await mkdir(target);
    await writeFile(path.join(target, '.git'), pointer);
    await writeFile(path.join(target, 'valuable.txt'), 'residual');
  };
  await assert.rejects(f.manager.cleanWorktree({ ...await f.input(broken), confirmed: true, tasksStopped: true }), { code: 'WORKTREE_IDENTITY_CHANGED' });
  const pending = (await f.sidecar.read(workspaceId)).pendingOperation;
  assert.equal(pending.phase, 'recovery-needed');
  await assert.rejects(f.manager.recoverWorktrees({ workspaceId }), { code: 'WORKTREE_IDENTITY_CHANGED' });
  await cancel(f.manager, pending.id);
  adapter.removeWorktree = remove;
  await f.manager.cleanWorktree({ ...await f.input(healthy), confirmed: true, tasksStopped: true });
  assert.equal(await readFile(path.join(broken.absolutePath, 'valuable.txt'), 'utf8'), 'residual');
  assert.equal(await readFile(nativePath, 'utf8'), nativeText);
  const snapshot = await f.sidecar.read(workspaceId);
  assert.equal(snapshot.worktrees.find(w => w.worktreeId === broken.worktreeId).diskCleanup, undefined);
  assert.equal(snapshot.worktrees.find(w => w.worktreeId === healthy.worktreeId).diskCleanup, 'completed');
  await f.create('after-actual-residual');
});

for (const code of ['ENOENT', 'EACCES', 'EIO']) {
  test('uncertain cleanup recovery distinguishes path result ' + code + ' and allows only non-destructive cancellation', { timeout: 15_000 }, async (t) => {
    const f = await fixture(t);
    const record = await f.create('path-' + code.toLowerCase());
    await f.manager.removeWorktree(await f.input(record));
    const saved = path.join(f.root, 'preserved');
    await rename(record.absolutePath, saved);
    git(f.workspaceRoot, ['worktree', 'prune', '--expire=now']);
    const original = await seedPending(f, record);
    const originalStat = fs.stat;
    const mocked = t.mock.method(fs, 'stat', async (target, ...args) => {
      if (target === record.absolutePath) throw Object.assign(new Error('injected path probe'), { code });
      return originalStat(target, ...args);
    });
    syncBuiltinESMExports();
    t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
    await assert.rejects(f.manager.recoverWorktrees({ workspaceId }), error => {
      assert.equal(error.code, 'WORKTREE_RECOVERY_REQUIRED');
      assert.equal(error.details.quarantineOperationId, 'op_cleanup');
      if (code === 'ENOENT') assert.match(error.message, /completion evidence/);
      else assert.match(error.message, /Unable to inspect/);
      return true;
    });
    await cancel(f.manager);
    assert.deepEqual((await f.sidecar.read(workspaceId)).worktrees, original.worktrees);
    assert.ok((await stat(saved)).isDirectory());
    mocked.mock.restore();
    syncBuiltinESMExports();
    await f.create('after-' + code.toLowerCase());
  });
}

test('repository mismatch is never rebound by quarantine and replaced paths are retained', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const record = await f.create('identity');
  await f.manager.removeWorktree(await f.input(record));
  const replacement = path.join(f.root, 'replacement');
  await rename(record.absolutePath, path.join(f.root, 'original-checkout'));
  await mkdir(replacement);
  await writeFile(path.join(replacement, 'valuable.txt'), 'replacement');
  await symlink(replacement, record.absolutePath);
  const original = await seedPending(f, record, { repositoryFingerprint: 'v1-' + '0'.repeat(64) });
  await assert.rejects(f.manager.recoverWorktrees({ workspaceId }), { code: 'WORKTREE_IDENTITY_CHANGED' });
  await cancel(f.manager);
  const after = await f.sidecar.read(workspaceId);
  assert.equal(after.repositoryFingerprint, original.repositoryFingerprint);
  assert.deepEqual(after.worktrees, original.worktrees);
  assert.equal(await readFile(path.join(replacement, 'valuable.txt'), 'utf8'), 'replacement');
  await assert.rejects(f.manager.cleanWorktree({ ...await f.input(record), confirmed: true, tasksStopped: true }), { code: 'WORKTREE_IDENTITY_CHANGED' });
  assert.equal(await readFile(path.join(replacement, 'valuable.txt'), 'utf8'), 'replacement');
});

test('independent processes cancel one exact cleanup only once under the shared lock', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const record = await f.create('cross-process');
  await f.manager.removeWorktree(await f.input(record));
  const original = await seedPending(f, record);
  const entry = new URL('../lib/index.js', import.meta.url).href;
  const script = [
    'const { createWorktreeManager } = await import(process.argv[1]);',
    'const [dshHome, rootPath, workspaceId] = process.argv.slice(2);',
    'const manager = createWorktreeManager({ dshHome, dsh: { getWorkspace: async () => ({ workspaceId, rootPath }) } });',
    'try { await manager.recoverWorktrees({ workspaceId, quarantineOperationId: "op_cleanup" }); } finally { await manager.close(); }',
  ].join('\n');
  const run = () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, entry, f.dshHome, f.workspaceRoot, workspaceId], {
    cwd: f.root, timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  await Promise.all([run(), run()]);
  const after = await f.sidecar.read(workspaceId);
  assert.equal(after.revision, String(BigInt(original.revision) + 1n));
  assert.deepEqual(after.worktrees, original.worktrees);
  assert.equal((await backups(f)).length, 1);
  await f.create('after-cross-process');
});

test('quarantine rejects malformed IDs, other journal kinds and phases without any writes', { timeout: 15_000 }, async (t) => {
  const f = await fixture(t);
  const record = await f.create('rejected');
  await f.manager.removeWorktree(await f.input(record));
  for (const overrides of [{ type: 'create-worktree', source: undefined }, { type: 'remove-worktree' }, { phase: 'prepared' }, { phase: 'executing' }, { phase: 'verifying' }]) {
    await seedPending(f, record, overrides);
    const before = await readFile(f.sidecar.getShardPath(workspaceId), 'utf8');
    await assert.rejects(cancel(f.manager), { code: 'WORKTREE_RECOVERY_REQUIRED' });
    assert.equal(await readFile(f.sidecar.getShardPath(workspaceId), 'utf8'), before);
  }
  await seedPending(f, record);
  const before = await readFile(f.sidecar.getShardPath(workspaceId), 'utf8');
  for (const id of [null, '', '  ', 42, 'wrong-operation']) {
    await assert.rejects(cancel(f.manager, id), { code: 'WORKTREE_RECOVERY_REQUIRED' });
    assert.equal(await readFile(f.sidecar.getShardPath(workspaceId), 'utf8'), before);
  }
});
