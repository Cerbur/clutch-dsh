import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { listWorktrees } from '../lib/manage/manager-worktrees.js';

test('target reads start independent checkout enumeration before root resolution completes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worktree-target-parallel-'));
  let releaseRoot;
  let startedRoot;
  const rootStarted = new Promise((resolve) => { startedRoot = resolve; });
  const rootGate = new Promise((resolve) => { releaseRoot = resolve; });
  const calls = [];
  const operation = listWorktrees({
    dsh: { getWorkspace: async () => ({ workspaceId: 'ws', rootPath: root }) },
    sidecar: { read: async () => ({ schemaVersion: 1, workspaceId: 'ws', revision: '1', worktrees: [], bindings: [] }) },
    git: {
      resolveRepositoryRoot: async () => { startedRoot(); await rootGate; return root; },
      listWorktrees: async (cwd) => { calls.push(cwd); return []; },
    },
    signal: new globalThis.AbortController().signal,
  }, { workspaceId: 'ws', worktreeId: 'absent' });
  try {
    await rootStarted;
    assert.deepEqual(calls, [root], 'independent Git read must not wait for root discovery');
  } finally {
    releaseRoot();
    await operation;
    await rm(root, { recursive: true, force: true });
  }
});

for (const targetOnly of [false, true]) test(`Worktree projection bounds reads and preserves order (target only: ${targetOnly})`, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worktree-list-concurrency-'));
  try {
    const records = Array.from({ length: 9 }, (_, i) => ({
      workspaceId: 'ws', worktreeId: `wt_${i}`, absolutePath: path.join(root, String(i)),
      branch: `branch-${i}`, status: 'active', source: 'external', createdAt: '2026-11-01T00:00:00Z',
    }));
    await Promise.all(records.map((record) => mkdir(path.join(record.absolutePath, '.git'), { recursive: true })));
    let active = 0;
    let peak = 0;
    const headReads = [];
    const activityReads = [];
    const snapshot = { schemaVersion: 1, workspaceId: 'ws', revision: 1, worktrees: records,
      bindings: records.map((record) => ({ worktreeId: record.worktreeId, sessionId: record.worktreeId, status: 'active' })) };
    const before = globalThis.structuredClone(snapshot);
    const started = performance.now();
    const projected = await listWorktrees({
      dsh: { getWorkspace: async () => ({ workspaceId: 'ws', rootPath: root }),
        readWorktreeActivity: async (ids) => { activityReads.push(...ids); return { state: 'idle' }; } },
      sidecar: { read: async () => snapshot },
      git: {
        listWorktrees: async () => records.map((record) => ({ absolutePath: record.absolutePath, branch: record.branch })),
        resolveCheckoutHead: async (_root, checkout) => {
          headReads.push(checkout.branch);
          active += 1;
          peak = Math.max(peak, active);
          try {
            await delay(50);
            if (checkout.branch === 'branch-2') throw new Error('HEAD unavailable');
            return { kind: 'branch', name: checkout.branch, commit: 'a'.repeat(40) };
          } finally { active -= 1; }
        },
      },
      signal: new globalThis.AbortController().signal,
    }, { workspaceId: 'ws', ...(targetOnly ? { worktreeId: 'wt_8' } : {}) });
    if (targetOnly) {
      assert.deepEqual(headReads, ['branch-8']);
      assert.deepEqual(activityReads, ['wt_8']);
      assert.equal(peak, 1);
      assert.deepEqual(projected.map((record) => record.worktreeId), ['wt_8']);
      assert.equal(projected[0].currentHead.name, 'branch-8');
      assert.deepEqual(snapshot, before);
      return;
    }
    assert.ok(peak > 1, `Independent Git reads were serialized (${Math.round(performance.now() - started)} ms)`);
    assert.ok(peak <= 4, `Git read fan-out must remain bounded, got ${peak}`);
    assert.deepEqual(projected.map((record) => record.worktreeId), records.map((record) => record.worktreeId));
    assert.ok(projected.every((record) => record.health === 'ready' && record.activity.state === 'idle'));
    assert.equal(projected[2].currentHead, undefined);
    assert.equal(projected[8].currentHead.name, 'branch-8');
    assert.deepEqual(snapshot, before, 'Runtime projection must not mutate sidecar facts');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
