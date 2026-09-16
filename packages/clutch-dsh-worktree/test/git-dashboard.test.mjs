import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { createWorktreeGitStateController } from '../lib/client/dashboard/git/useWorktreeGitState.js';
import {
  LocalGitAdapter,
  WORKTREE_GIT_WORKING_TREE,
  WorkspaceShardedSidecarRepository,
  createWorktreeManager,
} from '../lib/index.js';

const execFile = promisify(execFileCallback);

async function runGit(cwd, args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

/** Record every Manager-visible Git call by adapter method name. */
function recordGitCalls(adapter, calls) {
  return new Proxy(adapter, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return (...args) => {
        calls.push(String(property));
        return value.apply(target, args);
      };
    },
  });
}

async function createFixture(options = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-git-dashboard-'));
  const dshHome = path.join(tempRoot, 'dsh-home');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  await mkdir(dshHome, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await runGit(workspaceRoot, ['init']);
  await runGit(workspaceRoot, ['config', 'user.email', 'test@example.invalid']);
  await runGit(workspaceRoot, ['config', 'user.name', 'Dashboard Test']);
  await runGit(workspaceRoot, ['branch', '-M', 'main']);
  await writeFile(path.join(workspaceRoot, 'README.md'), '# baseline\n');
  await runGit(workspaceRoot, ['add', 'README.md']);
  await runGit(workspaceRoot, ['commit', '-m', 'baseline']);

  const dsh = {
    async getWorkspace(workspaceId) {
      return workspaceId === 'ws_dashboard'
        ? { workspaceId, projectId: 'project_dashboard', rootPath: workspaceRoot }
        : undefined;
    },
    async getSession() {
      return undefined;
    },
    async listSessions() {
      return [];
    },
  };
  const sidecar = new WorkspaceShardedSidecarRepository({ dshHome });
  const manager = createWorktreeManager({ dsh, dshHome, sidecar, git: options.git });
  return { tempRoot, dshHome, workspaceRoot, sidecar, manager };
}

test('persists a manually selected baseline branch and rejects the current branch', async () => {
  const fixture = await createFixture();
  try {
    await runGit(fixture.workspaceRoot, ['branch', 'develop']);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/baseline-editor',
    });

    const saved = await fixture.manager.updateWorktreeBaseBranch({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'develop',
      expectedBaseBranch: record.baseBranch,
    });
    assert.equal(saved, 'develop');
    const snapshot = await fixture.sidecar.read('ws_dashboard');
    const savedRecord = snapshot.worktrees.find((item) => item.worktreeId === record.worktreeId);
    assert.equal(savedRecord.baseBranch, 'develop');
    assert.equal(savedRecord.baseCommit, record.baseCommit);

    await assert.rejects(
      fixture.manager.updateWorktreeBaseBranch({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        baseBranch: record.branch,
        expectedBaseBranch: 'develop',
      }),
      (error) => error.code === 'WORKTREE_STATE_CONFLICT',
    );
    await assert.rejects(
      fixture.manager.updateWorktreeBaseBranch({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        baseBranch: 'main',
        expectedBaseBranch: record.baseBranch,
      }),
      (error) => error.code === 'WORKTREE_STATE_CONFLICT',
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('captures an immutable baseline and serves commit history, files, and a file diff', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/dashboard',
    });
    assert.match(record.baseCommit, /^[0-9a-f]{40}$/u);

    const targetPath = record.absolutePath;
    await writeFile(path.join(targetPath, 'change.txt'), 'first\n');
    await runGit(targetPath, ['add', 'change.txt']);
    await runGit(targetPath, ['commit', '-m', 'add dashboard file']);
    const firstCommit = (await runGit(targetPath, ['rev-parse', 'HEAD'])).stdout.trim();

    await writeFile(path.join(targetPath, 'change.txt'), 'first\nsecond\n');
    await runGit(targetPath, ['add', 'change.txt']);
    await runGit(targetPath, ['commit', '-m', 'update dashboard file']);
    const secondCommit = (await runGit(targetPath, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(fixture.workspaceRoot, ['branch', 'dashboard-baseline']);

    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    assert.equal(history.baseline.commit, record.baseCommit);
    assert.equal(history.baseline.source, 'captured');
    assert.deepEqual(history.commits.map((commit) => commit.sha), [secondCommit, firstCommit]);
    assert.equal(history.headCommit, secondCommit);
    assert.equal(history.truncated, false);

    const selectedHistory = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'dashboard-baseline',
    });
    assert.equal(selectedHistory.baseline.ref, 'dashboard-baseline');
    assert.equal(selectedHistory.baseline.source, 'branch');
    assert.equal(selectedHistory.baseline.commit, record.baseCommit);
    assert.deepEqual(selectedHistory.commits.map((commit) => commit.sha), [secondCommit, firstCommit]);

    await assert.rejects(
      fixture.manager.listWorktreeCommits({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        baseBranch: 'refs/heads/dashboard-baseline',
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    const selectedFiles = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: firstCommit,
      baseBranch: 'dashboard-baseline',
    });
    assert.deepEqual(selectedFiles.files, [{ path: 'change.txt', status: 'added', additions: 1, deletions: 0 }]);
    const selectedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: secondCommit,
      path: 'change.txt',
      baseBranch: 'dashboard-baseline',
    });
    assert.equal(selectedDiff.binary, false);
    assert.match(selectedDiff.patch, /\+second/u);

    const files = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: firstCommit,
    });
    assert.deepEqual(files.files, [{ path: 'change.txt', status: 'added', additions: 1, deletions: 0 }]);

    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: secondCommit,
      path: 'change.txt',
    });
    assert.equal(diff.binary, false);
    assert.match(diff.patch, /\+second/u);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('reports ahead-behind status and line counts for changed files', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/line-stats',
    });
    const targetPath = record.absolutePath;
    await writeFile(path.join(targetPath, 'change.txt'), 'first\n');
    await runGit(targetPath, ['add', 'change.txt']);
    await runGit(targetPath, ['commit', '-m', 'add line stats file']);

    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    assert.equal(history.ahead, 1);
    assert.equal(history.behind, 0);

    const commit = history.commits.find((candidate) => candidate.sha !== WORKTREE_GIT_WORKING_TREE);
    assert.ok(commit);
    assert.equal(commit.kind, undefined);
    const committedFiles = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: commit.sha,
    });
    assert.deepEqual(committedFiles.files, [{
      path: 'change.txt',
      status: 'added',
      additions: 1,
      deletions: 0,
    }]);

    await writeFile(path.join(targetPath, 'change.txt'), 'first\nsecond\n');
    await writeFile(path.join(targetPath, 'untracked.txt'), 'new\n');
    const workingTreeFiles = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: WORKTREE_GIT_WORKING_TREE,
    });
    assert.deepEqual(
      workingTreeFiles.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'change.txt', status: 'modified', additions: 1, deletions: 0 },
        { path: 'untracked.txt', status: 'added', additions: 1, deletions: 0 },
      ],
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('puts staged, unstaged, and untracked changes at the top of history', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/working-tree',
    });
    const targetPath = record.absolutePath;
    await writeFile(path.join(targetPath, 'README.md'), '# baseline\nunstaged\n');
    await writeFile(path.join(targetPath, 'staged.txt'), 'staged\n');
    await runGit(targetPath, ['add', 'staged.txt']);
    await writeFile(path.join(targetPath, 'untracked.txt'), 'untracked\n');

    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    assert.equal(history.commits[0].sha, WORKTREE_GIT_WORKING_TREE);
    assert.equal(history.commits[0].kind, 'working-tree');
    assert.equal(history.commits.length, 1);
    assert.equal(history.headCommit, record.baseCommit);

    const files = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: WORKTREE_GIT_WORKING_TREE,
    });
    assert.deepEqual(
      files.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'README.md', status: 'modified', additions: 1, deletions: 0 },
        { path: 'staged.txt', status: 'added', additions: 1, deletions: 0 },
        { path: 'untracked.txt', status: 'added', additions: 1, deletions: 0 },
      ],
    );

    const trackedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: WORKTREE_GIT_WORKING_TREE,
      path: 'README.md',
    });
    assert.equal(trackedDiff.commit, WORKTREE_GIT_WORKING_TREE);
    assert.match(trackedDiff.patch, /\+unstaged/u);

    const untrackedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: WORKTREE_GIT_WORKING_TREE,
      path: 'untracked.txt',
    });
    assert.equal(untrackedDiff.binary, false);
    assert.match(untrackedDiff.patch, /\+untracked/u);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects baseline commits and paths that are outside the authorized Worktree projection', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/security',
    });
    await writeFile(path.join(record.absolutePath, 'allowed.txt'), 'allowed\n');
    await runGit(record.absolutePath, ['add', 'allowed.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'authorized change']);
    const commit = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();

    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        commit: record.baseCommit,
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    await assert.rejects(
      fixture.manager.getWorktreeCommitFileDiff({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        commit,
        path: 'README.md',
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    await assert.rejects(
      fixture.manager.getWorktreeCommitFileDiff({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        commit: 'not-a-commit',
        path: 'allowed.txt',
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('keeps the captured baseline stable when the source branch moves and compares merge files to the first parent', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/merge-dashboard',
    });
    const baseline = record.baseCommit;

    await writeFile(path.join(fixture.workspaceRoot, 'main-after-acquisition.txt'), 'main moved\n');
    await runGit(fixture.workspaceRoot, ['add', 'main-after-acquisition.txt']);
    await runGit(fixture.workspaceRoot, ['commit', '-m', 'move acquisition branch']);

    await writeFile(path.join(record.absolutePath, 'feature.txt'), 'feature\n');
    await runGit(record.absolutePath, ['add', 'feature.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'feature parent']);
    await runGit(record.absolutePath, ['checkout', '-b', 'dashboard-merge-side']);
    await writeFile(path.join(record.absolutePath, 'side.txt'), 'side\n');
    await runGit(record.absolutePath, ['add', 'side.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'merge side']);
    await runGit(record.absolutePath, ['checkout', record.branch]);
    await runGit(record.absolutePath, ['merge', '--no-ff', 'dashboard-merge-side', '-m', 'merge dashboard side']);

    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    const mergeCommit = history.commits.find((commit) => commit.subject === 'merge dashboard side');
    assert.equal(record.baseCommit, baseline);
    assert.equal(history.baseline.commit, baseline);
    assert.equal(mergeCommit?.parents.length, 2);

    const files = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      commit: mergeCommit.sha,
    });
    assert.deepEqual(files.files, [{ path: 'side.txt', status: 'added', additions: 1, deletions: 0 }]);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('uses the merge base when the selected base branch advances', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/merge-base',
    });
    await writeFile(path.join(fixture.workspaceRoot, 'base-only.txt'), 'base branch change\n');
    await runGit(fixture.workspaceRoot, ['add', 'base-only.txt']);
    await runGit(fixture.workspaceRoot, ['commit', '-m', 'advance selected base']);
    await writeFile(path.join(fixture.workspaceRoot, 'base-only-2.txt'), 'second base branch change\n');
    await runGit(fixture.workspaceRoot, ['add', 'base-only-2.txt']);
    await runGit(fixture.workspaceRoot, ['commit', '-m', 'advance selected base again']);

    await writeFile(path.join(record.absolutePath, 'feature-only.txt'), 'feature branch change\n');
    await runGit(record.absolutePath, ['add', 'feature-only.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'add feature change']);
    const featureHead = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();
    const commonAncestor = (await runGit(record.absolutePath, ['merge-base', 'main', 'HEAD'])).stdout.trim();
    const selectedBaseHead = (await runGit(fixture.workspaceRoot, ['rev-parse', 'main'])).stdout.trim();

    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
    });
    assert.equal(history.baseline.ref, 'main');
    assert.equal(history.baseline.commit, selectedBaseHead);
    assert.notEqual(history.baseline.commit, commonAncestor);
    assert.equal(history.headCommit, featureHead);
    assert.equal(history.ahead, 1);
    assert.equal(history.behind, 2);
    assert.deepEqual(history.commits.map((commit) => commit.sha), [featureHead]);

    const summary = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      selection: { kind: 'summary' },
    });
    assert.deepEqual(summary.files, [{
      path: 'feature-only.txt',
      status: 'added',
      additions: 1,
      deletions: 0,
    }]);
    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      selection: { kind: 'summary' },
      path: 'feature-only.txt',
    });
    assert.match(diff.patch, /\+feature branch change/u);

    await writeFile(path.join(record.absolutePath, 'feature-only.txt'), 'feature branch change\nworking tree change\n');
    const liveSummary = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      selection: { kind: 'summary', includeWorkingTree: true },
    });
    assert.deepEqual(liveSummary.files, [{
      path: 'feature-only.txt',
      status: 'added',
      additions: 2,
      deletions: 0,
    }]);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('falls back to a full two-branch diff when no common ancestor exists', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/unrelated-history',
    });
    await runGit(record.absolutePath, ['checkout', '--orphan', 'unrelated-dashboard']);
    await runGit(record.absolutePath, ['rm', '-r', '-f', '--ignore-unmatch', '.']);
    await writeFile(path.join(record.absolutePath, 'unrelated.txt'), 'unrelated\n');
    await runGit(record.absolutePath, ['add', 'unrelated.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'unrelated history']);
    const headCommit = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();
    const baseHead = (await runGit(fixture.workspaceRoot, ['rev-parse', 'main'])).stdout.trim();

    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
    });
    assert.equal(history.baseline.ref, 'main');
    assert.equal(history.baseline.commit, baseHead);
    assert.equal(history.headCommit, headCommit);
    assert.equal(history.ahead, 1);
    assert.equal(history.behind, 1);
    assert.deepEqual(history.commits.map((commit) => commit.sha), [headCommit]);

    const summary = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      selection: { kind: 'summary' },
    });
    assert.deepEqual(
      summary.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'README.md', status: 'deleted', additions: 0, deletions: 1 },
        { path: 'unrelated.txt', status: 'added', additions: 1, deletions: 0 },
      ],
    );
    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      selection: { kind: 'summary' },
      path: 'unrelated.txt',
    });
    assert.match(diff.patch, /\+unrelated/u);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('falls back to a full tree diff when a captured baseline has no common ancestor', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/history-rewrite',
    });
    await runGit(record.absolutePath, ['checkout', '--orphan', 'unrelated-dashboard']);
    await runGit(record.absolutePath, ['rm', '-r', '-f', '--ignore-unmatch', '.']);
    await writeFile(path.join(record.absolutePath, 'unrelated.txt'), 'unrelated\n');
    await runGit(record.absolutePath, ['add', 'unrelated.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'unrelated history']);
    const unrelatedCommit = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();

    const capturedHistory = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    assert.equal(capturedHistory.baseline.commit, record.baseCommit);
    assert.equal(capturedHistory.baseline.source, 'captured');
    assert.equal(capturedHistory.ahead, 1);
    assert.equal(capturedHistory.behind, 1);
    assert.deepEqual(capturedHistory.commits.map((commit) => commit.sha), [unrelatedCommit]);

    const capturedSummary = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary' },
    });
    assert.deepEqual(
      capturedSummary.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'README.md', status: 'deleted', additions: 0, deletions: 1 },
        { path: 'unrelated.txt', status: 'added', additions: 1, deletions: 0 },
      ],
    );
    const capturedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary' },
      path: 'unrelated.txt',
    });
    assert.match(capturedDiff.patch, /\+unrelated/u);

    await fixture.sidecar.mutate('ws_dashboard', (snapshot) => ({
      result: undefined,
      snapshot: {
        ...snapshot,
        worktrees: snapshot.worktrees.map((candidate) => {
          if (candidate.worktreeId !== record.worktreeId) return candidate;
          const { baseCommit: _baseCommit, ...legacy } = candidate;
          void _baseCommit;
          return legacy;
        }),
      },
    }));
    const legacyHistory = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    assert.deepEqual(legacyHistory, {
      commits: [],
      truncated: false,
      unavailableReason: 'baseline-unknown',
    });
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('keeps Main and ambiguous legacy Worktrees unavailable while deriving only a legacy branch baseline', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/legacy',
    });
    await writeFile(path.join(record.absolutePath, 'legacy.txt'), 'legacy\n');
    await runGit(record.absolutePath, ['add', 'legacy.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'legacy change']);

    await fixture.sidecar.mutate('ws_dashboard', (snapshot) => ({
      result: undefined,
      snapshot: {
        ...snapshot,
        worktrees: snapshot.worktrees.map(({ baseCommit: _baseCommit, ...item }) => ({
          ...item,
          baseBranch: 'main',
        })),
      },
    }));
    const derived = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    assert.equal(derived.baseline.source, 'derived');
    assert.equal(derived.commits.length, 1);

    await fixture.sidecar.mutate('ws_dashboard', (snapshot) => ({
      result: undefined,
      snapshot: {
        ...snapshot,
        worktrees: snapshot.worktrees.map((item) => ({ ...item, baseBranch: 'feature/legacy' })),
      },
    }));
    const ambiguous = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
    });
    assert.deepEqual(ambiguous, {
      commits: [],
      truncated: false,
      unavailableReason: 'baseline-unknown',
    });

    assert.deepEqual(
      await fixture.manager.listWorktreeCommits({ workspaceId: 'ws_dashboard', worktreeId: 'main' }),
      { commits: [], truncated: false, unavailableReason: 'main' },
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('defaults Git history to the Baseline summary, preserves ready refresh content, and ignores stale commit/file responses', async () => {
  const firstCommit = '1'.repeat(40);
  const secondCommit = '2'.repeat(40);
  const calls = [];
  const historyResponse = deferred();
  const fileResponses = new Map();
  const diffResponses = new Map();
  const manager = {
    listWorktreeCommits() {
      calls.push('history');
      return historyResponse.promise;
    },
    listWorktreeCommitFiles({ commit, selection }) {
      const target = selection?.kind === 'summary' ? 'summary' : commit;
      calls.push(`files:${target}`);
      const response = deferred();
      fileResponses.set(target, response);
      return response.promise;
    },
    getWorktreeCommitFileDiff({ commit, path: filePath }) {
      calls.push(`diff:${commit}:${filePath}`);
      const response = deferred();
      diffResponses.set(`${commit}:${filePath}`, response);
      return response.promise;
    },
  };
  const controller = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
    defaultBaselineBranch: 'main',
  });
  assert.deepEqual(calls, []);

  const historyTask = controller.loadHistory();
  assert.deepEqual(calls, ['history']);
  historyResponse.resolve({
    headCommit: secondCommit,
    baseline: { commit: '0'.repeat(40), source: 'captured' },
    commits: [
      {
        sha: secondCommit,
        parents: [firstCommit],
        subject: 'second',
        authorName: 'Test',
        authoredAt: '2026-09-14T00:00:00Z',
      },
      {
        sha: firstCommit,
        parents: ['0'.repeat(40)],
        subject: 'first',
        authorName: 'Test',
        authoredAt: '2026-09-13T00:00:00Z',
      },
    ],
    truncated: false,
  });
  await historyTask;
  await flush();
  assert.equal(controller.getSnapshot().view, 'summary');
  assert.equal(controller.getSnapshot().selectedCommit, undefined);
  assert.deepEqual(controller.getSnapshot().selectedCommits, []);
  assert.equal(fileResponses.has('summary'), true);
  fileResponses.get('summary').resolve({ commit: 'summary', selection: { kind: 'summary' }, files: [] });
  await flush();

  controller.selectCommit(secondCommit);
  assert.equal(fileResponses.has(secondCommit), true);

  const firstFiles = fileResponses.get(secondCommit);
  firstFiles.resolve({
    commit: secondCommit,
    files: [
      { path: 'one.txt', status: 'modified' },
      { path: 'two.txt', status: 'added' },
    ],
  });
  await flush();
  assert.equal(diffResponses.has(`${secondCommit}:one.txt`), true);

  controller.selectPath('two.txt');
  assert.equal(diffResponses.has(`${secondCommit}:two.txt`), true);
  diffResponses.get(`${secondCommit}:two.txt`).resolve({
    commit: secondCommit,
    path: 'two.txt',
    patch: '@@ -0,0 +1 @@\n+two\n',
    binary: false,
  });
  diffResponses.get(`${secondCommit}:one.txt`).resolve({
    commit: secondCommit,
    path: 'one.txt',
    patch: '@@ -1 +1 @@\n-one\n+late\n',
    binary: false,
  });
  await flush();
  assert.equal(controller.getSnapshot().selectedPath, 'two.txt');
  assert.equal(controller.getSnapshot().diff.status, 'ready');
  assert.equal(controller.getSnapshot().diff.value.path, 'two.txt');

  const refreshResponse = deferred();
  manager.listWorktreeCommits = () => {
    calls.push('history:refresh');
    return refreshResponse.promise;
  };
  const refreshTask = controller.refresh();
  assert.equal(controller.getSnapshot().history.status, 'ready');
  assert.equal(controller.getSnapshot().history.refreshing, true);
  assert.equal(controller.getSnapshot().history.value.headCommit, secondCommit);
  refreshResponse.resolve({
    headCommit: secondCommit,
    baseline: { commit: '0'.repeat(40), source: 'captured' },
    commits: [],
    truncated: false,
  });
  await refreshTask;
  assert.equal(controller.getSnapshot().history.status, 'ready');
  assert.equal(controller.getSnapshot().history.value.commits.length, 0);
  controller.dispose();
});

