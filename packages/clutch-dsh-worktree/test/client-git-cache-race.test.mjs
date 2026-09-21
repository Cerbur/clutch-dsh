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

function deferred() {
  let resolve;
  const promise = new Promise((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

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
