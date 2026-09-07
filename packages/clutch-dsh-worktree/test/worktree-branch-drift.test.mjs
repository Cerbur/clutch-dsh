import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createWorktreeManager, WorkspaceShardedSidecarRepository } from '../lib/index.js';

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function fixture(run, source = 'external') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worktree-drift-'));
  const repo = path.join(root, 'repo');
  const dshHome = path.join(root, 'home');
  await mkdir(repo);
  await mkdir(dshHome);
  git(repo, 'init', '-b', 'main');
  git(
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '--allow-empty',
    '-m',
    'fixture',
  );
  const workspaceId = 'ws_drift';
  const workspace = { workspaceId, projectId: 'p', rootPath: repo };
  const sessions = [];
  const dsh = {
    getWorkspace: async (id) => (id === workspaceId ? workspace : undefined),
    listWorkspaces: async () => [workspace],
    listSessions: async () => sessions,
    getSession: async (id) => sessions.find((s) => s.sessionId === id),
  };
  const sidecar = new WorkspaceShardedSidecarRepository({ dshHome });
  let manager = createWorktreeManager({ dshHome, dsh, sidecar });
  try {
    let record;
    if (source === 'plugin')
      record = await manager.createWorktree({
        workspaceId,
        branch: 'main',
        newBranch: 'feature/foo',
      });
    else {
      const target = path.join(root, 'external');
      git(repo, 'worktree', 'add', '-b', 'feature/foo', target);
      record = await manager.importWorktree({ workspaceId, absolutePath: target });
    }
    const input = { workspaceId, worktreeId: record.worktreeId };
    const row = async () =>
      (await manager.listWorktrees({ workspaceId })).find(
        (r) => r.worktreeId === record.worktreeId,
      );
    const tokenInput = async () => ({ ...input, mutationToken: (await row()).mutationToken });
    const shard = sidecar.getShardPath(workspaceId);
    const restart = async () => {
      await manager.close();
      manager = createWorktreeManager({ dshHome, dsh, sidecar });
      return manager;
    };
    await run({
      root,
      repo,
      record,
      manager,
      sidecar,
      workspace,
      sessions,
      input,
      row,
      tokenInput,
      shard,
      restart,
    });
  } finally {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  }
}

for (const source of ['external', 'plugin'])
  test(`${source}: checkout projects drift; adoption preserves bindings and permits cleanup`, async () => {
    await fixture(
      async ({ record, manager, sidecar, workspace, sessions, input, row, tokenInput, shard }) => {
        sessions.push({
          sessionId: 's1',
          workspaceId: input.workspaceId,
          projectId: 'p',
          cwd: record.absolutePath,
        });
        await manager.bindSession({ ...input, sessionId: 's1' });
        const nativeBefore = JSON.stringify({ workspace, sessions });
        const bindings = (await sidecar.read(input.workspaceId)).bindings;
        git(record.absolutePath, 'checkout', '-b', 'merge/foo');
        const bytes = await readFile(shard, 'utf8');
        assert.equal((await row()).health, 'branch-drift');
        assert.equal((await row()).currentBranch, 'merge/foo');
        assert.equal((await row()).branch, 'feature/foo');
        assert.equal(await readFile(shard, 'utf8'), bytes);
        assert.equal(
          await manager.resolveRuntimeCwd({ workspaceId: input.workspaceId, sessionId: 's1' }),
          record.absolutePath,
        );
        const revision = BigInt((await sidecar.read(input.workspaceId)).revision);
        await manager.adoptWorktreeBranch({ ...(await tokenInput()), expectedBranch: 'merge/foo' });
        assert.equal((await row()).branch, 'merge/foo');
        assert.equal((await row()).health, 'ready');
        assert.deepEqual((await sidecar.read(input.workspaceId)).bindings, bindings);
        assert.equal(BigInt((await sidecar.read(input.workspaceId)).revision), revision + 1n);
        assert.equal(JSON.stringify({ workspace, sessions }), nativeBefore);
        assert.equal(git(record.absolutePath, 'branch', '--show-current').trim(), 'merge/foo');
        const adoptedBytes = await readFile(shard, 'utf8');
        await manager.adoptWorktreeBranch({ ...(await tokenInput()), expectedBranch: 'merge/foo' });
        assert.equal(await readFile(shard, 'utf8'), adoptedBytes);
        await manager.removeWorktree(await tokenInput());
        await manager.cleanWorktree(await tokenInput());
        assert.equal((await row()).health, 'cleaned');
        const cleanedBytes = await readFile(shard, 'utf8');
        await assert.rejects(
          manager.adoptWorktreeBranch({ ...(await tokenInput()), expectedBranch: 'merge/foo' }),
          { code: 'WORKTREE_STATE_CONFLICT' },
        );
        assert.equal(await readFile(shard, 'utf8'), cleanedBytes);
      },
      source,
    );
  });

test('a proven drift releases the old branch without adopting or changing its record', async () =>
  fixture(async ({ repo, record, manager, input, row }) => {
    git(record.absolutePath, 'checkout', '-b', 'merge/foo');
    const created = await manager.createWorktree({
      workspaceId: input.workspaceId,
      branch: 'feature/foo',
    });
    assert.equal(created.branch, 'feature/foo');
    assert.equal((await row()).branch, 'feature/foo');
    await assert.rejects(
      manager.createWorktree({ workspaceId: input.workspaceId, branch: 'merge/foo' }),
      { code: 'WORKTREE_BRANCH_CONFLICT' },
    );
    assert.ok(git(repo, 'worktree', 'list').includes(created.absolutePath));
  }));