test('selects the working-tree entry explicitly and refreshes its live files', async () => {
  const committed = 'a'.repeat(40);
  let history = {
    headCommit: committed,
    baseline: { commit: '0'.repeat(40), source: 'captured' },
    commits: [
      {
        sha: WORKTREE_GIT_WORKING_TREE,
        kind: 'working-tree',
        parents: [committed],
        subject: '',
        authorName: '',
        authoredAt: '',
      },
      {
        sha: committed,
        parents: ['0'.repeat(40)],
        subject: 'committed',
        authorName: 'Test',
        authoredAt: '2026-09-14T00:00:00Z',
      },
    ],
    truncated: false,
  };
  let version = 1;
  const fileCalls = [];
  const manager = {
    listWorktreeCommits() {
      return Promise.resolve(history);
    },
    listWorktreeCommitFiles({ commit, selection }) {
      const target = selection?.kind === 'summary' ? 'summary' : commit;
      fileCalls.push(target);
      const path = target === WORKTREE_GIT_WORKING_TREE
        ? `working-${version}.txt`
        : target === 'summary'
          ? 'summary.txt'
          : 'committed.txt';
      return Promise.resolve({ commit: target, selection, files: [{ path, status: 'modified' }] });
    },
    getWorktreeCommitFileDiff({ commit, selection, path }) {
      return Promise.resolve({ commit, selection, path, patch: `+${version}\n`, binary: false });
    },
  };
  const controller = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
    defaultBaselineBranch: 'main',
  });

  await controller.loadHistory();
  await flush();
  assert.equal(controller.getSnapshot().view, 'summary');
  assert.equal(controller.getSnapshot().selectedCommit, undefined);
  assert.deepEqual(fileCalls, ['summary']);

  controller.selectCommit(WORKTREE_GIT_WORKING_TREE);
  await flush();
  assert.equal(controller.getSnapshot().selectedCommit, WORKTREE_GIT_WORKING_TREE);
  assert.deepEqual(fileCalls, ['summary', WORKTREE_GIT_WORKING_TREE]);
  assert.equal(controller.getSnapshot().selectedPath, 'working-1.txt');

  version = 2;
  await controller.refresh();
  await flush();
  assert.equal(controller.getSnapshot().selectedCommit, WORKTREE_GIT_WORKING_TREE);
  assert.equal(controller.getSnapshot().selectedPath, 'working-2.txt');
  assert.deepEqual(fileCalls, ['summary', WORKTREE_GIT_WORKING_TREE, WORKTREE_GIT_WORKING_TREE]);

  history = { ...history, commits: [history.commits[1]] };
  await controller.refresh();
  await flush();
  assert.equal(controller.getSnapshot().selectedCommit, committed);
  assert.equal(controller.getSnapshot().selectedPath, 'committed.txt');
  controller.dispose();
});

