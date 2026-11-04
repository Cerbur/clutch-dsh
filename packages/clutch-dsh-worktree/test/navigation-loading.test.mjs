import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorktreeViewReader, createWorktreeModalViewLoader } from '../lib/client/view/worktree-view-read.js';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { LocalGitAdapter } from '../lib/provider/git/adapter.js';
import { readWorkspaceNavigation, getWorkspaceCheckout } from '../lib/manage/manager-navigation.js';
import { listWorktrees, getWorkspaceGitState } from '../lib/manage/manager-worktrees.js';

test('real Git navigation reduces attached checkout probes from ten to four', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'navigation-count-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  await mkdir(repo);
  const git = (args) => execFileSync('git', args, { cwd: repo, timeout: 10000, maxBuffer: 1024 * 1024 });
  git(['init', '-b', 'main']);
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'initial']);
  const adapter = new LocalGitAdapter();
  const calls = [];
  const run = adapter.run.bind(adapter);
  let activeGit = 0;
  let maximumGit = 0;
  adapter.run = async (...args) => {
    calls.push(args);
    activeGit += 1;
    maximumGit = Math.max(maximumGit, activeGit);
    try { return await run(...args); } finally { activeGit -= 1; }
  };
  let sidecarReads = 0;
  const context = { git: adapter, signal: new globalThis.AbortController().signal,
    dsh: { getWorkspace: async () => ({ workspaceId: 'ws', projectId: 'p', rootPath: repo }) },
    sidecar: { read: async () => {
      sidecarReads += 1;
      return { schemaVersion: 1, workspaceId: 'ws', revision: '0', worktrees: [], bindings: [] };
    } },
  };
  const input = { workspaceId: 'ws' };
  await Promise.all([listWorktrees(context, input), getWorkspaceGitState(context, input), getWorkspaceCheckout(context, input)]);
  assert.equal(calls.length, 10);
  const legacyMaximum = maximumGit;
  calls.length = 0;
  maximumGit = 0;
  sidecarReads = 0;
  const view = await readWorkspaceNavigation(context, input);
  assert.equal(calls.length, 4);
  assert.ok(maximumGit <= 2, 'sharing must not inflate attached-checkout Git fan-out');
  t.diagnostic('Git calls 10 -> 4; maximum simultaneous Git calls ' + legacyMaximum + ' -> ' + maximumGit);
  assert.equal(sidecarReads, 1);
  assert.equal(view.gitState.value.currentBranch, 'main');
  assert.equal(view.checkout.currentHead.kind, 'branch');
  // Diagnostic only: real local Git/Manage reads, excluding recovery, RPC and UI.
  // Never turn wall time into a flaky correctness assertion.
  const timings = { legacy: [], snapshot: [] };
  for (let sample = 0; sample < 5; sample += 1) {
    let start = performance.now();
    await Promise.all([listWorktrees(context, input), getWorkspaceGitState(context, input), getWorkspaceCheckout(context, input)]);
    timings.legacy.push(performance.now() - start);
    start = performance.now();
    await readWorkspaceNavigation(context, input);
    timings.snapshot.push(performance.now() - start);
  }
  const median = (samples) => samples.sort((a, b) => a - b)[2].toFixed(1);
  t.diagnostic('Host-only fixture on ' + os.platform() + ', 5 samples: legacy median ' +
    median(timings.legacy) + ' ms; navigation median ' + median(timings.snapshot) +
    ' ms. Not Windows/browser/cold-start measurements.');
  git(['checkout', '--detach']);
  const detached = await readWorkspaceNavigation(context, input);
  assert.equal(detached.gitState.value.currentBranch, null);
  assert.equal(detached.checkout.currentHead.kind, 'commit');
  await rm(repo, { recursive: true });
  const missing = await readWorkspaceNavigation(context, input);
  assert.equal(missing.gitState.error.code, 'WORKSPACE_ROOT_MISSING');
  assert.deepEqual(missing.bindings, []);
  await mkdir(repo);
  assert.equal((await readWorkspaceNavigation(context, input)).gitState.error.code, 'WORKSPACE_NOT_GIT_REPOSITORY');
  git(['init', '-b', 'main']);
  assert.equal((await readWorkspaceNavigation(context, input)).gitState.error.code, 'WORKTREE_REQUIRES_INITIAL_COMMIT');
  context.sidecar.read = async () => { throw new Error('corrupt sidecar'); };
  await assert.rejects(readWorkspaceNavigation(context, input), /corrupt sidecar/);
});

