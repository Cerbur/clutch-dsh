import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';

import { createWorktreeGitStateController } from '../lib/client/dashboard/git/useWorktreeGitState.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_D = 'd'.repeat(40);
const HEAD = 'e'.repeat(40);
const BASELINES = {
  'base-a': '1'.repeat(40),
  'base-b': '2'.repeat(40),
};

test('fresh branch reads bypass the loaded cache, share requests, and preserve rows on failure', async () => {
  let calls = 0;
  let finish;
  let reject;
  const controller = createWorktreeGitStateController({ workspaceId: 'ws', worktreeId: 'wt', manager: {
    listBranches: () => { calls++; return new Promise((resolve, fail) => { finish = resolve; reject = fail; }); },
  } });
  const initial = controller.loadBranches();
  finish([{ name: 'main' }]);
  await initial;
  await controller.loadBranches();
  assert.equal(calls, 1);
  const first = controller.readFreshBranches();
  const shared = controller.readFreshBranches();
  assert.equal(calls, 2);
  assert.deepEqual(controller.getSnapshot().branches.value, [{ name: 'main' }]);
  assert.equal(controller.getSnapshot().branches.refreshing, true);
  finish([{ name: 'terminal/new', isCurrent: true }]);
  assert.deepEqual(await first, [{ name: 'terminal/new', isCurrent: true }]);
  assert.deepEqual(await shared, [{ name: 'terminal/new', isCurrent: true }]);
  const failure = controller.readFreshBranches();
  reject(new Error('unavailable'));
  await assert.rejects(failure, /unavailable/);
  assert.deepEqual(controller.getSnapshot().branches.value, [{ name: 'terminal/new', isCurrent: true }]);
  controller.dispose();
});

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

test('Git history refresh never reads branches, including after selector use and Fetch', async () => {
  let branchReads = 0;
  const controller = createWorktreeGitStateController({ workspaceId: 'ws', worktreeId: 'wt',
    defaultBaselineBranch: 'base-a', manager: {
      listBranches: async () => { branchReads++; return [{ name: 'main' }]; },
      listWorktreeCommits: async () => historyFor('base-a'),
      listWorktreeCommitFiles: async () => ({ commit: 'summary', files: [] }),
    } });
  await controller.loadHistory();
  await controller.refresh();
  assert.equal(branchReads, 0);
  await controller.readFreshBranches();
  assert.equal(branchReads, 1);
  await controller.refresh();
  assert.equal(branchReads, 1);
  controller.acceptBranches([{ name: 'origin/fetched', kind: 'remote' }]);
  await controller.refresh();
  assert.equal(branchReads, 1);
  assert.deepEqual(controller.getSnapshot().branches.value, [{ name: 'origin/fetched', kind: 'remote' }]);
  controller.dispose();
});

async function settle() {
  await setImmediate();
  await setImmediate();
}

function historyFor(baseBranch) {
  return {
    headCommit: HEAD,
    baseline: { commit: BASELINES[baseBranch], ref: baseBranch, source: 'branch' },
    commits: [
      { sha: COMMIT_A, parents: [], subject: 'A', authorName: 'test', authoredAt: '2026-01-01T00:00:00Z' },
      { sha: COMMIT_D, parents: [], subject: 'D', authorName: 'test', authoredAt: '2026-01-01T00:00:00Z' },
    ],
    truncated: false,
  };
}

function createManager({ files, diffs }) {
  const fileRequests = [];
  const diffRequests = [];
  const manager = {
    listBranches: () => Promise.resolve([]),
    listWorktreeCommits: ({ baseBranch }) => Promise.resolve(historyFor(baseBranch)),
    listWorktreeCommitFiles: (input) => {
      if (input.selection?.kind === 'summary') return Promise.resolve({ commit: 'summary', files: [] });
      const pending = deferred();
      fileRequests.push({ input, ...pending });
      return files === undefined ? pending.promise : Promise.resolve(files(input));
    },
    getWorktreeCommitFileDiff: (input) => {
      const pending = deferred();
      diffRequests.push({ input, ...pending });
      return diffs === undefined ? pending.promise : Promise.resolve(diffs(input));
    },
  };
  return { manager, fileRequests, diffRequests };
}

async function createController(options = {}) {
  const fixture = createManager(options);
  const controller = createWorktreeGitStateController({
    manager: fixture.manager,
    workspaceId: 'ws',
    worktreeId: 'wt',
    defaultBaselineBranch: 'base-a',
  });
  await controller.loadHistory();
  await settle();
  return { controller, ...fixture };
}

async function switchBaseline(controller, branch) {
  controller.selectBaselineBranch(branch);
  await controller.loadHistory();
  await settle();
}

function textFiles(additions, deletions) {
  return { commit: COMMIT_A, files: [{ path: 'x.txt', status: 'modified', additions, deletions }] };
}

test('does not let a stale commit-file response poison a revisited cache entry', async () => {
  const fixture = await createController({
    diffs: () => ({ commit: COMMIT_A, path: 'x.txt', patch: 'fresh', binary: false }),
  });
  const { controller, fileRequests } = fixture;

  controller.selectCommit(COMMIT_A);
  const stale = fileRequests.at(-1);
  assert.equal(stale.input.baseBranch, 'base-a');

  await switchBaseline(controller, 'base-b');
  await switchBaseline(controller, 'base-a');
  controller.selectCommit(COMMIT_A);
  const fresh = fileRequests.at(-1);
  assert.notEqual(fresh, stale);
  fresh.resolve(textFiles(20, 4));
  await settle();

  stale.resolve({ commit: COMMIT_A, files: [{ path: 'x.txt', status: 'modified' }] });
  await settle();

  controller.selectCommit(COMMIT_D);
  const other = fileRequests.at(-1);
  other.resolve({ commit: COMMIT_D, files: [] });
  await settle();
  controller.selectCommit(COMMIT_A);
  await settle();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.files.status, 'ready');
  assert.deepEqual(snapshot.files.value.files[0], {
    path: 'x.txt',
    status: 'modified',
    additions: 20,
    deletions: 4,
  });
  controller.dispose();
});

test('does not let a stale commit diff response poison a revisited cache entry', async () => {
  const fixture = await createController({
    files: (input) => input.commit === COMMIT_D ? { commit: COMMIT_D, files: [] } : textFiles(20, 4),
  });
  const { controller, diffRequests } = fixture;

  controller.selectCommit(COMMIT_A);
  await settle();
  const stale = diffRequests.at(-1);
  assert.equal(stale.input.baseBranch, 'base-a');

  await switchBaseline(controller, 'base-b');
  await switchBaseline(controller, 'base-a');
  controller.selectCommit(COMMIT_A);
  await settle();
  const fresh = diffRequests.at(-1);
  assert.notEqual(fresh, stale);
  fresh.resolve({ commit: COMMIT_A, path: 'x.txt', patch: 'fresh', binary: false });
  await settle();

  stale.resolve({ commit: COMMIT_A, path: 'x.txt', patch: 'stale', binary: false });
  await settle();

  controller.selectCommit(COMMIT_D);
  await settle();
  const other = diffRequests.at(-1);
  other.resolve({ commit: COMMIT_D, path: 'x.txt', patch: 'other', binary: false });
  await settle();
  controller.selectCommit(COMMIT_A);
  await settle();
  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.diff.status, 'ready');
  assert.equal(snapshot.diff.value.patch, 'fresh');
  controller.dispose();
});