test('shares equivalent in-flight history, file, and diff reads', async () => {
  const commit = '3'.repeat(40);
  const parent = '2'.repeat(40);
  const historyResponse = deferred();
  const summaryFilesResponse = deferred();
  const commitFilesResponse = deferred();
  const diffResponse = deferred();
  let historyCalls = 0;
  let filesCalls = 0;
  let diffCalls = 0;
  const manager = {
    listWorktreeCommits() {
      historyCalls += 1;
      return historyResponse.promise;
    },
    listWorktreeCommitFiles({ selection }) {
      filesCalls += 1;
      return (selection?.kind === 'summary' ? summaryFilesResponse : commitFilesResponse).promise;
    },
    getWorktreeCommitFileDiff() {
      diffCalls += 1;
      return diffResponse.promise;
    },
  };
  const controller = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
    defaultBaselineBranch: 'main',
  });

  const firstHistoryTask = controller.loadHistory();
  assert.equal(controller.loadHistory(), firstHistoryTask);
  assert.equal(historyCalls, 1);
  historyResponse.resolve({
    headCommit: commit,
    baseline: { commit: '1'.repeat(40), source: 'captured' },
    commits: [{
      sha: commit,
      parents: [parent],
      subject: 'shared request',
      authorName: 'Test',
      authoredAt: '2026-09-14T00:00:00Z',
    }],
    truncated: false,
  });
  await firstHistoryTask;
  assert.equal(filesCalls, 1);
  controller.selectCommit(commit);
  assert.equal(filesCalls, 2);

  summaryFilesResponse.resolve({ commit: 'summary', selection: { kind: 'summary' }, files: [] });
  commitFilesResponse.resolve({
    commit,
    files: [{ path: 'shared.txt', status: 'modified' }],
  });
  await flush();
  await flush();
  controller.selectPath('shared.txt');
  assert.equal(diffCalls, 1);
  controller.selectPath('shared.txt');
  assert.equal(diffCalls, 1);

  diffResponse.resolve({
    commit,
    path: 'shared.txt',
    patch: '@@ -1 +1 @@\n-old\n+new\n',
    binary: false,
  });
  await flush();
  assert.equal(controller.getSnapshot().diff.status, 'ready');
  controller.dispose();
});