test('navigation uses one snapshot RPC instead of five independent reads', async () => {
  let calls = 0;
  const reader = createWorktreeViewReader({
    async readWorkspaceNavigation() {
      calls += 1;
      return { worktrees: [], bindings: [], mainInstructions: '',
        gitState: { ok: true, value: { currentBranch: 'main' } },
        checkout: { currentHead: { kind: 'branch', name: 'main', commit: 'a'.repeat(40) } } };
    },
  });
  const [a, b] = await Promise.all([reader.read('ws'), reader.read('ws')]);
  assert.equal(a, b);
  assert.equal(a.currentBranch, 'main');
  assert.equal(calls, 1);
});

test('modal current reads follow mutation generations instead of publishing obsolete bindings', async () => {
  for (const failOld of [false, true]) {
    const pending = [];
    const reader = createWorktreeViewReader({ readWorkspaceNavigation() {
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    } });
    const published = [];
    const modal = createWorktreeModalViewLoader(reader);
    const loading = modal.load('ws', (view) => published.push(view), (error) => assert.fail(error.message));
    reader.invalidate('ws');
    const freshRead = reader.read('ws');
    const data = { worktrees: [], bindings: [{ sessionId: 'new', worktreeId: 'wt' }],
      mainInstructions: '', gitState: { ok: true, value: { currentBranch: 'main' } } };
    pending[1].resolve(data);
    await freshRead;
    if (failOld) pending[0].reject(new Error('obsolete transport failure'));
    else pending[0].resolve({ ...data, bindings: [] });
    await loading;
    assert.equal(published.length, 1);
    assert.deepEqual(published[0].bindings, data.bindings);
    assert.equal(pending.length, 2, 'follow the existing fresh result without another RPC');
    reader.dispose();
  }
});

test('request-local sharing always forwards lifecycle cancellation to injected Git adapters', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'navigation-signal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const signal = new globalThis.AbortController().signal;
  const seen = [];
  const context = { signal,
    dsh: { getWorkspace: async () => ({ workspaceId: 'ws', projectId: 'p', rootPath: root }) },
    sidecar: { read: async () => ({ schemaVersion: 1, workspaceId: 'ws', revision: '0', worktrees: [], bindings: [] }) },
    git: {
      async validateRepository(_root, options) { seen.push(options?.signal); },
      async resolveRepositoryRoot(_root, options) { seen.push(options?.signal); return root; },
      async listWorktrees(_root, options) { seen.push(options?.signal); return [{ absolutePath: root, branch: 'main' }]; },
      async resolveCheckoutHead(_root, _row, options) { seen.push(options?.signal); return undefined; },
    },
  };
  await readWorkspaceNavigation(context, { workspaceId: 'ws' });
  assert.equal(seen.length, 4);
  assert.ok(seen.every((value) => value === signal));
  for (const malformed of [
    { code: 'WORKSPACE_NOT_GIT_REPOSITORY', message: 'invalid details', details: [] },
    { code: 'WORKSPACE_NOT_GIT_REPOSITORY', message: 123, details: {} },
    new Error('unexpected provider failure'),
  ]) {
    context.git.validateRepository = async () => { throw malformed; };
    await assert.rejects(readWorkspaceNavigation(context, { workspaceId: 'ws' }), (error) => error === malformed);
  }
});

test('failed native coverage reads release bounded scheduler slots', async () => {
  const reader = createWorktreeViewReader({
    async readWorkspaceNavigation() {
      return { worktrees: [], bindings: [], mainInstructions: '',
        gitState: { ok: true, value: { currentBranch: null } } };
    },
  }, (id) => { if (id !== 'good') throw new Error('native list unavailable'); return []; });
  const failed = await Promise.allSettled(['a', 'b', 'c'].map((id) => reader.read(id)));
  assert.ok(failed.every((result) => result.status === 'rejected'));
  assert.deepEqual((await reader.read('good')).knownSessionIds, []);
  reader.dispose();
});
