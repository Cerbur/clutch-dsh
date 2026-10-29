import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers';
import { promisify } from 'node:util';
import test from 'node:test';

import { createWorktreeGitStateController } from '../lib/client/dashboard/git/useWorktreeGitState.js';
import { createBaselineSync } from '../lib/host/baseline-sync.js';
import {
  LocalGitAdapter,
  WORKTREE_GIT_WORKING_TREE,
  WorkspaceShardedSidecarRepository,
  createWorktreeManager,
} from '../lib/index.js';

const execFile = promisify(execFileCallback);

test('commit and aggregate file reads fail closed when HEAD moves after authorization or during reads', async () => {
  const adapter = new LocalGitAdapter();
  const fixture = await createFixture({ git: adapter });
  try {
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'feature/head-race',
    });
    const base = record.baseCommit;
    const commits = [];
    for (const name of ['first', 'second']) {
      await writeFile(path.join(record.absolutePath, 'race.txt'), name + '\n');
      await runGit(record.absolutePath, ['add', 'race.txt']);
      await runGit(record.absolutePath, ['commit', '-m', name]);
      commits.push((await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim());
    }
    const head = commits[1];
    await runGit(fixture.repositoryRoot, ['merge', '--ff-only', record.branch]);
    const originalContains = adapter.containsCommits.bind(adapter);
    const originalFiles = adapter.listCommitFiles.bind(adapter);
    for (const worktreeId of ['main:ws_dashboard', record.worktreeId]) {
      const root = worktreeId === record.worktreeId ? record.absolutePath : fixture.repositoryRoot;
      for (const baseBranch of [undefined, 'main']) {
        if (worktreeId === record.worktreeId && baseBranch === 'main') continue;
        // Keep a stable comparison branch after both checkouts have advanced.
        await runGit(root, ['update-ref', 'refs/heads/comparison-base', base]);
        const identity = { workspaceId: 'ws_dashboard', worktreeId,
          ...(baseBranch === undefined ? {} : { baseBranch: 'comparison-base' }) };
        for (const aggregate of [false, true]) {
          for (const diff of [false, true]) {
            for (const phase of ['authorization', 'files']) {
              await runGit(root, ['update-ref', 'HEAD', head]);
              let moved = false;
              const move = async () => {
                if (moved) return;
                moved = true;
                await runGit(root, ['update-ref', 'HEAD', base]);
              };
              adapter.containsCommits = async (cwd, candidates, fixedHead, ...rest) => {
                assert.equal(fixedHead, head);
                const allowed = await originalContains(cwd, candidates, fixedHead, ...rest);
                if (phase === 'authorization') await move();
                return allowed;
              };
              adapter.listCommitFiles = async (...args) => {
                const read = await originalFiles(...args);
                if (phase === 'files') await move();
                return read;
              };
              const request = { ...identity, ...(aggregate
                ? { selection: { kind: 'commits', commits } } : { commit: head }) };
              await assert.rejects(diff
                ? fixture.manager.getWorktreeCommitFileDiff({ ...request, path: 'race.txt' })
                : fixture.manager.listWorktreeCommitFiles(request), { code: 'WORKTREE_STATE_CONFLICT' });
              assert.equal(moved, true);
            }
          }
        }
        await runGit(root, ['update-ref', 'HEAD', head]);
      }
    }
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('Local and Worktree comparisons page past 200 commits with full totals and authorized diffs', async () => {
  const adapter = new LocalGitAdapter();
  const fixture = await createFixture({ git: adapter });
  try {
    const root = fixture.repositoryRoot;
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'feature/pages',
    });
    const ids = { workspaceId: 'ws_dashboard', worktreeId: record.worktreeId, baseBranch: 'main' };
    await writeFile(path.join(record.absolutePath, 'paged.txt'), 'oldest change\n');
    await runGit(record.absolutePath, ['add', 'paged.txt']);
    for (let i = 0; i < 211; i++) {
      await runGit(record.absolutePath, ['commit', '--allow-empty', '-m', 'page ' + i]);
    }
    const head = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();
    const first = await fixture.manager.listWorktreeCommits(ids);
    assert.equal(first.commits.length, 50);
    assert.equal(first.nextOffset, 50);
    assert.equal(first.ahead, 211);
    const commits = [...first.commits];
    let page = first;
    while (page.nextOffset !== undefined) {
      page = await fixture.manager.listWorktreeCommits({
        ...ids, offset: page.nextOffset, expectedHeadCommit: head, expectedBaselineCommit: base,
      });
      commits.push(...page.commits);
    }
    assert.equal(commits.length, 211);
    assert.equal(new Set(commits.map((commit) => commit.sha)).size, 211);
    assert.equal(page.truncated, false);
    const oldest = commits.at(-1).sha;
    assert.equal((await fixture.manager.listWorktreeCommitFiles({ ...ids, commit: oldest })).files[0].path, 'paged.txt');
    assert.match((await fixture.manager.getWorktreeCommitFileDiff({
      ...ids, commit: oldest, path: 'paged.txt',
    })).patch, /[+]oldest change/u);
    await assert.rejects(fixture.manager.listWorktreeCommitFiles({ ...ids, commit: base }), {
      code: 'WORKTREE_STATE_CONFLICT',
    });
    await runGit(root, ['branch', 'comparison/base', base]);
    await runGit(root, ['merge', '--ff-only', 'feature/pages']);
    const local = { workspaceId: 'ws_dashboard', worktreeId: 'main:ws_dashboard' };
    const history = await fixture.manager.listWorktreeCommits(local);
    assert.equal(history.commits.length, 50);
    assert.equal(history.baseline, undefined);
    assert.equal(history.ahead, undefined);
    const comparison = { ...local, baseBranch: 'comparison/base' };
    const localDiff = await fixture.manager.listWorktreeCommits(comparison);
    assert.equal(localDiff.ahead, 211);
    assert.equal(localDiff.baseline.commit, base);
    const tail = await fixture.manager.listWorktreeCommits({
      ...comparison, offset: 200, expectedHeadCommit: head, expectedBaselineCommit: base,
    });
    assert.equal(tail.commits.length, 11);
    assert.equal((await fixture.manager.listWorktreeCommitFiles({
      ...comparison, selection: { kind: 'summary' },
    })).files[0].path, 'paged.txt');
    assert.match((await fixture.manager.getWorktreeCommitFileDiff({
      ...comparison, selection: { kind: 'summary' }, path: 'paged.txt',
    })).patch, /[+]oldest change/u);
    assert.equal((await fixture.manager.listWorktreeCommitFiles({
      ...local, commit: oldest,
    })).files[0].path, 'paged.txt');
    const originalRun = adapter.run.bind(adapter);
    const originalFiles = adapter.listCommitFiles.bind(adapter);
    const commands = [];
    adapter.run = async (args, ...rest) => {
      commands.push(args);
      return originalRun(args, ...rest);
    };
    // Isolate authorization cost from the separate file projections for each commit.
    adapter.listCommitFiles = async () => ({ files: [], truncated: false });
    for (const identity of [ids, local, comparison]) {
      // Main now contains the feature commits, so use the stable acquisition base for comparison.
      commands.length = 0;
      await fixture.manager.listWorktreeCommitFiles({
        ...identity, ...(identity === ids ? { baseBranch: 'comparison/base' } : {}),
        selection: { kind: 'commits', commits: commits.slice(0, 200).map((commit) => commit.sha) },
      });
      assert.equal(commands.filter((args) => args[0] === 'rev-list').length, 1);
      assert.equal(commands.filter((args) => args[0] === 'merge-base' && args.includes('--is-ancestor')).length, 0);
      assert.equal(commands.filter((args) => args[0] === 'rev-parse' && args.includes('HEAD^{commit}')).length,
        identity === ids ? 1 : 2);
    }
    adapter.run = originalRun;
    adapter.listCommitFiles = originalFiles;
    await assert.rejects(fixture.manager.listWorktreeCommits({
      ...comparison, offset: 50, expectedHeadCommit: base, expectedBaselineCommit: base,
    }), { code: 'WORKTREE_STATE_CONFLICT' });
    await assert.rejects(fixture.manager.listWorktreeCommits({
      ...comparison, offset: -1,
    }), { code: 'WORKTREE_STATE_CONFLICT' });
    await assert.rejects(fixture.manager.listWorktreeCommits({
      ...comparison, baseBranch: 'HEAD~1',
    }), { code: 'WORKTREE_STATE_CONFLICT' });
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

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
  const repositoryRoot = path.join(tempRoot, 'workspace');
  const workspaceRoot = options.workspaceSubdirectory === undefined
    ? repositoryRoot
    : path.join(repositoryRoot, options.workspaceSubdirectory);
  await mkdir(dshHome, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await runGit(repositoryRoot, ['init']);
  await runGit(repositoryRoot, ['config', 'user.email', 'test@example.invalid']);
  await runGit(repositoryRoot, ['config', 'user.name', 'Dashboard Test']);
  await runGit(repositoryRoot, ['branch', '-M', 'main']);
  await writeFile(path.join(repositoryRoot, 'README.md'), '# baseline\n');
  await runGit(repositoryRoot, ['add', 'README.md']);
  await runGit(repositoryRoot, ['commit', '-m', 'baseline']);

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
  return { tempRoot, dshHome, workspaceRoot, repositoryRoot, sidecar, manager };
}

test('saved remote identity survives colliding local refs appearing and disappearing', async () => {
  const fixture = await createFixture();
  try {
    const root = fixture.repositoryRoot;
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', base]);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'feature/identity',
    });
    const identity = { workspaceId: 'ws_dashboard', worktreeId: record.worktreeId };
    const saved = await fixture.manager.updateWorktreeBaseBranch({
      ...identity, baseBranch: 'origin/main', expectedBaseBranch: 'main',
    });
    assert.equal(saved, 'refs/remotes/origin/main');
    await writeFile(path.join(root, 'later.txt'), 'later\n');
    await runGit(root, ['add', '.']);
    await runGit(root, ['commit', '-m', 'different local tip']);
    const other = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['branch', 'origin/main', other]);
    await runGit(root, ['branch', 'remotes/origin/main', other]);
    const branches = await fixture.manager.listBranches({ workspaceId: 'ws_dashboard' });
    const identities = branches.map((branch) => branch.kind === 'remote' ? branch.ref : branch.name);
    assert.equal(new Set(identities).size, branches.length);
    assert.equal(branches.find((branch) => branch.kind === 'remote').name, 'origin/main');
    assert.equal((await fixture.manager.listWorktreeCommits({ ...identity, baseBranch: saved })).baseline.commit, base);
    for (const legacy of ['origin/main', 'remotes/origin/main']) {
      await assert.rejects(fixture.manager.listWorktreeCommits({ ...identity, baseBranch: legacy }), {
        code: 'WORKTREE_STATE_CONFLICT',
      });
      await assert.rejects(fixture.manager.updateWorktreeBaseBranch({
        ...identity, baseBranch: legacy, expectedBaseBranch: saved,
      }), { code: 'WORKTREE_STATE_CONFLICT' });
    }
    // Client sends the saved pre-ref value back for branch-selected reads.
    await fixture.sidecar.mutate('ws_dashboard', (snapshot) => ({ result: undefined,
      snapshot: { ...snapshot, worktrees: snapshot.worktrees.map((item) => ({ ...item, baseBranch: 'origin/main' })) },
    }));
    const legacyRecord = (await fixture.sidecar.read('ws_dashboard')).worktrees[0];
    await assert.rejects(fixture.manager.listWorktreeCommits({ ...identity, baseBranch: legacyRecord.baseBranch }), {
      code: 'WORKTREE_STATE_CONFLICT',
    });
    assert.equal(await fixture.manager.updateWorktreeBaseBranch({
      ...identity, baseBranch: saved, expectedBaseBranch: 'origin/main',
    }), saved);
    const localHistory = await fixture.manager.listWorktreeCommits({ ...identity, baseBranch: 'refs/heads/origin/main' });
    assert.equal(localHistory.baseline.commit, other);
    await runGit(root, ['branch', '-D', 'origin/main']);
    await runGit(root, ['branch', '-D', 'remotes/origin/main']);
    assert.equal((await fixture.manager.listWorktreeCommits({ ...identity, baseBranch: saved })).baseline.commit, base);
    await runGit(root, ['branch', 'origin/main', other]);
    await runGit(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
    assert.equal((await fixture.manager.listWorktreeCommits({ ...identity, baseBranch: saved })).unavailableReason, 'baseline-unknown');
    const stored = (await fixture.sidecar.read('ws_dashboard')).worktrees[0];
    assert.equal(stored.baseBranch, saved);
    assert.equal(stored.baseCommit, record.baseCommit);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('an exact local ref remains an attached checkout despite a same-named remote baseline', async () => {
  const fixture = await createFixture();
  try {
    await runGit(fixture.repositoryRoot, ['branch', 'origin/main']);
    await runGit(fixture.repositoryRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'refs/heads/origin/main',
    });
    assert.equal(record.branch, 'origin/main');
    assert.equal((await runGit(record.absolutePath, ['symbolic-ref', 'HEAD'])).stdout.trim(), 'refs/heads/origin/main');
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

for (const stage of ['before Git', 'after Git']) {
  test(`interrupted creation preserves the exact local acquisition ref beside its same-named remote (${stage})`, async () => {
    class InterruptedGit extends LocalGitAdapter {
      interrupted = false;
      async createWorktree(...args) {
        if (stage === 'after Git') await super.createWorktree(...args);
        this.interrupted = true;
        if (stage === 'before Git') throw new Error('interrupted before Git creation');
      }
      async listWorktrees(...args) {
        if (this.interrupted) throw new Error('interrupted before publication');
        return super.listWorktrees(...args);
      }
    }
    const git = new InterruptedGit();
    const fixture = await createFixture({ git });
    try {
      const root = fixture.repositoryRoot;
      const remoteCommit = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
      await runGit(root, ['update-ref', 'refs/remotes/origin/main', remoteCommit]);
      await runGit(root, ['commit', '--allow-empty', '-m', 'local acquisition']);
      const baseCommit = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
      await runGit(root, ['branch', 'origin/main', baseCommit]);
      await assert.rejects(fixture.manager.createWorktree({
        workspaceId: 'ws_dashboard', branch: 'refs/heads/origin/main',
      }), { code: 'WORKTREE_RECOVERY_REQUIRED' });
      const pending = (await fixture.sidecar.read('ws_dashboard')).pendingOperation;
      assert.equal(pending.baseBranch, 'refs/heads/origin/main');
      assert.equal(pending.baseRef, undefined, 'existing branch must not acquire the new-branch marker');
      assert.equal(pending.baseCommit, baseCommit);
      // The checkout can advance before recovery; the acquisition commit must not.
      if (stage === 'after Git') await runGit(pending.targetPath, ['commit', '--allow-empty', '-m', 'after interruption']);
      git.interrupted = false;
      await fixture.manager.recoverWorktrees({ workspaceId: 'ws_dashboard' });
      const snapshot = await fixture.sidecar.read('ws_dashboard');
      assert.equal(snapshot.pendingOperation, undefined);
      if (stage === 'before Git') {
        assert.deepEqual(snapshot.worktrees, []);
        assert.equal(snapshot.recoveryIssues, undefined, 'an existing local branch does not imply ambiguous new-branch creation');
        return;
      }
      assert.equal(snapshot.worktrees[0].baseBranch, 'refs/heads/origin/main');
      assert.equal(snapshot.worktrees[0].baseCommit, baseCommit);
      assert.notEqual(snapshot.worktrees[0].baseCommit, remoteCommit);
      assert.notEqual(snapshot.worktrees[0].baseCommit, (await runGit(pending.targetPath, ['rev-parse', 'HEAD'])).stdout.trim());
    } finally {
      await fixture.manager.close();
      await rm(fixture.tempRoot, { recursive: true, force: true });
    }
  });
}

test('creates a local branch with the same short name as its remote baseline before checking local conflicts', async () => {
  const fixture = await createFixture();
  try {
    const root = fixture.repositoryRoot;
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', base]);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'origin/main', newBranch: 'origin/main',
    });
    assert.equal(record.branch, 'origin/main');
    assert.equal(record.baseBranch, 'refs/remotes/origin/main');
    assert.equal(record.baseCommit, base);
    const before = await fixture.sidecar.read('ws_dashboard');
    await assert.rejects(fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'refs/remotes/origin/main', newBranch: 'origin/main',
    }), { code: 'WORKTREE_BRANCH_CONFLICT' });
    assert.deepEqual(await fixture.sidecar.read('ws_dashboard'), before);
    assert.equal((await runGit(record.absolutePath, ['symbolic-ref', 'HEAD'])).stdout.trim(), 'refs/heads/origin/main');
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('enumerates fetched remote branches, excludes symbolic HEAD and creates an attached local branch', async () => {
  const fixture = await createFixture({ workspaceSubdirectory: 'packages/app' });
  try {
    // The selected commit must contain the Workspace subdirectory.
    await writeFile(path.join(fixture.workspaceRoot, 'app.txt'), 'app\n');
    await runGit(fixture.repositoryRoot, ['add', '.']);
    await runGit(fixture.repositoryRoot, ['commit', '-m', 'app']);
    const base = (await runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(fixture.repositoryRoot, ['update-ref', 'refs/remotes/origin/main', base]);
    await runGit(fixture.repositoryRoot, ['update-ref', 'refs/remotes/upstream/feature/x', base]);
    await runGit(fixture.repositoryRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    await runGit(fixture.repositoryRoot, ['update-ref', 'refs/remotes/upstream/HEAD', base]);
    const branches = await fixture.manager.listBranches({ workspaceId: 'ws_dashboard' });
    assert.deepEqual(branches.filter((branch) => branch.kind === 'remote'), [
      { name: 'origin/main', ref: 'refs/remotes/origin/main', kind: 'remote', remote: 'origin', isCurrent: false, checkedOut: false },
      { name: 'upstream/feature/x', ref: 'refs/remotes/upstream/feature/x', kind: 'remote', remote: 'upstream', isCurrent: false, checkedOut: false },
    ]);
    assert.equal(branches.find((branch) => branch.name === 'main').isCurrent, true);
    for (const branch of ['origin/main', 'refs/remotes/origin/main', '-bad', 'main~1', 'origin/HEAD']) {
      await assert.rejects(fixture.manager.createWorktree({ workspaceId: 'ws_dashboard', branch }), {
        code: 'GIT_OPERATION_FAILED',
      });
    }
    assert.equal((await fixture.sidecar.read('ws_dashboard')).pendingOperation, undefined);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'origin/main', newBranch: 'feature/remote-base',
    });
    assert.equal(record.baseBranch, 'refs/remotes/origin/main');
    assert.equal(record.baseCommit, base);
    assert.equal(record.branch, 'feature/remote-base');
    assert.ok(record.absolutePath.endsWith(path.join('packages', 'app')));
    assert.equal((await runGit(record.absolutePath, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim(), record.branch);
    assert.equal((await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim(), base);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('local/remote name collisions remain separately selectable and only local names conflict on create', async () => {
  const fixture = await createFixture();
  try {
    const root = fixture.repositoryRoot;
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', base]);
    await runGit(root, ['branch', 'origin/main']);
    const branches = await fixture.manager.listBranches({ workspaceId: 'ws_dashboard' });
    assert.equal(branches.find((branch) => branch.name === 'origin/main').kind, 'local');
    assert.equal(branches.find((branch) => branch.ref === 'refs/remotes/origin/main').kind, 'remote');
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'remotes/origin/main', newBranch: 'feature/collision',
    });
    assert.equal(record.baseBranch, 'refs/remotes/origin/main');
    assert.equal(record.baseCommit, base);
    // A fetched remote named upstream/topic does not occupy the local branch name.
    await runGit(root, ['update-ref', 'refs/remotes/upstream/topic', base]);
    const namedLikeRemote = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'upstream/topic',
    });
    assert.equal(namedLikeRemote.branch, 'upstream/topic');
    await assert.rejects(fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'upstream/topic',
    }), { code: 'WORKTREE_BRANCH_CONFLICT' });
    const comparison = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard', worktreeId: record.worktreeId, baseBranch: 'remotes/origin/main',
    });
    assert.equal(comparison.baseline.commit, base);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('remote baselines save with CAS, resolve exact refs despite tags, and project divergence and diffs', async () => {
  const fixture = await createFixture();
  try {
    const root = fixture.repositoryRoot;
    const base = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', base]);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'feature/remote-diff',
    });
    await writeFile(path.join(record.absolutePath, 'feature.txt'), 'feature\n');
    await runGit(record.absolutePath, ['add', '.']);
    await runGit(record.absolutePath, ['commit', '-m', 'feature']);
    const featureHead = (await runGit(record.absolutePath, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(path.join(root, 'upstream.txt'), 'upstream\n');
    await runGit(root, ['add', '.']);
    await runGit(root, ['commit', '-m', 'upstream']);
    const remoteHead = (await runGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
    await runGit(root, ['update-ref', 'refs/remotes/origin/main', remoteHead]);
    await runGit(root, ['tag', 'origin/main', featureHead]);
    const identity = { workspaceId: 'ws_dashboard', worktreeId: record.worktreeId };
    assert.equal(await fixture.manager.updateWorktreeBaseBranch({
      ...identity, baseBranch: 'origin/main', expectedBaseBranch: 'main',
    }), 'refs/remotes/origin/main');
    await assert.rejects(fixture.manager.updateWorktreeBaseBranch({
      ...identity, baseBranch: 'main', expectedBaseBranch: 'main',
    }), { code: 'WORKTREE_STATE_CONFLICT' });
    for (const baseBranch of ['refs/tags/origin/main', 'origin/main~1', '-bad']) {
      await assert.rejects(fixture.manager.listWorktreeCommits({ ...identity, baseBranch }), {
        code: 'WORKTREE_STATE_CONFLICT',
      });
    }
    const history = await fixture.manager.listWorktreeCommits({ ...identity, baseBranch: 'origin/main' });
    assert.equal(history.ahead, 1);
    assert.equal(history.behind, 1);
    assert.equal(history.baseline.commit, remoteHead);
    assert.equal(history.commits[0].sha, featureHead);
    const selection = { kind: 'summary' };
    const files = await fixture.manager.listWorktreeCommitFiles({ ...identity, baseBranch: 'origin/main', selection });
    assert.deepEqual(files.files.map((file) => file.path), ['feature.txt']);
    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      ...identity, baseBranch: 'origin/main', selection, path: 'feature.txt',
    });
    assert.match(diff.patch, /\+feature/u);
    const before = await fixture.sidecar.read('ws_dashboard');
    assert.equal(before.worktrees[0].baseCommit, base);
    assert.equal(before.worktrees[0].baseBranch, 'refs/remotes/origin/main');
    // A temporary Git baseline never saves to the sidecar.
    await fixture.manager.listWorktreeCommits({ ...identity, baseBranch: 'main' });
    assert.deepEqual(await fixture.sidecar.read('ws_dashboard'), before);
    await runGit(root, ['update-ref', '-d', 'refs/remotes/origin/main']);
    const unavailable = await fixture.manager.listWorktreeCommits({ ...identity, baseBranch: 'origin/main' });
    assert.equal(unavailable.unavailableReason, 'baseline-unknown');
    assert.deepEqual(await fixture.sidecar.read('ws_dashboard'), before);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('a saved baseline change during final enumeration prevents native task creation and dispatch', async () => {
  const fixture = await createFixture();
  let resume;
  let paused;
  const gate = new Promise((resolve) => { resume = resolve; });
  const enumerating = new Promise((resolve) => { paused = resolve; });
  const calls = [];
  const sync = createBaselineSync({ manager: fixture.manager, changed: () => calls.push('changed'), sessions: {
    modelCatalog: async () => ({ default: { provider: 'test', model: 'default' } }),
    validateModel: async (value) => value,
    create: async () => { calls.push('create'); return { sessionId: 'stale' }; },
    configureModel: async () => { calls.push('model'); },
    rename: async () => { calls.push('rename'); },
    prompt: async () => { calls.push('prompt'); return { accepted: true }; },
  } });
  try {
    await runGit(fixture.workspaceRoot, ['branch', 'release']);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'feature/sync-race',
    });
    const identity = { workspaceId: 'ws_dashboard', worktreeId: record.worktreeId };
    const listBranches = fixture.manager.listBranches.bind(fixture.manager);
    let enumerations = 0;
    fixture.manager.listBranches = async (input) => {
      const branches = await listBranches(input);
      if (++enumerations === 2) {
        paused();
        await gate;
      }
      return branches;
    };
    const pending = sync.sync({ ...identity, baseBranch: 'main', strategy: 'merge', requestId: 'baseline-race' },
      new globalThis.AbortController().signal);
    await enumerating;
    assert.equal(await fixture.manager.updateWorktreeBaseBranch({ ...identity,
      baseBranch: 'release', expectedBaseBranch: 'main' }), 'release');
    resume();
    await assert.rejects(pending, { code: 'WORKTREE_STATE_CONFLICT' });
    assert.deepEqual(calls, [], 'must not create or dispatch a task using main');
    assert.equal((await fixture.sidecar.read(identity.workspaceId)).worktrees[0].baseBranch, 'release');
  } finally {
    resume();
    sync.dispose();
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('baseline saves serialize with task admission and recover after a rejected admission', async () => {
  const fixture = await createFixture();
  let resume;
  let paused;
  const gate = new Promise((resolve) => { resume = resolve; });
  const admitting = new Promise((resolve) => { paused = resolve; });
  try {
    await runGit(fixture.workspaceRoot, ['branch', 'release']);
    const record = await fixture.manager.createWorktree({
      workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'feature/save-race',
    });
    const identity = { workspaceId: 'ws_dashboard', worktreeId: record.worktreeId };
    const admission = fixture.manager.withWorktreeBaseline(identity, async () => {
      paused();
      await gate;
      throw new Error('admission failed');
    });
    const rejected = assert.rejects(admission, /admission failed/);
    await admitting;
    let saved = false;
    const save = fixture.manager.updateWorktreeBaseBranch({ ...identity,
      baseBranch: 'release', expectedBaseBranch: 'main' }).then(() => { saved = true; });
    await fixture.manager.withWorktreeBaseline({ ...identity, worktreeId: 'unrelated' }, async () => {});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saved, false);
    assert.equal((await fixture.sidecar.read(identity.workspaceId)).worktrees[0].baseBranch, 'main');
    resume();
    await rejected;
    await save;
    assert.equal((await fixture.sidecar.read(identity.workspaceId)).worktrees[0].baseBranch, 'release');
  } finally {
    resume();
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

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
        baseBranch: 'refs/tags/dashboard-baseline',
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );

    // A selected baseline branch that no longer exists is an honest unavailable
    // projection, not a generic Git failure.
    const vanishedBaseline = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: record.worktreeId,
      baseBranch: 'deleted-baseline',
    });
    assert.equal(vanishedBaseline.unavailableReason, 'baseline-unknown');
    assert.deepEqual(vanishedBaseline.commits, []);
    assert.equal(vanishedBaseline.truncated, false);
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

test('keeps ambiguous legacy Worktrees unavailable while Main reads direct HEAD history', async () => {
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
        worktrees: snapshot.worktrees.map((item) => {
          const { baseCommit, ...rest } = item;
          void baseCommit;
          return { ...rest, baseBranch: 'main' };
        }),
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

    const mainHistory = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main',
    });
    assert.equal(mainHistory.headCommit, mainHistory.commits[0].sha);
    assert.equal(mainHistory.commits[0].subject, 'baseline');
    assert.equal(mainHistory.truncated, false);

    const mainFiles = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main',
      commit: mainHistory.commits[0].sha,
    });
    assert.deepEqual(mainFiles.files.map((file) => file.path), ['README.md']);
    const mainDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main',
      commit: mainHistory.commits[0].sha,
      path: 'README.md',
    });
    assert.match(mainDiff.patch, /\+# baseline/u);
    await assert.rejects(
      fixture.manager.listWorktreeCommits({ workspaceId: 'ws_dashboard', worktreeId: 'main:other' }),
      { code: 'WORKTREE_NOT_FOUND' },
    );
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('reads Main working-tree changes against the Workspace-root HEAD', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.workspaceRoot, 'README.md'), '# Main changed\n');
    await writeFile(path.join(fixture.workspaceRoot, 'main-live.txt'), 'live\n');

    const history = await fixture.manager.listWorktreeCommits({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
    });
    assert.equal(history.commits[0].sha, WORKTREE_GIT_WORKING_TREE);
    assert.equal(history.commits[0].kind, 'working-tree');
    assert.equal(history.commits[1].subject, 'baseline');
    assert.equal(history.headCommit, history.commits[0].parents[0]);

    const files = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      commit: WORKTREE_GIT_WORKING_TREE,
    });
    assert.deepEqual(files.files.map((file) => file.path).toSorted(), ['README.md', 'main-live.txt']);

    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      commit: WORKTREE_GIT_WORKING_TREE,
      path: 'README.md',
    });
    assert.equal(diff.commit, WORKTREE_GIT_WORKING_TREE);
    assert.match(diff.patch, /-# baseline/u);
    assert.match(diff.patch, /\+# Main changed/u);

    await assert.rejects(
      fixture.manager.getWorktreeCommitFileDiff({
        workspaceId: 'ws_dashboard',
        worktreeId: 'main:ws_dashboard',
        commit: WORKTREE_GIT_WORKING_TREE,
        path: 'missing.txt',
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
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
  assert.equal(controller.getSnapshot().history.value.unavailableReason, 'baseline-unselected');
  controller.dispose();
});

test('reads the captured acquisition baseline without an explicit branch', async () => {
  const requests = [];
  const fileRequests = [];
  const manager = {
    listBranches: () => Promise.resolve([]),
    listWorktreeCommits(input) {
      requests.push(input.baseBranch);
      return Promise.resolve({
        headCommit: 'a'.repeat(40),
        baseline: { commit: 'b'.repeat(40), source: 'captured' },
        commits: [],
        truncated: false,
      });
    },
    listWorktreeCommitFiles(input) {
      fileRequests.push(input);
      return Promise.resolve({ commit: 'summary', selection: { kind: 'summary' }, files: [] });
    },
    getWorktreeCommitFileDiff() {
      return Promise.resolve({ commit: 'summary', path: 'file.txt', patch: '', binary: false });
    },
  };

  // Without a captured baseline the tab stays inert until a branch is selected.
  const inert = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
  });
  await inert.loadHistory();
  assert.deepEqual(requests, []);
  assert.equal(inert.getSnapshot().history.status, 'idle');
  inert.dispose();

  // With one, the Manager resolves it and the summary target loads.
  const controller = createWorktreeGitStateController({
    manager,
    workspaceId: 'ws_dashboard',
    worktreeId: 'wt_dashboard',
    capturedBaseline: true,
  });
  await controller.loadHistory();
  await flush();
  assert.deepEqual(requests, [undefined]);
  assert.equal(controller.getSnapshot().baselineBranch, undefined);
  assert.equal(controller.getSnapshot().history.status, 'ready');
  assert.equal(controller.getSnapshot().view, 'summary');
  assert.equal(fileRequests.length, 1);
  assert.equal(fileRequests[0].baseBranch, undefined);
  assert.deepEqual(fileRequests[0].selection, { kind: 'summary' });
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

test('the multi-select switch decides whether a commit click replaces or adds', async () => {
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
  // Replace-on-click is the default; the additive path is opt-in.
  assert.equal(controller.getSnapshot().commitMultiSelect, false);

  controller.selectCommit(second);
  await flush();
  assert.deepEqual(controller.getSnapshot().selectedCommits, [second]);
  assert.equal(calls[calls.length - 1].commit, second);

  controller.setCommitMultiSelect(true);
  assert.equal(controller.getSnapshot().commitMultiSelect, true);
  controller.toggleCommit(first);
  await flush();
  assert.deepEqual(controller.getSnapshot().selectedCommits, [second, first]);
  assert.equal(calls[calls.length - 1].selection.kind, 'commits');
  assert.deepEqual(calls[calls.length - 1].selection.commits, [second, first]);

  // Turning the switch off collapses the aggregate to the focused commit and
  // re-reads that single commit instead of leaving the union files in place.
  controller.setCommitMultiSelect(false);
  await flush();
  assert.equal(controller.getSnapshot().commitMultiSelect, false);
  assert.deepEqual(controller.getSnapshot().selectedCommits, [first]);
  assert.equal(calls[calls.length - 1].commit, first);
  assert.equal(calls[calls.length - 1].selection, undefined);
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

test('reads Main commit diffs when the Workspace root is nested inside the repository', async () => {
  const fixture = await createFixture({ workspaceSubdirectory: 'packages/clutch-dsh-worktree' });
  try {
    const changedPath = 'packages/clutch-dsh-title/README.md';
    const absoluteChangedPath = path.join(fixture.repositoryRoot, changedPath);
    await mkdir(path.dirname(absoluteChangedPath), { recursive: true });
    await writeFile(absoluteChangedPath, '# sibling package change\n');
    await runGit(fixture.repositoryRoot, ['add', '--', changedPath]);
    await runGit(fixture.repositoryRoot, ['commit', '-m', 'change sibling package']);
    const firstCommit = (await runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    const directDiff = await new LocalGitAdapter().readCommitFileDiff(
      fixture.repositoryRoot,
      firstCommit,
      changedPath,
    );
    assert.match(directDiff.patch, /\+# sibling package change/u);

    await writeFile(absoluteChangedPath, '# sibling package change\nsecond line\n');
    await runGit(fixture.repositoryRoot, ['add', '--', changedPath]);
    await runGit(fixture.repositoryRoot, ['commit', '-m', 'update sibling package']);
    const secondCommit = (await runGit(fixture.repositoryRoot, ['rev-parse', 'HEAD'])).stdout.trim();

    const files = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      commit: firstCommit,
    });
    const workspacePath = '../clutch-dsh-title/README.md';
    assert.deepEqual(files.files.map((file) => file.path), [workspacePath]);

    const diff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      commit: firstCommit,
      path: workspacePath,
    });
    assert.match(diff.patch, /\+# sibling package change/u);

    const aggregateFiles = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      selection: { kind: 'commits', commits: [firstCommit, secondCommit] },
    });
    assert.deepEqual(aggregateFiles.files.map((file) => file.path), [workspacePath]);

    const aggregateDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      selection: { kind: 'commits', commits: [firstCommit, secondCommit] },
      path: workspacePath,
    });
    assert.deepEqual(aggregateDiff.segments.map((segment) => segment.commit), [firstCommit, secondCommit]);
    assert.match(aggregateDiff.segments[0].patch, /\+# sibling package change/u);
    assert.match(aggregateDiff.segments[1].patch, /\+second line/u);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

for (const mode of ['main', 'managed', 'legacy']) {
  test(`Workspace-relative paths round-trip commit, rename, working tree and summary for ${mode}`, async () => {
    const fixture = await createFixture({ workspaceSubdirectory: 'packages/app' });
    try {
      await writeFile(path.join(fixture.workspaceRoot, 'old.txt'), 'unchanged rename content\n');
      await runGit(fixture.repositoryRoot, ['add', '.']);
      await runGit(fixture.repositoryRoot, ['commit', '-m', 'nested baseline']);
      const record = mode === 'main' ? undefined : await fixture.manager.createWorktree({
        workspaceId: 'ws_dashboard', branch: 'main', newBranch: 'nested-' + mode,
      });
      const checkout = record?.gitRootPath ?? fixture.repositoryRoot;
      const cwd = record?.absolutePath ?? fixture.workspaceRoot;
      if (mode === 'legacy') {
        const { gitRootPath: _root, ...legacy } = record;
        void _root;
        await fixture.sidecar.mutate('ws_dashboard', (snapshot) => ({
          result: undefined,
          snapshot: { ...snapshot, worktrees: [{ ...legacy, absolutePath: checkout }] },
        }));
      }
      const input = { workspaceId: 'ws_dashboard', worktreeId: record?.worktreeId ?? 'main:ws_dashboard' };
      await mkdir(path.join(checkout, 'packages/sibling'), { recursive: true });
      await runGit(checkout, ['mv', 'packages/app/old.txt', 'packages/sibling/renamed.txt']);
      await writeFile(path.join(cwd, 'inside.txt'), 'inside commit\n');
      await writeFile(path.join(checkout, 'README.md'), '# root commit\n');
      await runGit(checkout, ['add', '.']);
      await runGit(checkout, ['commit', '-m', 'nested and outside changes']);
      const commit = (await runGit(checkout, ['rev-parse', 'HEAD'])).stdout.trim();
      const files = await fixture.manager.listWorktreeCommitFiles({ ...input, commit });
      assert.deepEqual(files.files.map((file) => file.path).toSorted(),
        ['../../README.md', '../sibling/renamed.txt', 'inside.txt']);
      const renamed = files.files.find((file) => file.status === 'renamed');
      assert.equal(renamed.oldPath, 'old.txt');
      for (const file of files.files) {
        const diff = await fixture.manager.getWorktreeCommitFileDiff({ ...input, commit, path: file.path });
        assert.equal(diff.path, file.path);
        assert.ok(diff.patch.length > 0);
      }
      const oldNameDiff = await fixture.manager.getWorktreeCommitFileDiff({ ...input, commit, path: 'old.txt' });
      assert.equal(oldNameDiff.path, 'old.txt');
      assert.match(oldNameDiff.patch, /\+unchanged rename content/u);
      const selection = { kind: 'commits', commits: [commit] };
      const aggregate = await fixture.manager.listWorktreeCommitFiles({ ...input, selection });
      assert.deepEqual(aggregate.files, files.files.map((file) => ({ ...file, commits: [commit] })));
      const aggregateDiff = await fixture.manager.getWorktreeCommitFileDiff({ ...input, selection, path: '../sibling/renamed.txt' });
      assert.equal(aggregateDiff.path, '../sibling/renamed.txt');
      assert.match(aggregateDiff.segments[0].patch, /packages\/sibling\/renamed.txt/u);
      // Neither coordinate guessing nor traversal outside the checkout may reach a Git diff.
      for (const value of ['packages/app/inside.txt', '../../../secret', '/etc/passwd', './inside.txt', 'inside.txt/../inside.txt', 'inside.txt\0']) {
        await assert.rejects(fixture.manager.getWorktreeCommitFileDiff({ ...input, commit, path: value }),
          { code: 'WORKTREE_STATE_CONFLICT' });
      }
      await writeFile(path.join(cwd, 'inside.txt'), 'inside commit\ninside live\n');
      await writeFile(path.join(cwd, 'untracked.txt'), 'inside untracked\n');
      await writeFile(path.join(checkout, 'root-untracked.txt'), 'outside untracked\n');
      await writeFile(path.join(checkout, 'README.md'), '# root live\n');
      const live = await fixture.manager.listWorktreeCommitFiles({ ...input, commit: WORKTREE_GIT_WORKING_TREE });
      assert.deepEqual(live.files.map((file) => file.path).toSorted(),
        ['../../README.md', '../../root-untracked.txt', 'inside.txt', 'untracked.txt']);
      for (const file of live.files) {
        const diff = await fixture.manager.getWorktreeCommitFileDiff({ ...input, commit: WORKTREE_GIT_WORKING_TREE, path: file.path });
        assert.equal(diff.path, file.path);
        assert.ok(diff.patch.length > 0);
      }
      if (record) {
        const summary = { kind: 'summary', includeWorkingTree: true };
        const read = await fixture.manager.listWorktreeCommitFiles({ ...input, selection: summary });
        assert.ok(read.files.some((file) => file.path === 'inside.txt'));
        assert.ok(read.files.some((file) => file.path === '../../root-untracked.txt'));
        for (const file of read.files) {
          const diff = await fixture.manager.getWorktreeCommitFileDiff({ ...input, selection: summary, path: file.path });
          assert.equal(diff.path, file.path);
          assert.ok(diff.patch.length > 0);
        }
      }
    } finally {
      await fixture.manager.close();
      await rm(fixture.tempRoot, { recursive: true, force: true });
    }
  });
}

test('serves Main multi-commit selections with exact file unions and diff segments', async () => {
  const fixture = await createFixture();
  try {
    await writeFile(path.join(fixture.workspaceRoot, 'main-aggregate.txt'), 'first\n');
    await runGit(fixture.workspaceRoot, ['add', 'main-aggregate.txt']);
    await runGit(fixture.workspaceRoot, ['commit', '-m', 'add Main aggregate file']);
    const firstCommit = (await runGit(fixture.workspaceRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(path.join(fixture.workspaceRoot, 'main-aggregate.txt'), 'first\nsecond\n');
    await writeFile(path.join(fixture.workspaceRoot, 'main-other.txt'), 'other\n');
    await runGit(fixture.workspaceRoot, ['add', 'main-aggregate.txt', 'main-other.txt']);
    await runGit(fixture.workspaceRoot, ['commit', '-m', 'update Main aggregate files']);
    const secondCommit = (await runGit(fixture.workspaceRoot, ['rev-parse', 'HEAD'])).stdout.trim();
    await writeFile(path.join(fixture.workspaceRoot, 'main-live.txt'), 'live\n');

    const aggregate = await fixture.manager.listWorktreeCommitFiles({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      selection: { kind: 'commits', commits: [firstCommit, secondCommit] },
    });
    assert.equal(aggregate.commit, firstCommit);
    assert.deepEqual(aggregate.selection, { kind: 'commits', commits: [firstCommit, secondCommit] });
    assert.deepEqual(aggregate.files.find((file) => file.path === 'main-aggregate.txt').commits, [firstCommit, secondCommit]);

    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles({
        workspaceId: 'ws_dashboard',
        worktreeId: 'main:ws_dashboard',
        selection: { kind: 'commits', commits: [firstCommit, firstCommit] },
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles({
        workspaceId: 'ws_dashboard',
        worktreeId: 'main:ws_dashboard',
        selection: { kind: 'commits', commits: ['c'.repeat(40)] },
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    await assert.rejects(
      fixture.manager.listWorktreeCommitFiles({
        workspaceId: 'ws_dashboard',
        worktreeId: 'main:ws_dashboard',
        selection: { kind: 'summary' },
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );

    const aggregateDiff = await fixture.manager.getWorktreeCommitFileDiff({
      workspaceId: 'ws_dashboard',
      worktreeId: 'main:ws_dashboard',
      selection: { kind: 'commits', commits: [firstCommit, secondCommit] },
      path: 'main-aggregate.txt',
    });
    assert.deepEqual(aggregateDiff.selection, { kind: 'commits', commits: [firstCommit, secondCommit] });
    assert.deepEqual(aggregateDiff.segments.map((segment) => segment.commit), [firstCommit, secondCommit]);
    assert.match(aggregateDiff.segments[0].patch, /[+]first/u);
    assert.match(aggregateDiff.segments[1].patch, /[+]second/u);
  } finally {
    await fixture.manager.close();
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('loads Main history lazily without branch or baseline reads', async () => {
  const calls = [];
  const manager = {
    listBranches() {
      calls.push('branches');
      return Promise.resolve([]);
    },
    listWorktreeCommits() {
      calls.push('history');
      return Promise.resolve({
        headCommit: 'a'.repeat(40),
        commits: [
          { sha: WORKTREE_GIT_WORKING_TREE, kind: 'working-tree', parents: ['a'.repeat(40)] },
          { sha: 'a'.repeat(40), subject: 'main' },
          { sha: 'b'.repeat(40), subject: 'older' },
        ],
        truncated: false,
      });
    },
    listWorktreeCommitFiles() {
      calls.push('files');
      return Promise.resolve({ commit: WORKTREE_GIT_WORKING_TREE, files: [] });
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
  await controller.loadHistory();
  controller.selectSummary();
  controller.setIncludeWorkingTree(true);
  controller.setCommitMultiSelect(true);
  controller.toggleCommit('a'.repeat(40));
  controller.toggleCommit('b'.repeat(40));
  await controller.refresh();
  assert.deepEqual(calls, ['history', 'files', 'files', 'files', 'history']);
  assert.equal(controller.getSnapshot().selectedCommit, 'b'.repeat(40));
  assert.deepEqual(controller.getSnapshot().selectedCommits, ['a'.repeat(40), 'b'.repeat(40)]);
  assert.equal(controller.getSnapshot().commitMultiSelect, true);
  assert.equal(controller.getSnapshot().branches.status, 'idle');
  assert.equal(controller.getSnapshot().history.status, 'ready');
  controller.dispose();
});