test('defaults to the Baseline summary and stays unselected without a creation branch', async () => {
  const branches = [
    { name: 'main', isCurrent: true, checkedOut: true },
    { name: 'develop', isCurrent: false, checkedOut: false },
  ];
  const historyBranches = [];
  const manager = {
    listBranches() {
      return Promise.resolve(branches);
    },
    listWorktreeCommits({ baseBranch }) {
      historyBranches.push(baseBranch);
      return Promise.resolve({
        headCommit: 'f'.repeat(40),
        baseline: { commit: '0'.repeat(40), ref: baseBranch, source: 'branch' },
        commits: [],
        truncated: false,
      });
    },
    listWorktreeCommitFiles() {
      return Promise.resolve({ commit: 'working-tree', files: [] });
    },
    getWorktreeCommitFileDiff() {
      return Promise.resolve({ commit: 'working-tree', path: 'file.txt', patch: '', binary: false });
    },
  };

  const defaultController = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
    defaultBaselineBranch: 'main',
  });
  await defaultController.loadHistory();
  assert.deepEqual(historyBranches, ['main']);
  assert.equal(defaultController.getSnapshot().view, 'summary');
  assert.equal(defaultController.getSnapshot().selectedCommit, undefined);
  assert.deepEqual(defaultController.getSnapshot().selectedCommits, []);
  defaultController.dispose();
  historyBranches.length = 0;

  const controller = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
  });
  assert.equal(controller.getSnapshot().baselineBranch, undefined);
  await controller.loadBranches();
  await controller.loadHistory();
  assert.deepEqual(historyBranches, []);
  assert.equal(controller.getSnapshot().history.status, 'idle');

  controller.selectBaselineBranch('main');
  await flush();
  assert.deepEqual(historyBranches, ['main']);
  assert.equal(controller.getSnapshot().view, 'summary');
  assert.equal(controller.getSnapshot().history.status, 'ready');

  controller.selectBaselineBranch('develop');
  await flush();
  assert.deepEqual(historyBranches, ['main', 'develop']);
  assert.equal(controller.getSnapshot().baselineBranch, 'develop');

  controller.selectBaselineBranch(undefined);
  assert.equal(controller.getSnapshot().baselineBranch, undefined);
  assert.equal(controller.getSnapshot().history.status, 'idle');
  controller.dispose();
});

