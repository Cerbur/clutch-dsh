import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CrossProcessMutationLock } from '../lib/provider/sidecar/mutation-lock.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worktree-lock-lifecycle-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new CrossProcessMutationLock({ lockRoot: path.join(root, 'locks'), ...options });
}

test('cancelled lock acquisition preserves the other owner and removes its retry timer', async (t) => {
  const controller = new globalThis.AbortController();
  const owner = await fixture(t);
  const contender = new CrossProcessMutationLock({ lockRoot: owner.lockRoot, signal: controller.signal });
  const entered = deferred();
  const release = deferred();
  const held = owner.run('ws', async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  const ownerPath = path.join(owner.getLockPath('ws'), 'owner.json');
  const before = await readFile(ownerPath, 'utf8');
  const contended = deferred();
  const reclaim = contender.reclaimIfDead.bind(contender);
  contender.reclaimIfDead = async (...args) => { await reclaim(...args); contended.resolve(); };
  let called = false;
  const pending = contender.run('ws', async () => { called = true; });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  try {
    await contended.promise;
    controller.abort(new Error('Host closing'));
    await rejected;
    assert.equal(called, false);
    assert.equal(await readFile(ownerPath, 'utf8'), before);
  } finally {
    release.resolve();
    await held;
  }
  // A fresh Host can acquire immediately; the cancelled contender cannot wake later.
  await owner.run('ws', async () => {});
  assert.deepEqual(await readdir(owner.lockRoot), []);
});

test('abort after acquisition releases the newly owned lock without admitting a callback', async (t) => {
  const controller = new globalThis.AbortController();
  const lock = await fixture(t, { signal: controller.signal });
  const acquire = lock.acquire.bind(lock);
  lock.acquire = async (...args) => {
    const handle = await acquire(...args);
    controller.abort(new Error('closed during owner publication'));
    return handle;
  };
  await assert.rejects(lock.run('ws', async () => assert.fail('cancelled callback ran')), /closed during owner publication/);
  assert.deepEqual(await readdir(lock.lockRoot), []);
});

test('an admitted durable operation finishes before cancellation releases its lock', async (t) => {
  const controller = new globalThis.AbortController();
  const lock = await fixture(t, { signal: controller.signal });
  const entered = deferred();
  const commit = deferred();
  let committed = false;
  const pending = lock.run('ws', async (held) => {
    entered.resolve();
    await commit.promise;
    held.assertHeld();
    committed = true;
  });
  await entered.promise;
  controller.abort();
  assert.equal((await readdir(lock.lockRoot)).length, 1);
  commit.resolve();
  await pending;
  assert.equal(committed, true);
  assert.deepEqual(await readdir(lock.lockRoot), []);
  await assert.rejects(lock.run('ws', async () => assert.fail('closed owner accepted work')), { name: 'AbortError' });
});

test('acquisition timeout and callback failure both preserve lock ownership rules', async (t) => {
  const owner = await fixture(t);
  const contender = new CrossProcessMutationLock({ lockRoot: owner.lockRoot, acquisitionTimeoutMs: 0 });
  await owner.run('ws', async () => {
    await assert.rejects(contender.run('ws', async () => assert.fail('stole owner')), { code: 'WORKTREE_MUTATION_BUSY' });
    assert.equal((await readdir(owner.lockRoot)).length, 1);
  });
  await assert.rejects(owner.run('ws', async () => { throw new Error('disk write failed'); }), /disk write failed/);
  assert.deepEqual(await readdir(owner.lockRoot), []);
  await owner.run('ws', async () => {});
});