test('stale confirmation, detached HEAD and missing path never mutate the sidecar', async () =>
  fixture(async ({ record, manager, row, tokenInput, shard }) => {
    git(record.absolutePath, 'checkout', '-b', 'merge/foo');
    const confirmed = { ...(await tokenInput()), expectedBranch: 'merge/foo' };
    git(record.absolutePath, 'checkout', '-b', 'merge/bar');
    const bytes = await readFile(shard, 'utf8');
    await assert.rejects(manager.adoptWorktreeBranch(confirmed), {
      code: 'WORKTREE_STATE_CONFLICT',
    });
    await assert.rejects(
      manager.adoptWorktreeBranch({
        ...confirmed,
        expectedBranch: 'merge/bar',
        mutationToken: 'stale',
      }),
      { code: 'WORKTREE_STATE_CONFLICT' },
    );
    git(record.absolutePath, 'checkout', '--detach');
    assert.equal((await row()).currentBranch, null);
    assert.equal((await row()).health, 'branch-drift');
    await assert.rejects(manager.adoptWorktreeBranch(confirmed), {
      code: 'WORKTREE_STATE_CONFLICT',
    });
    assert.equal(await readFile(shard, 'utf8'), bytes);
    await rm(record.absolutePath, { recursive: true, force: true });
    await assert.rejects(manager.adoptWorktreeBranch(confirmed));
    assert.equal(await readFile(shard, 'utf8'), bytes);
  }));

test('adoption refuses a replaced repository and preserves pending transactions', async () =>
  fixture(async ({ record, manager, input, tokenInput, shard }) => {
    git(record.absolutePath, 'checkout', '-b', 'merge/foo');
    const confirmed = { ...(await tokenInput()), expectedBranch: 'merge/foo' };
    const original = await readFile(shard, 'utf8');
    const snapshot = JSON.parse(original);
    snapshot.pendingOperation = {
      id: 'op_pending',
      type: 'create-worktree',
      phase: 'executing',
      workspaceId: input.workspaceId,
      worktreeId: 'wt_pending',
      targetPath: path.join(path.dirname(shard), '..', 'worktree', 'wt_pending'),
      branch: 'pending',
      baseRef: 'main',
      repositoryFingerprint: snapshot.repositoryFingerprint,
      startedAt: new Date().toISOString(),
    };
    const pendingBytes = JSON.stringify(snapshot);
    await writeFile(shard, pendingBytes);
    await assert.rejects(manager.adoptWorktreeBranch(confirmed), {
      code: 'WORKTREE_RECOVERY_REQUIRED',
    });
    assert.equal(await readFile(shard, 'utf8'), pendingBytes);
    await writeFile(shard, original);
    await rm(path.join(record.absolutePath, '.git'));
    git(record.absolutePath, 'init', '-b', 'replacement');
    git(
      record.absolutePath,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'replacement',
    );
    await assert.rejects(manager.adoptWorktreeBranch(confirmed), {
      code: 'WORKTREE_IDENTITY_CHANGED',
    });
    assert.equal(await readFile(shard, 'utf8'), original);
  }));

test('archived drift can be adopted; clean before adoption leaves no pending marker', async () =>
  fixture(async ({ record, manager, row, tokenInput, shard }) => {
    git(record.absolutePath, 'checkout', '-b', 'merge/foo');
    await manager.removeWorktree(await tokenInput());
    const bytes = await readFile(shard, 'utf8');
    await assert.rejects(manager.cleanWorktree(await tokenInput()), {
      code: 'WORKTREE_IDENTITY_CHANGED',
    });
    assert.equal(await readFile(shard, 'utf8'), bytes);
    await manager.adoptWorktreeBranch({ ...(await tokenInput()), expectedBranch: 'merge/foo' });
    assert.equal((await row()).status, 'removed');
    await manager.cleanWorktree(await tokenInput());
  }));

test('restart clears legacy branch observations but adoption preserves identity blockers', async () =>
  fixture(async ({ record, manager, input, row, tokenInput, shard, restart }) => {
    git(record.absolutePath, 'checkout', '-b', 'merge/foo');
    await manager.close();
    const snapshot = JSON.parse(await readFile(shard, 'utf8'));
    snapshot.schemaVersion = 3;
    snapshot.recoveryIssues = [
      {
        code: 'WORKTREE_RECOVERY_REQUIRED',
        worktreeId: record.worktreeId,
        observedAt: new Date().toISOString(),
      },
    ];
    await writeFile(shard, JSON.stringify(snapshot));
    const restarted = await restart();
    assert.equal((await row()).health, 'branch-drift');
    const clean = JSON.parse(await readFile(shard, 'utf8'));
    assert.equal(clean.recoveryIssues, undefined);
    clean.recoveryIssues = [
      {
        code: 'WORKTREE_IDENTITY_CHANGED',
        worktreeId: record.worktreeId,
        observedAt: new Date().toISOString(),
      },
    ];
    await writeFile(shard, JSON.stringify(clean));
    const bytes = await readFile(shard, 'utf8');
    await assert.rejects(
      restarted.adoptWorktreeBranch({ ...(await tokenInput()), expectedBranch: 'merge/foo' }),
      { code: 'WORKTREE_RECOVERY_REQUIRED' },
    );
    assert.equal(await readFile(shard, 'utf8'), bytes);
    assert.equal(
      (await restarted.listWorktrees({ workspaceId: input.workspaceId }))[0].health,
      'recovery-needed',
    );
  }));