test('supports aggregate state targets', async () => {
  const first = '1'.repeat(40);
  const second = '2'.repeat(40);
  const calls = [];
  const manager = {
    listWorktreeCommits: () => Promise.resolve({ headCommit: second, baseline: { commit: '0'.repeat(40), source: 'captured' }, commits: [{ sha: second, parents: [first], subject: 'second', authorName: 'Test', authoredAt: '2026-09-14T00:00:00Z' }, { sha: first, parents: ['0'.repeat(40)], subject: 'first', authorName: 'Test', authoredAt: '2026-09-13T00:00:00Z' }], truncated: false }),
    listWorktreeCommitFiles: (input) => { calls.push(input); return Promise.resolve({ commit: input.commit || 'summary', selection: input.selection, files: [] }); },
    getWorktreeCommitFileDiff: (input) => Promise.resolve({ commit: input.commit || 'summary', selection: input.selection, path: input.path, patch: '', binary: false }),
  };
  const controller = createWorktreeGitStateController({ manager, workspaceId: 'ws_dashboard', worktreeId: 'wt_dashboard', defaultBaselineBranch: 'main' });
  await controller.loadHistory();
  await flush();
  assert.equal(controller.getSnapshot().view, 'summary');
  assert.equal(controller.getSnapshot().selectedCommit, undefined);
  controller.toggleCommit(second);
  await flush();
  controller.toggleCommit(first);
  await flush();
  assert.deepEqual(calls[calls.length - 1].selection, { kind: 'commits', commits: [second, first] });
  const callsBeforeSummary = calls.length;
  controller.selectSummary();
  await flush();
  assert.equal(controller.getSnapshot().view, 'summary');
  assert.deepEqual(controller.getSnapshot().selectedCommits, []);
  assert.equal(calls.length, callsBeforeSummary);
  controller.setIncludeWorkingTree(true);
  await flush();
  assert.equal(controller.getSnapshot().includeWorkingTree, true);
  assert.deepEqual(calls[calls.length - 1].selection, { kind: 'summary', includeWorkingTree: true });
  const liveCallsBeforeRepeat = calls.length;
  controller.selectSummary();
  await flush();
  assert.equal(calls.length, liveCallsBeforeRepeat + 1);
  const callsBeforeDisable = calls.length;
  controller.setIncludeWorkingTree(false);
  await flush();
  assert.equal(controller.getSnapshot().includeWorkingTree, false);
  assert.equal(calls.length, callsBeforeDisable);
  controller.dispose();
});

test('retires pending live summary reads on refresh and target changes', async () => {
  const commit = 'c'.repeat(40);
  const history = {
    headCommit: commit,
    baseline: { commit: '0'.repeat(40), source: 'captured' },
    commits: [{ sha: commit, parents: ['0'.repeat(40)], subject: 'commit', authorName: 'Test', authoredAt: '2026-09-14T00:00:00Z' }],
    truncated: false,
  };
  const liveResponses = [];
  const manager = {
    listWorktreeCommits: () => Promise.resolve(history),
    listWorktreeCommitFiles: (input) => {
      if (input.selection?.kind === 'summary' && input.selection.includeWorkingTree === true) {
        const response = deferred();
        liveResponses.push(response);
        return response.promise;
      }
      return Promise.resolve({ commit: input.commit ?? 'summary', files: [] });
    },
    getWorktreeCommitFileDiff: (input) => Promise.resolve({ commit: 'summary', path: input.path, patch: '', binary: false }),
  };
  const controller = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
    defaultBaselineBranch: 'main',
  });
  await controller.loadHistory();
  await flush();
  controller.setIncludeWorkingTree(true);
  assert.equal(liveResponses.length, 1);

  const refreshTask = controller.refresh();
  await refreshTask;
  await flush();
  assert.equal(liveResponses.length, 2);
  liveResponses[0].resolve({ commit: 'summary', files: [{ path: 'stale.txt', status: 'modified' }] });
  liveResponses[1].resolve({ commit: 'summary', files: [{ path: 'fresh.txt', status: 'modified' }] });
  await flush();
  await flush();
  assert.equal(controller.getSnapshot().files.status, 'ready');
  assert.deepEqual(controller.getSnapshot().files.value.files, [{ path: 'fresh.txt', status: 'modified' }]);

  controller.selectSummary();
  await flush();
  assert.equal(liveResponses.length, 3);
  controller.selectCommit(commit);
  await flush();
  controller.setIncludeWorkingTree(true);
  controller.selectSummary();
  await flush();
  assert.equal(liveResponses.length, 4);
  liveResponses[2].resolve({ commit: 'summary', files: [{ path: 'stale-again.txt', status: 'modified' }] });
  liveResponses[3].resolve({ commit: 'summary', files: [{ path: 'fresh-again.txt', status: 'modified' }] });
  await flush();
  await flush();
  assert.deepEqual(controller.getSnapshot().files.value.files, [{ path: 'fresh-again.txt', status: 'modified' }]);
  controller.dispose();
});
test('serves baseline summary and exact selected-commit sections', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/aggregate',
    });
    await writeFile(path.join(record.absolutePath, 'aggregate.txt'), 'first\n');
    await runGit(record.absolutePath, ['add', 'aggregate.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'add aggregate file']);
    const firstCommit = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(path.join(record.absolutePath, 'aggregate.txt'), 'first\nsecond\n');
    await writeFile(path.join(record.absolutePath, 'other.txt'), 'other\n');
    await runGit(record.absolutePath, ['add', 'aggregate.txt', 'other.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'update aggregate files']);
    const secondCommit = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();

    const summary = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary' },
    });
    assert.equal(summary.commit, 'summary');
    assert.deepEqual(summary.selection, { kind: 'summary' });
    assert.deepEqual(summary.files.map((file) => file.path).toSorted(), ['aggregate.txt', 'other.txt']);
    assert.deepEqual(
      summary.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'aggregate.txt', status: 'added', additions: 2, deletions: 0 },
        { path: 'other.txt', status: 'added', additions: 1, deletions: 0 },
      ],
    );
    const summaryDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary' },
      path: 'aggregate.txt',
    });
    assert.equal(summaryDiff.selection.kind, 'summary');
    assert.match(summaryDiff.patch, /[+]second/u);

    const aggregate = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'commits', commits: [firstCommit, secondCommit] },
    });
    assert.deepEqual(aggregate.selection, { kind: 'commits', commits: [firstCommit, secondCommit] });
    const aggregateFile = aggregate.files.find((file) => file.path === 'aggregate.txt');
    assert.deepEqual(aggregateFile.commits, [firstCommit, secondCommit]);
    const aggregateDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'commits', commits: [firstCommit, secondCommit] },
      path: 'aggregate.txt',
    });
    assert.equal(aggregateDiff.segments.length, 2);
    assert.deepEqual(aggregateDiff.segments.map((segment) => segment.commit), [firstCommit, secondCommit]);
    assert.match(aggregateDiff.segments[0].patch, /[+]first/u);
    assert.match(aggregateDiff.segments[1].patch, /[+]second/u);

    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        selection: { kind: 'commits', commits: [firstCommit, firstCommit] },
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles({
        workspaceId: 'ws_dashboard',
        worktreeId: record.worktreeId,
        commit: firstCommit,
        selection: { kind: 'summary' },
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('serves a true baseline-to-live summary with staged, unstaged, untracked, deleted, and renamed files', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.workspaceRoot, 'rename-source.txt'), 'rename me\n');
    await writeFile(path.join(fixture.workspaceRoot, 'delete-me.txt'), 'delete me\n');
    await runGit(fixture.workspaceRoot, ['add', 'rename-source.txt', 'delete-me.txt']);
    await runGit(fixture.workspaceRoot, ['commit', '-m', 'add working summary baseline files']);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/live-summary',
    });
    const clean = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
    });
    assert.deepEqual(clean.selection, { kind: 'summary', includeWorkingTree: true });
    assert.deepEqual(clean.files, []);

    const targetPath = record.absolutePath;
    await runGit(targetPath, ['mv', 'rename-source.txt', 'rename-target.txt']);
    await runGit(targetPath, ['rm', 'delete-me.txt']);
    await writeFile(path.join(targetPath, 'README.md'), '# baseline\nunstaged\n');
    await writeFile(path.join(targetPath, 'staged.txt'), 'staged\n');
    await runGit(targetPath, ['add', 'staged.txt']);
    await writeFile(path.join(targetPath, 'untracked.txt'), 'untracked\n');

    const committedOnly = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary' },
    });
    assert.deepEqual(committedOnly.files, []);
    const explicitCommittedOnly = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: false },
    });
    assert.deepEqual(explicitCommittedOnly.selection, { kind: 'summary', includeWorkingTree: false });
    assert.deepEqual(explicitCommittedOnly.files, []);

    const live = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
    });
    assert.deepEqual(
      live.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'delete-me.txt', status: 'deleted', additions: 0, deletions: 1 },
        { path: 'README.md', status: 'modified', additions: 1, deletions: 0 },
        { path: 'rename-target.txt', oldPath: 'rename-source.txt', status: 'renamed', additions: 0, deletions: 0 },
        { path: 'staged.txt', status: 'added', additions: 1, deletions: 0 },
        { path: 'untracked.txt', status: 'added', additions: 1, deletions: 0 },
      ],
    );

    const unstagedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
      path: 'README.md',
    });
    assert.equal(unstagedDiff.commit, 'summary');
    assert.equal(unstagedDiff.selection.includeWorkingTree, true);
    assert.match(unstagedDiff.patch, /\+unstaged/u);

    const renamedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
      path: 'rename-target.txt',
    });
    assert.equal(renamedDiff.binary, false);
    assert.match(renamedDiff.patch, /rename from|rename to|rename me/u);

    const deletedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
      path: 'delete-me.txt',
    });
    assert.match(deletedDiff.patch, /-delete me/u);

    const stagedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
      path: 'staged.txt',
    });
    assert.match(stagedDiff.patch, /\+staged/u);

    const untrackedDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
      path: 'untracked.txt',
    });
    assert.match(untrackedDiff.patch, /\+untracked/u);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('normalizes staged deletion with an untracked restoration in live summaries', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.workspaceRoot, 'mixed.txt'), 'original\n');
    await writeFile(path.join(fixture.workspaceRoot, 'copy-source.txt'), 'copy me\n');
    await runGit(fixture.workspaceRoot, ['add', 'mixed.txt', 'copy-source.txt']);
    await runGit(fixture.workspaceRoot, ['commit', '-m', 'add mixed-state file']);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/mixed-state',
    });
    await runGit(record.absolutePath, ['rm', '--cached', 'mixed.txt']);
    await runGit(record.absolutePath, ['mv', 'copy-source.txt', 'copy-target.txt']);
    await writeFile(path.join(record.absolutePath, 'copy-source.txt'), 'copy me\n');
    const unchanged = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
    });
    assert.deepEqual(unchanged.files, [{ path: 'copy-target.txt', oldPath: 'copy-source.txt', status: 'copied', additions: 0, deletions: 0 }]);

    await writeFile(path.join(record.absolutePath, 'mixed.txt'), 'modified\n');
    const modified = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
    });
    assert.deepEqual(
      modified.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'mixed.txt', status: 'modified', additions: 1, deletions: 1 },
        { path: 'copy-target.txt', oldPath: 'copy-source.txt', status: 'copied', additions: 0, deletions: 0 },
      ].toSorted((left, right) => left.path.localeCompare(right.path)),
    );
    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
      path: 'mixed.txt',
    });
    assert.match(diff.patch, /\+modified/u);

    await writeFile(path.join(record.absolutePath, 'copy-source.txt'), 'replacement one\nreplacement two\n');
    const changedRestoration = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      selection: { kind: 'summary', includeWorkingTree: true },
    });
    assert.deepEqual(
      changedRestoration.files.toSorted((left, right) => left.path.localeCompare(right.path)),
      [
        { path: 'copy-source.txt', status: 'modified', additions: 2, deletions: 1 },
        { path: 'copy-target.txt', status: 'added', additions: 1, deletions: 0 },
        { path: 'mixed.txt', status: 'modified', additions: 1, deletions: 1 },
      ],
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('reads binary commit files without returning patch bytes', async () => {
  const fixture = await createFixture();
  try {
    const adapter = new LocalGitAdapter();
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/binary',
    });
    await writeFile(path.join(record.absolutePath, 'asset.bin'), Buffer.from([0, 1, 2, 3]));
    await runGit(record.absolutePath, ['add', 'asset.bin']);
    await runGit(record.absolutePath, ['commit', '-m', 'add binary asset']);
    const commit = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();
    const diff = await adapter.readCommitFileDiff(record.absolutePath, commit, 'asset.bin');
    assert.equal(diff.binary, true);
    assert.equal(diff.patch, '');
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('authorizes working-tree reads from the changed-path projection, not per-file statistics', async () => {
  const calls = [];
  const fixture = await createFixture({ git: recordGitCalls(new LocalGitAdapter(), calls) });
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/paths-only',
    });
    await writeFile(path.join(record.absolutePath, 'untracked.txt'), 'untracked\n');

    calls.length = 0;
    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
    });
    assert.equal(history.commits[0].sha, WORKTREE_GIT_WORKING_TREE);
    assert.ok(calls.includes('listWorkingTreeChangedPaths'));
    assert.equal(
      calls.includes('listWorkingTreeFiles'),
      false,
      'a history read must not compute per-file working-tree statistics',
    );

    calls.length = 0;
    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      commit: WORKTREE_GIT_WORKING_TREE,
      path: 'untracked.txt',
    });
    assert.match(diff.patch, /\+untracked/u);
    assert.ok(calls.includes('listWorkingTreeChangedPaths'));
    assert.equal(
      calls.includes('listWorkingTreeFiles'),
      false,
      'authorizing one working-tree path must not compute every untracked file statistic',
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('bounds untracked line statistics and reports the remainder as unknown', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/stat-bound',
    });
    for (let index = 0; index < 55; index += 1) {
      await writeFile(
        path.join(record.absolutePath, `untracked-${String(index).padStart(2, '0')}.txt`),
        `content ${index}\n`,
      );
    }
    const listing = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      commit: WORKTREE_GIT_WORKING_TREE,
    });
    assert.equal(listing.files.length, 55);
    assert.equal(listing.files.filter((file) => file.additions !== undefined).length, 50);
    assert.ok(listing.files.some((file) => file.additions === undefined && file.deletions === undefined));
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('rejects aggregate selections that repeat or fall outside the pinned projection', async () => {
  const fixture = await createFixture();
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard',
      branch: 'main',
      newBranch: 'feature/aggregate-guard',
    });
    await writeFile(path.join(record.absolutePath, 'one.txt'), 'one\n');
    await runGit(record.absolutePath, ['add', 'one.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'one']);
    await writeFile(path.join(record.absolutePath, 'two.txt'), 'two\n');
    await runGit(record.absolutePath, ['add', 'two.txt']);
    await runGit(record.absolutePath, ['commit', '-m', 'two']);
    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
    });
    const [two, one] = history.commits;
    const selectionInput = (commits) => ({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'main',
      selection: { kind: 'commits', commits },
    });

    const union = await fixture.manager.listWorktreeCommitFiles(selectionInput([two.sha, one.sha]));
    assert.deepEqual(
      union.files.map((file) => file.path).toSorted(),
      ['one.txt', 'two.txt'],
    );
    assert.deepEqual(union.files.find((file) => file.path === 'one.txt').commits, [one.sha]);

    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles(selectionInput([one.sha, one.sha])),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles(selectionInput([record.baseCommit])),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('issues no Git read for a Main Dashboard target', async () => {
  const calls = [];
  const manager = {
    listBranches() {
      calls.push('branches');
      return Promise.resolve([]);
    },
    listWorktreeCommits() {
      calls.push('history');
      return Promise.resolve({ commits: [], truncated: false });
    },
    listWorktreeCommitFiles() {
      calls.push('files');
      return Promise.resolve({ commit: 'summary', files: [] });
    },
    getWorktreeCommitFileDiff() {
      calls.push('diff');
      return Promise.resolve({ commit: 'summary', path: '', patch: '', binary: false });
    },
  };
  const controller = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'main:ws_dashboard',
    defaultBaselineBranch: 'main',
  });
  await controller.loadBranches();
  await controller.loadHistory();
  await controller.refresh();
  assert.deepEqual(calls, []);
  assert.equal(controller.getSnapshot().branches.status, 'idle');
  assert.equal(controller.getSnapshot().history.status, 'idle');
  controller.dispose();
});


