import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { URL, fileURLToPath } from 'node:url';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  LocalGitAdapter,
  SIDECAR_SCHEMA_VERSION,
  CrossProcessMutationLock,
  WorktreeProviderError,
  WorktreeMutationTransaction,
  WorkspaceShardedSidecarRepository,
  createRepositoryFingerprint,
  createWorktreeMutationToken,
  createWorktreeManager,
} from '../lib/index.js';

const execFile = promisify(execFileCallback);

async function runGit(cwd, args) {
  return execFile('git', args, { cwd, encoding: 'utf8' });
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function waitForFile(filePath, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (!(await exists(filePath))) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await delay(10);
  }
}

function runSidecarChild({ dshHome, worktreeId, readyFile, delayMs = 0 }) {
  const modulePath = fileURLToPath(new URL('../lib/index.js', import.meta.url));
  const script = `
    import { writeFile } from 'node:fs/promises';
    import path from 'node:path';
    import { setTimeout as delay } from 'node:timers/promises';
    import { WorkspaceShardedSidecarRepository } from ${JSON.stringify(modulePath)};

    const [dshHome, worktreeId, readyFile, delayMs] = process.argv.slice(1);
    const sidecar = new WorkspaceShardedSidecarRepository({ dshHome });
    await sidecar.mutate('ws_one', async (snapshot) => {
      if (readyFile) await writeFile(readyFile, 'ready\\n');
      await delay(Number(delayMs));
      const record = {
        worktreeId,
        workspaceId: 'ws_one',
        absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId),
        branch: 'feature/' + worktreeId,
        source: 'plugin',
        status: 'active',
      };
      return { result: record, snapshot: { ...snapshot, worktrees: [...snapshot.worktrees, record] } };
    });
  `;
  return execFile(process.execPath, [
    '--input-type=module',
    '-e',
    script,
    dshHome,
    worktreeId,
    readyFile ?? '',
    String(delayMs),
  ], { encoding: 'utf8' });
}

async function createGitWorkspace({ initialCommit = true } = {}) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-worktree-manage-'));
  const dshHome = path.join(tempRoot, 'dsh-home');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  await mkdir(dshHome, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });

  await runGit(workspaceRoot, ['init']);
  await runGit(workspaceRoot, ['config', 'user.email', 'test@example.invalid']);
  await runGit(workspaceRoot, ['config', 'user.name', 'Test User']);
  await runGit(workspaceRoot, ['branch', '-M', 'main']);
  if (initialCommit) {
    await writeFile(path.join(workspaceRoot, 'README.md'), '# fixture\n');
    await runGit(workspaceRoot, ['add', 'README.md']);
    await runGit(workspaceRoot, ['commit', '-m', 'initial']);
  }

  return { tempRoot, dshHome, workspaceRoot };
}

function createDshReader({
  workspaceId = 'ws_one',
  projectId = 'project_one',
  rootPath,
  sessions = [],
  listWorkspaces = false,
}) {
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, { ...session }]));
  const workspace = { workspaceId, projectId, rootPath };

  const reader = {
    async getWorkspace(requestedWorkspaceId) {
      return requestedWorkspaceId === workspaceId ? { ...workspace } : undefined;
    },
    async getSession(sessionId) {
      const session = sessionMap.get(sessionId);
      return session ? { ...session } : undefined;
    },
    async listSessions() {
      return [...sessionMap.values()].map((session) => ({ ...session }));
    },
    addSession(session) {
      sessionMap.set(session.sessionId, { ...session });
    },
  };
  if (listWorkspaces) {
    reader.listWorkspaces = async () => [{ ...workspace }];
  }
  return reader;
}

async function withGitFixture(callback, options = {}) {
  const fixture = await createGitWorkspace(options);
  try {
    const dsh = createDshReader({ rootPath: fixture.workspaceRoot });
    const sidecar = new WorkspaceShardedSidecarRepository({ dshHome: fixture.dshHome });
    const provider = createWorktreeManager({
      dsh,
      dshHome: fixture.dshHome,
      sidecar,
      idFactory: options.idFactory,
    });
    await callback({ ...fixture, dsh, sidecar, provider });
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

function expectCode(promise, code) {
  return assert.rejects(promise, (error) => error?.code === code);
}

async function mutationTokenFor(provider, workspaceId, worktreeId) {
  const record = (await provider.listWorktrees({ workspaceId }))
    .find((candidate) => candidate.worktreeId === worktreeId);
  assert.equal(typeof record?.mutationToken, 'string');
  return record.mutationToken;
}

function makeRecord({ workspaceId = 'ws_one', worktreeId = 'wt_seed', absolutePath, branch = 'feature/seed' } = {}) {
  return {
    worktreeId,
    workspaceId,
    absolutePath,
    branch,
    source: 'plugin',
    status: 'active',
  };
}

async function addExternalWorktree(workspaceRoot, tempRoot, branch = 'feature/external') {
  const externalPath = path.join(tempRoot, branch.replaceAll('/', '-'));
  await runGit(workspaceRoot, ['branch', branch]);
  await runGit(workspaceRoot, ['worktree', 'add', externalPath, branch]);
  return externalPath;
}

function makeBinding({ workspaceId = 'ws_one', worktreeId = 'wt_seed', sessionId = 'session_seed' } = {}) {
  return { workspaceId, worktreeId, sessionId, status: 'active' };
}

function createPendingSubprocessRuntime() {
  const handles = [];
  return {
    handles,
    async resolveExecutable() {
      return '/execution-world/bin/git';
    },
    spawn(spec) {
      let resolveDone;
      const done = new Promise((resolve) => {
        resolveDone = resolve;
      });
      const finish = () => resolveDone?.({ exitCode: null, signal: 'SIGTERM' });
      const handle = {
        pid: 42,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
        },
        done,
        terminated: false,
        terminate() {
          this.terminated = true;
          finish();
        },
        async waitForExit() {
          await done;
          return true;
        },
      };
      spec.signal?.addEventListener('abort', finish, { once: true });
      handles.push(handle);
      return handle;
    },
  };
}

test('manager close aborts and waits for an in-flight default Git operation', async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-manager-lifecycle-'));
  const dshHome = path.join(tempRoot, 'dsh-home');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  await mkdir(dshHome, { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  const runtime = createPendingSubprocessRuntime();
  const manager = createWorktreeManager({
    dshHome,
    subprocess: runtime,
    dsh: createDshReader({ rootPath: workspaceRoot }),
  });

  try {
    const operation = manager.listBranches({ workspaceId: 'ws_one' });
    await delay(10);
    const close = manager.close();

    await assert.rejects(operation);
    await close;
    assert.equal(runtime.handles.length, 1);
    assert.equal(runtime.handles[0].terminated, true);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('initializes an empty Workspace-sharded sidecar without a global index', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const snapshot = await sidecar.read('ws_one');

    assert.deepEqual(snapshot, {
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      workspaceId: 'ws_one',
      revision: '0',
      worktrees: [],
      bindings: [],
    });
    assert.equal(await exists(path.join(dshHome, 'clutch-dsh-worktree', 'index.json')), false);
    assert.equal(
      await exists(path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json')),
      false,
    );
  });
});

test('reads v1 and v2 sidecars and upgrades the first mutation to v3 atomically', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    await mkdir(path.dirname(shardPath), { recursive: true });

    const legacyRecord = {
      worktreeId: 'wt_legacy_v1',
      workspaceId: 'ws_one',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_legacy_v1'),
      branch: 'feature/legacy-v1',
      status: 'active',
    };
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'ws_one',
      worktrees: [legacyRecord],
      bindings: [],
    })}\n`);

    const normalized = await sidecar.read('ws_one');
    assert.equal(normalized.schemaVersion, 3);
    assert.equal(normalized.revision, '0');
    assert.equal(normalized.worktrees[0].source, 'plugin');

    await sidecar.upsertWorktree({
      ...legacyRecord,
      worktreeId: 'wt_legacy_v2',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_legacy_v2'),
      source: 'plugin',
    });
    const persisted = JSON.parse(await readFile(shardPath, 'utf8'));
    assert.equal(persisted.schemaVersion, 3);
    assert.equal(typeof persisted.revision, 'string');
    assert.equal('pendingOperation' in persisted, false);

    const v2Record = {
      ...legacyRecord,
      worktreeId: 'wt_legacy_v2',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_legacy_v2'),
      source: 'plugin',
    };
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 2,
      workspaceId: 'ws_one',
      worktrees: [v2Record],
      bindings: [],
    })}\n`);

    const normalizedV2 = await sidecar.read('ws_one');
    assert.equal(normalizedV2.schemaVersion, 3);
    assert.equal(normalizedV2.revision, '0');
    assert.deepEqual(normalizedV2.worktrees, [v2Record]);

    await sidecar.upsertWorktree({
      ...v2Record,
      worktreeId: 'wt_legacy_v2_new',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_legacy_v2_new'),
    });
    const persistedV2 = JSON.parse(await readFile(shardPath, 'utf8'));
    assert.equal(persistedV2.schemaVersion, 3);
    assert.equal(typeof persistedV2.revision, 'string');
    assert.equal('pendingOperation' in persistedV2, false);
  });
});

test('normalizes transitional raw repository data without exposing it in the read snapshot', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, sidecar }) => {
    const identity = (await new LocalGitAdapter().resolveRepositoryIdentity(workspaceRoot)).identity;
    const shardPath = sidecar.getShardPath('ws_one');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 3,
      workspaceId: 'ws_one',
      revision: '0',
      repository: identity,
      worktrees: [],
      bindings: [],
    })}\n`);

    const normalized = await sidecar.read('ws_one');
    assert.equal(normalized.repository, undefined);
    assert.equal(normalized.repositoryFingerprint, createRepositoryFingerprint(identity));

    const beforeMutation = JSON.parse(await readFile(shardPath, 'utf8'));
    assert.deepEqual(beforeMutation.repository, identity);

    await sidecar.upsertWorktree(makeRecord({
      worktreeId: 'wt_transitional_repository',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_transitional_repository'),
    }));
    const persisted = JSON.parse(await readFile(shardPath, 'utf8'));
    assert.equal('repository' in persisted, false);
    assert.equal(persisted.repositoryFingerprint, createRepositoryFingerprint(identity));
  });
});

test('finalizes a pending create when recovery finds the exact Git Worktree', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, provider, sidecar }) => {
    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(workspaceRoot);
    const worktreeId = 'wt_recover_create';
    const targetPath = path.join(dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await git.createWorktree(workspaceRoot, targetPath, 'main', 'feature/recover-create');

    const shardPath = sidecar.getShardPath('ws_one');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 3,
      workspaceId: 'ws_one',
      revision: '0',
      repository: identity.identity,
      worktrees: [],
      bindings: [],
      pendingOperation: {
        id: 'op_recover_create',
        type: 'create-worktree',
        phase: 'executing',
        workspaceId: 'ws_one',
        worktreeId,
        targetPath,
        branch: 'feature/recover-create',
        baseRef: 'main',
        repository: identity.identity,
        startedAt: new Date().toISOString(),
      },
    })}\n`);

    await provider.recoverWorktrees({ workspaceId: 'ws_one' });
    const snapshot = await sidecar.read('ws_one');
    assert.equal(snapshot.pendingOperation, undefined);
    assert.deepEqual(snapshot.worktrees, [{
      worktreeId,
      workspaceId: 'ws_one',
      absolutePath: targetPath,
      branch: 'feature/recover-create',
      source: 'plugin',
      status: 'active',
    }]);
    const persisted = JSON.parse(await readFile(shardPath, 'utf8'));
    assert.equal('repository' in persisted, false);
    assert.match(persisted.repositoryFingerprint, /^v1-[a-f0-9]{64}$/);
  });
});

test('does not finalize a pending create through a replaced managed-path symlink', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, provider, sidecar }) => {
    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(workspaceRoot);
    const worktreeId = 'wt_recover_replaced_path';
    const targetPath = path.join(dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);
    const replacementPath = `${targetPath}-replacement`;
    await mkdir(path.dirname(targetPath), { recursive: true });
    await git.createWorktree(workspaceRoot, targetPath, 'main', 'feature/recover-replaced-path');
    await rename(targetPath, replacementPath);
    await symlink(replacementPath, targetPath, 'dir');

    const shardPath = sidecar.getShardPath('ws_one');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 3,
      workspaceId: 'ws_one',
      revision: '0',
      repositoryFingerprint: createRepositoryFingerprint(identity.identity),
      worktrees: [],
      bindings: [],
      pendingOperation: {
        id: 'op_recover_replaced_path',
        type: 'create-worktree',
        phase: 'executing',
        workspaceId: 'ws_one',
        worktreeId,
        targetPath,
        branch: 'feature/recover-replaced-path',
        baseRef: 'main',
        repository: identity.identity,
        startedAt: new Date().toISOString(),
      },
    })}\n`);
    await expectCode(provider.recoverWorktrees({ workspaceId: 'ws_one' }), 'WORKTREE_IDENTITY_CHANGED');
    const snapshot = await sidecar.read('ws_one');
    assert.equal(snapshot.worktrees.length, 0);
    assert.equal(snapshot.pendingOperation.phase, 'recovery-needed');
    assert.equal(await exists(replacementPath), true);
    assert.equal((await stat(targetPath)).isDirectory(), true);
  });
});

test('runs safe pending-operation recovery before serving a Workspace read', async () => {
  const fixture = await createGitWorkspace();
  try {
    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(fixture.workspaceRoot);
    const worktreeId = 'wt_startup_recovery';
    const targetPath = path.join(fixture.dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await git.createWorktree(fixture.workspaceRoot, targetPath, 'main', 'feature/startup-recovery');

    const sidecar = new WorkspaceShardedSidecarRepository({ dshHome: fixture.dshHome });
    const shardPath = sidecar.getShardPath('ws_one');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 3,
      workspaceId: 'ws_one',
      revision: '0',
      repository: identity.identity,
      worktrees: [],
      bindings: [],
      pendingOperation: {
        id: 'op_startup_recovery',
        type: 'create-worktree',
        phase: 'executing',
        workspaceId: 'ws_one',
        worktreeId,
        targetPath,
        branch: 'feature/startup-recovery',
        baseRef: 'main',
        repository: identity.identity,
        startedAt: new Date().toISOString(),
      },
    })}\n`);

    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: fixture.workspaceRoot, listWorkspaces: true }),
      dshHome: fixture.dshHome,
      sidecar,
    });
    const records = await provider.listWorktrees({ workspaceId: 'ws_one' });

    assert.equal(records[0].worktreeId, worktreeId);
    assert.equal(records[0].status, 'active');
    assert.equal((await sidecar.read('ws_one')).pendingOperation, undefined);
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('clears a pending create when recovery proves Git had no effect', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, provider, sidecar }) => {
    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(workspaceRoot);
    const worktreeId = 'wt_recover_no_effect';
    const targetPath = path.join(dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId);
    const shardPath = sidecar.getShardPath('ws_one');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 3,
      workspaceId: 'ws_one',
      revision: '0',
      repository: identity.identity,
      worktrees: [],
      bindings: [],
      pendingOperation: {
        id: 'op_recover_no_effect',
        type: 'create-worktree',
        phase: 'prepared',
        workspaceId: 'ws_one',
        worktreeId,
        targetPath,
        branch: 'feature/recover-no-effect',
        baseRef: 'main',
        repository: identity.identity,
        startedAt: new Date().toISOString(),
      },
    })}\n`);

    await provider.recoverWorktrees({ workspaceId: 'ws_one' });
    const snapshot = await sidecar.read('ws_one');
    assert.equal(snapshot.pendingOperation, undefined);
    assert.deepEqual(snapshot.worktrees, []);
    assert.equal((await git.listBranches(workspaceRoot)).includes('feature/recover-no-effect'), false);
  });
});

test('finalizes a pending remove and detaches bindings after Git already removed the Worktree', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/recover-remove']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/recover-remove' });
    dsh.addSession({
      sessionId: 'session_recover_remove',
      workspaceId: 'ws_one',
      projectId: 'project_one',
      cwd: record.absolutePath,
    });
    await provider.bindSession({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      sessionId: 'session_recover_remove',
    });

    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(workspaceRoot);
    await git.removeWorktree(workspaceRoot, record.absolutePath);
    const current = await sidecar.read('ws_one');
    const shardPath = sidecar.getShardPath('ws_one');
    await writeFile(shardPath, `${JSON.stringify({
      ...current,
      repository: identity.identity,
      pendingOperation: {
        id: 'op_recover_remove',
        type: 'remove-worktree',
        phase: 'executing',
        workspaceId: 'ws_one',
        worktreeId: record.worktreeId,
        targetPath: record.absolutePath,
        branch: record.branch,
        source: record.source,
        repository: identity.identity,
        startedAt: new Date().toISOString(),
      },
    })}\n`);

    await provider.recoverWorktrees({ workspaceId: 'ws_one' });
    const snapshot = await sidecar.read('ws_one');
    assert.equal(snapshot.pendingOperation, undefined);
    assert.equal(snapshot.worktrees[0].status, 'removed');
    assert.equal(snapshot.bindings[0].status, 'detached');
    assert.equal(await exists(path.join(dshHome, 'clutch-dsh-worktree', 'worktree', record.worktreeId)), false);
  });
});

test('blocks ordinary sidecar mutation while a pending operation needs recovery', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, sidecar }) => {
    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(workspaceRoot);
    const shardPath = sidecar.getShardPath('ws_one');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 3,
      workspaceId: 'ws_one',
      revision: '0',
      repository: identity.identity,
      worktrees: [],
      bindings: [],
      pendingOperation: {
        id: 'op_blocks_mutation',
        type: 'create-worktree',
        phase: 'recovery-needed',
        workspaceId: 'ws_one',
        worktreeId: 'wt_blocks_mutation',
        targetPath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_blocks_mutation'),
        branch: 'feature/blocks-mutation',
        repository: identity.identity,
        startedAt: new Date().toISOString(),
      },
    })}\n`);

    await expectCode(
      sidecar.mutate('ws_one', (snapshot) => ({ result: undefined, snapshot })),
      'WORKTREE_RECOVERY_REQUIRED',
    );
  });
});

test('serializes concurrent sidecar mutations and leaves an atomically replaced shard', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const worktreeRoot = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    const records = [
      makeRecord({ worktreeId: 'wt_one', absolutePath: path.join(worktreeRoot, 'wt_one') }),
      makeRecord({ worktreeId: 'wt_two', absolutePath: path.join(worktreeRoot, 'wt_two') }),
    ];

    await Promise.all(
      records.map((record) =>
        sidecar.mutate('ws_one', async (snapshot) => {
          await delay(5);
          return {
            result: record,
            snapshot: {
              ...snapshot,
              worktrees: [...snapshot.worktrees, record],
            },
          };
        }),
      ),
    );

    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    const snapshot = JSON.parse(await readFile(shardPath, 'utf8'));
    const workspaceFiles = await readdir(path.dirname(shardPath));

    assert.deepEqual(
      snapshot.worktrees.map((record) => record.worktreeId).sort(),
      ['wt_one', 'wt_two'],
    );
    assert.deepEqual(workspaceFiles, ['ws_one.json']);
  });
});

test('serializes sidecar mutations across independent Node processes without lost updates', async () => {
  await withGitFixture(async ({ dshHome, tempRoot, sidecar }) => {
    const readyFile = path.join(tempRoot, 'first-child-ready');
    const first = runSidecarChild({
      dshHome,
      worktreeId: 'wt_child_one',
      readyFile,
      delayMs: 250,
    });
    await waitForFile(readyFile);
    const second = runSidecarChild({
      dshHome,
      worktreeId: 'wt_child_two',
    });
    await Promise.all([first, second]);

    assert.deepEqual(
      (await sidecar.read('ws_one')).worktrees.map((record) => record.worktreeId).sort(),
      ['wt_child_one', 'wt_child_two'],
    );
  });
});

test('serializes concurrent Git creates and rejects a duplicate checked-out branch', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, dsh }) => {
    const first = createWorktreeManager({
      dsh,
      dshHome,
      sidecar: new WorkspaceShardedSidecarRepository({ dshHome }),
      idFactory: () => 'wt_concurrent_one',
    });
    const second = createWorktreeManager({
      dsh,
      dshHome,
      sidecar: new WorkspaceShardedSidecarRepository({ dshHome }),
      idFactory: () => 'wt_concurrent_two',
    });

    const results = await Promise.allSettled([
      first.createWorktree({ workspaceId: 'ws_one', branch: 'main', newBranch: 'feature/concurrent' }),
      second.createWorktree({ workspaceId: 'ws_one', branch: 'main', newBranch: 'feature/concurrent' }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.equal(rejected?.reason?.code, 'WORKTREE_BRANCH_CONFLICT');
    assert.deepEqual((await new WorkspaceShardedSidecarRepository({ dshHome }).read('ws_one')).worktrees.map(
      (record) => record.branch,
    ), ['feature/concurrent']);
    assert.equal((await runGit(workspaceRoot, ['worktree', 'list', '--porcelain'])).stdout
      .split('\n')
      .filter((line) => line === 'branch refs/heads/feature/concurrent').length, 1);
  });
});

test('reclaims an ownerless stale mutation lock after an interrupted acquisition', async () => {
  await withGitFixture(async ({ dshHome }) => {
    const lock = new CrossProcessMutationLock({
      lockRoot: path.join(dshHome, 'clutch-dsh-worktree', 'locks'),
      acquisitionTimeoutMs: 1_000,
      leaseMs: 25,
      heartbeatMs: 5,
    });
    const lockPath = lock.getLockPath('workspace:ownerless');
    await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
    await mkdir(lockPath, { recursive: false, mode: 0o700 });
    const stale = new Date(Date.now() - 1_000);
    await utimes(lockPath, stale, stale);

    await lock.run('workspace:ownerless', async (handle) => {
      handle.assertHeld();
    });
  });
});

test('rejects a shard whose filename and stored Workspace identity disagree', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(
      shardPath,
      `${JSON.stringify({
        schemaVersion: SIDECAR_SCHEMA_VERSION,
        workspaceId: 'ws_other',
        worktrees: [],
        bindings: [],
      })}\n`,
    );

    await expectCode(sidecar.read('ws_one'), 'SIDECAR_CORRUPT');
  });
});

test('rejects a sidecar Worktree path outside the generated DSH Home root', async () => {
  await withGitFixture(async ({ dshHome, provider }) => {
    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(
      shardPath,
      `${JSON.stringify({
        schemaVersion: SIDECAR_SCHEMA_VERSION,
        workspaceId: 'ws_one',
        worktrees: [makeRecord({ absolutePath: path.join(dshHome, '..', 'outside', 'wt_path') })],
        bindings: [],
      })}\n`,
    );

    await expectCode(provider.listWorktrees({ workspaceId: 'ws_one' }), 'SIDECAR_CORRUPT');
  });
});

test('repeated identical Worktree upsert is idempotent', async () => {
  await withGitFixture(async ({ sidecar, dshHome }) => {
    const record = makeRecord({
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_seed'),
    });

    assert.deepEqual(await sidecar.upsertWorktree(record), record);
    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    const firstWrite = await readFile(shardPath, 'utf8');
    assert.deepEqual(await sidecar.upsertWorktree(record), record);
    assert.equal(await readFile(shardPath, 'utf8'), firstWrite);
    assert.deepEqual((await sidecar.read('ws_one')).worktrees, [record]);
  });
});

test('reorders Worktrees with native insertBefore semantics and survives reload', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const root = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    const records = ['wt_one', 'wt_two', 'wt_three'].map((worktreeId) =>
      makeRecord({
        worktreeId,
        absolutePath: path.join(root, worktreeId),
      }),
    );
    for (const record of records) await sidecar.upsertWorktree(record);

    assert.deepEqual(
      await sidecar.insertWorktreeBefore('ws_one', 'wt_one', 'wt_three'),
      ['wt_two', 'wt_one', 'wt_three'],
    );
    assert.deepEqual(
      await sidecar.insertWorktreeBefore('ws_one', 'wt_one'),
      ['wt_two', 'wt_three', 'wt_one'],
    );

    const reloaded = new WorkspaceShardedSidecarRepository({ dshHome });
    assert.deepEqual(
      (await reloaded.read('ws_one')).worktrees.map((record) => record.worktreeId),
      ['wt_two', 'wt_three', 'wt_one'],
    );
  });
});

test('does not rewrite the sidecar for no-op or invalid Worktree moves', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const root = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    for (const worktreeId of ['wt_one', 'wt_two']) {
      await sidecar.upsertWorktree(makeRecord({
        worktreeId,
        absolutePath: path.join(root, worktreeId),
      }));
    }
    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    const before = await readFile(shardPath, 'utf8');

    await sidecar.insertWorktreeBefore('ws_one', 'wt_one', 'wt_two');
    assert.equal(await readFile(shardPath, 'utf8'), before);
    await assert.rejects(
      sidecar.insertWorktreeBefore('ws_one', 'wt_missing', 'wt_one'),
      (error) => error?.code === 'WORKTREE_ORDER_INVALID',
    );
    await assert.rejects(
      sidecar.insertWorktreeBefore('ws_one', 'wt_one', 'wt_missing'),
      (error) => error?.code === 'WORKTREE_ORDER_INVALID',
    );
    assert.equal(await readFile(shardPath, 'utf8'), before);
  });
});

test('rejects relative workspace roots before invoking Git', async () => {
  await withGitFixture(async ({ dshHome }) => {
    const dsh = createDshReader({ rootPath: 'relative/workspace' });
    const provider = createWorktreeManager({ dsh, dshHome, idFactory: () => 'wt_relative' });

    await expectCode(provider.createWorktree({ workspaceId: 'ws_one', branch: 'main' }), 'WORKSPACE_NOT_FOUND');
  });
});

test('rejects a non-Git Workspace', async () => {
  const fixture = await createGitWorkspace();
  const nonGitRoot = path.join(fixture.tempRoot, 'not-a-repository');
  await mkdir(nonGitRoot);
  try {
    const dsh = createDshReader({ rootPath: nonGitRoot });
    const provider = createWorktreeManager({ dsh, dshHome: fixture.dshHome });

    await expectCode(provider.createWorktree({ workspaceId: 'ws_one', branch: 'main' }), 'WORKSPACE_NOT_GIT_REPOSITORY');
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
});

test('reports a missing Git executable separately from a non-Git Workspace', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, tempRoot }) => {
    const git = new LocalGitAdapter({ executable: path.join(tempRoot, 'missing-git') });
    const provider = createWorktreeManager({ dsh, dshHome, git });

    await assert.rejects(
      provider.listBranches({ workspaceId: 'ws_one' }),
      (error) => {
        assert.equal(error?.code, 'GIT_NOT_INSTALLED');
        assert.equal(error?.details?.workspaceRoot, workspaceRoot);
        assert.equal(error?.details?.gitExitCode, 'ENOENT');
        assert.deepEqual(error?.details?.gitArgs, ['rev-parse', '--is-inside-work-tree']);
        assert.equal(error?.details?.gitStdout, '');
        assert.equal(error?.details?.gitStderr, '');
        return true;
      },
    );

    await assert.rejects(
      git.removeWorktree(workspaceRoot, path.join(tempRoot, 'missing-worktree')),
      (error) => error?.code === 'GIT_NOT_INSTALLED' && error?.details?.operation === 'remove worktree',
    );
  });
});

test('bounds Git subprocess lifetime and diagnostic output without invoking a shell', async () => {
  await withGitFixture(async ({ workspaceRoot }) => {
    const hangingGit = new LocalGitAdapter({
      executable: process.execPath,
      executableArgs: ['--input-type=module', '-e', 'setTimeout(() => {}, 250)'],
      timeoutMs: 40,
    });
    const startedAt = Date.now();
    await assert.rejects(hangingGit.listBranches(workspaceRoot), (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitTimedOut, true);
      return true;
    });
    assert.ok(Date.now() - startedAt < 2_000);

    const controller = new globalThis.AbortController();
    const abortableGit = new LocalGitAdapter({
      executable: process.execPath,
      executableArgs: ['--input-type=module', '-e', 'setTimeout(() => {}, 250)'],
      timeoutMs: 5_000,
    });
    const pending = abortableGit.listBranches(workspaceRoot, { signal: controller.signal });
    globalThis.setTimeout(() => controller.abort(), 20).unref?.();
    await assert.rejects(pending, (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitAborted, true);
      return true;
    });

    const noisyGit = new LocalGitAdapter({
      executable: process.execPath,
      executableArgs: ['--input-type=module', '-e', "process.stdout.write('x'.repeat(200_000))"],
      maxOutputBytes: 1_024,
    });
    await assert.rejects(noisyGit.listBranches(workspaceRoot), (error) => {
      assert.equal(error?.code, 'GIT_OPERATION_FAILED');
      assert.equal(error?.details?.gitOutputTruncated, true);
      return true;
    });
  });
});

test('rejects a Git repository without an initial commit', async () => {
  await withGitFixture(async ({ provider }) => {
    await expectCode(provider.createWorktree({ workspaceId: 'ws_one', branch: 'main' }), 'WORKTREE_REQUIRES_INITIAL_COMMIT');
  }, { initialCommit: false });
});

test('rejects invalid and already checked-out branches without using force', async () => {
  await withGitFixture(async ({ provider }) => {
    await expectCode(provider.createWorktree({ workspaceId: 'ws_one', branch: 'main' }), 'WORKTREE_BRANCH_CONFLICT');
    await expectCode(provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature name' }), 'GIT_OPERATION_FAILED');
  });
});

test('creates a new Worktree branch from an already checked-out base branch', async () => {
  await withGitFixture(async ({ provider, workspaceRoot }) => {
    const record = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'main',
      newBranch: 'worktree/main',
    });

    assert.equal(record.branch, 'worktree/main');
    assert.equal(await exists(record.absolutePath), true);
    assert.equal((await runGit(workspaceRoot, ['branch', '--show-current'])).stdout.trim(), 'main');

    const branches = await provider.listBranches({ workspaceId: 'ws_one' });
    assert.deepEqual(
      branches.map((branch) => ({ name: branch.name, checkedOut: branch.checkedOut })),
      [
        { name: 'main', checkedOut: true },
        { name: 'worktree/main', checkedOut: true },
      ],
    );
  });
});

test('marks the containing Git Worktree branch current for an imported subdirectory Workspace', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot }) => {
    const importedRoot = path.join(workspaceRoot, 'packages', 'nested');
    await mkdir(importedRoot, { recursive: true });
    const gitAdapter = new LocalGitAdapter();
    await gitAdapter.validateRepository(importedRoot);
    assert.equal(await gitAdapter.resolveRepositoryRoot(importedRoot), await realpath(workspaceRoot));

    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: importedRoot }),
      dshHome,
    });

    assert.deepEqual(await provider.listBranches({ workspaceId: 'ws_one' }), [
      { name: 'main', isCurrent: true, checkedOut: true },
    ]);
  });
});

test('filters the repository root when listing import candidates for a subdirectory Workspace', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, tempRoot }) => {
    const importedRoot = path.join(workspaceRoot, 'packages', 'nested');
    await mkdir(importedRoot, { recursive: true });
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot, 'feature/subdir-candidate');
    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: importedRoot }),
      dshHome,
    });

    assert.deepEqual(await provider.listImportCandidates({ workspaceId: 'ws_one' }), [{
      absolutePath: await realpath(externalPath),
      branch: 'feature/subdir-candidate',
    }]);
  });
});

test('reports canonical repository identity and detached Worktree facts', async () => {
  await withGitFixture(async ({ workspaceRoot, tempRoot }) => {
    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(workspaceRoot);

    assert.equal(identity.identity.topLevel, await realpath(workspaceRoot));
    assert.equal(identity.identity.commonDirectory, await realpath(path.join(workspaceRoot, '.git')));
    assert.match(identity.headCommit, /^[0-9a-f]{40}$/);

    const detachedPath = path.join(tempRoot, 'detached-facts');
    await runGit(workspaceRoot, ['worktree', 'add', '--detach', detachedPath, 'HEAD']);
    const worktrees = await git.listWorktrees(workspaceRoot);
    const canonicalWorkspaceRoot = await realpath(workspaceRoot);
    const canonicalDetachedPath = await realpath(detachedPath);
    const main = worktrees.find((worktree) => path.resolve(worktree.absolutePath) === canonicalWorkspaceRoot);
    const detached = worktrees.find((worktree) => path.resolve(worktree.absolutePath) === canonicalDetachedPath);

    assert.equal(main?.detached, false);
    assert.match(main?.headCommit, /^[0-9a-f]{40}$/);
    assert.equal(detached?.branch, undefined);
    assert.equal(detached?.detached, true);
    assert.equal(detached?.headCommit, identity.headCommit);
  });
});

test('resolves the Git root before reading branch facts for a subdirectory Workspace', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot }) => {
    const importedRoot = path.join(workspaceRoot, 'packages', 'nested');
    await mkdir(importedRoot, { recursive: true });
    const calls = [];
    const git = {
      async validateRepository(root) {
        calls.push(['validateRepository', root]);
      },
      async resolveRepositoryRoot(root) {
        calls.push(['resolveRepositoryRoot', root]);
        return workspaceRoot;
      },
      async listBranches(root) {
        calls.push(['listBranches', root]);
        assert.equal(root, workspaceRoot);
        return ['main'];
      },
      async listWorktrees(root) {
        calls.push(['listWorktrees', root]);
        assert.equal(root, workspaceRoot);
        return [{ absolutePath: workspaceRoot, branch: 'main' }];
      },
      async createWorktree() {},
      async removeWorktree() {},
    };
    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: importedRoot }),
      dshHome,
      git,
    });

    assert.deepEqual(await provider.listBranches({ workspaceId: 'ws_one' }), [
      { name: 'main', isCurrent: true, checkedOut: true },
    ]);
    assert.deepEqual(calls, [
      ['validateRepository', importedRoot],
      ['resolveRepositoryRoot', importedRoot],
      ['listBranches', workspaceRoot],
      ['listWorktrees', workspaceRoot],
    ]);
  });
});

test('uses combined branch checkout facts for a subdirectory Workspace when available', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot }) => {
    const importedRoot = path.join(workspaceRoot, 'packages', 'nested');
    await mkdir(importedRoot, { recursive: true });
    const calls = [];
    const git = {
      async validateRepository(root) {
        calls.push(['validateRepository', root]);
      },
      async resolveRepositoryRoot(root) {
        calls.push(['resolveRepositoryRoot', root]);
        return workspaceRoot;
      },
      async listBranchesWithWorktreePaths(root) {
        calls.push(['listBranchesWithWorktreePaths', root]);
        assert.equal(root, workspaceRoot);
        return [{ name: 'main', worktreePath: workspaceRoot }];
      },
      async listBranches() {
        throw new Error('legacy branch read should not be called');
      },
      async listWorktrees() {
        throw new Error('legacy worktree read should not be called');
      },
      async createWorktree() {},
      async removeWorktree() {},
    };
    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: importedRoot }),
      dshHome,
      git,
    });

    assert.deepEqual(await provider.listBranches({ workspaceId: 'ws_one' }), [
      { name: 'main', isCurrent: true, checkedOut: true },
    ]);
    assert.deepEqual(calls, [
      ['validateRepository', importedRoot],
      ['resolveRepositoryRoot', importedRoot],
      ['listBranchesWithWorktreePaths', workspaceRoot],
    ]);
  });
});

test('uses the resolved repository root when projecting Worktree health for a subdirectory Workspace', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, sidecar }) => {
    const importedRoot = path.join(workspaceRoot, 'packages', 'nested');
    await mkdir(importedRoot, { recursive: true });
    const record = makeRecord({
      worktreeId: 'wt_subdir_health',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_subdir_health'),
    });
    await sidecar.upsertWorktree(record);
    const calls = [];
    const git = {
      async resolveRepositoryRoot(root) {
        calls.push(['resolveRepositoryRoot', root]);
        return workspaceRoot;
      },
      async listWorktrees(root) {
        calls.push(['listWorktrees', root]);
        return root === workspaceRoot ? [{ absolutePath: record.absolutePath }] : [];
      },
    };
    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: importedRoot }),
      dshHome,
      sidecar,
      git,
    });

    const result = await provider.listWorktrees({ workspaceId: 'ws_one' });
    assert.deepEqual(calls, [
      ['resolveRepositoryRoot', importedRoot],
      ['listWorktrees', workspaceRoot],
    ]);
    assert.equal(result[0].health, 'ready');
  });
});

test('reuses the resolved repository root across transaction Git operations', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, tempRoot, sidecar }) => {
    const baseGit = new LocalGitAdapter();
    const calls = { resolveRepositoryRoot: 0 };
    const git = {
      validateRepository: (...args) => baseGit.validateRepository(...args),
      async resolveRepositoryRoot(...args) {
        calls.resolveRepositoryRoot += 1;
        return baseGit.resolveRepositoryRoot(...args);
      },
      resolveRepositoryIdentity: (...args) => baseGit.resolveRepositoryIdentity(...args),
      listBranches: (...args) => baseGit.listBranches(...args),
      listWorktrees: (...args) => baseGit.listWorktrees(...args),
      createWorktree: (...args) => baseGit.createWorktree(...args),
      removeWorktree: (...args) => baseGit.removeWorktree(...args),
    };
    const transaction = new WorktreeMutationTransaction({ dshHome, git, sidecar });
    const generatedRoot = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    const targetPath = path.join(generatedRoot, 'wt_transaction_root_create');
    await mkdir(generatedRoot, { recursive: true });

    const created = await transaction.create({
      workspaceId: 'ws_one',
      workspaceRoot,
      targetPath,
      worktreeId: 'wt_transaction_root_create',
      baseBranch: 'main',
      newBranch: 'feature/transaction-root-create',
      targetBranch: 'feature/transaction-root-create',
    });
    assert.equal(calls.resolveRepositoryRoot, 0);
    const createdSnapshot = await sidecar.read('ws_one');

    await transaction.remove({
      workspaceId: 'ws_one',
      workspaceRoot,
      worktreeId: created.worktreeId,
      mutationToken: createWorktreeMutationToken(createdSnapshot, created),
    });
    assert.equal(calls.resolveRepositoryRoot, 0);

    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot, 'feature/transaction-root-import');
    await transaction.import({
      workspaceId: 'ws_one',
      workspaceRoot,
      absolutePath: externalPath,
      worktreeId: 'wt_transaction_root_import',
    });
    assert.equal(calls.resolveRepositoryRoot, 0);

    await transaction.recover({ workspaceId: 'ws_one', workspaceRoot });
    assert.equal(calls.resolveRepositoryRoot, 0);
  });
});

test('does not repeat Git preflight before the transactional create path', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/transaction-preflight']);
    const baseGit = new LocalGitAdapter();
    const calls = {
      validateRepository: 0,
      resolveRepositoryIdentity: 0,
      resolveRepositoryRoot: 0,
      listBranches: 0,
      listBranchesWithWorktreePaths: 0,
      listWorktrees: 0,
      createWorktree: 0,
    };
    const git = {
      async validateRepository(...args) {
        calls.validateRepository += 1;
        return baseGit.validateRepository(...args);
      },
      async resolveRepositoryIdentity(...args) {
        calls.resolveRepositoryIdentity += 1;
        return baseGit.resolveRepositoryIdentity(...args);
      },
      async resolveRepositoryRoot(...args) {
        calls.resolveRepositoryRoot += 1;
        return baseGit.resolveRepositoryRoot(...args);
      },
      async listBranches(...args) {
        calls.listBranches += 1;
        return baseGit.listBranches(...args);
      },
      async listBranchesWithWorktreePaths(...args) {
        calls.listBranchesWithWorktreePaths += 1;
        return baseGit.listBranchesWithWorktreePaths(...args);
      },
      async listWorktrees(...args) {
        calls.listWorktrees += 1;
        return baseGit.listWorktrees(...args);
      },
      async createWorktree(...args) {
        calls.createWorktree += 1;
        return baseGit.createWorktree(...args);
      },
      removeWorktree: (...args) => baseGit.removeWorktree(...args),
    };
    const provider = createWorktreeManager({
      dsh,
      dshHome,
      sidecar,
      git,
      idFactory: () => 'wt_transaction_preflight',
    });

    await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/transaction-preflight' });
    assert.deepEqual(calls, {
      validateRepository: 1,
      resolveRepositoryIdentity: 1,
      resolveRepositoryRoot: 0,
      listBranches: 0,
      listBranchesWithWorktreePaths: 1,
      listWorktrees: 1,
      createWorktree: 1,
    });
  });
});

test('keeps injected Git adapters without a root resolver compatible', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot }) => {
    const baseGit = new LocalGitAdapter();
    const legacyGit = {
      validateRepository: (...args) => baseGit.validateRepository(...args),
      listBranches: (...args) => baseGit.listBranches(...args),
      listWorktrees: (...args) => baseGit.listWorktrees(...args),
      createWorktree: (...args) => baseGit.createWorktree(...args),
      removeWorktree: (...args) => baseGit.removeWorktree(...args),
    };
    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: workspaceRoot }),
      dshHome,
      git: legacyGit,
    });

    assert.deepEqual(await provider.listBranches({ workspaceId: 'ws_one' }), [
      { name: 'main', isCurrent: true, checkedOut: true },
    ]);
  });
});

test('rejects a generated Worktree path that already exists or is inside the Workspace', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, dsh }) => {
    await runGit(workspaceRoot, ['branch', 'feature/existing']);
    await runGit(workspaceRoot, ['branch', 'feature/inside']);
    const existingId = 'wt_existing';
    const existingPath = path.join(dshHome, 'clutch-dsh-worktree', 'worktree', existingId);
    await mkdir(existingPath, { recursive: true });
    const existingProvider = createWorktreeManager({
      dsh,
      dshHome,
      idFactory: () => existingId,
    });
    await expectCode(
      existingProvider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/existing' }),
      'GIT_OPERATION_FAILED',
    );

    const insideProvider = createWorktreeManager({
      dsh: createDshReader({ rootPath: workspaceRoot }),
      dshHome: workspaceRoot,
      idFactory: () => 'wt_inside',
    });
    await expectCode(
      insideProvider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/inside' }),
      'GIT_OPERATION_FAILED',
    );
  });
});

test('rejects a symlinked DSH Home before creating a Worktree', async () => {
  await withGitFixture(async ({ dshHome, tempRoot, workspaceRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/symlink']);
    const linkedHome = path.join(tempRoot, 'dsh-home-link');
    await symlink(dshHome, linkedHome, 'dir');
    const provider = createWorktreeManager({
      dsh: createDshReader({ rootPath: workspaceRoot }),
      dshHome: linkedHome,
      idFactory: () => 'wt_symlink',
    });

    await expectCode(
      provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/symlink' }),
      'GIT_OPERATION_FAILED',
    );
  });
});

test('rejects a reused Worktree ID even when the old record is removed', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/reused-id']);
    const worktreeId = 'wt_reused';
    await sidecar.upsertWorktree({
      ...makeRecord({
        worktreeId,
        absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId),
        branch: 'feature/old',
      }),
      status: 'removed',
    });
    const reusedProvider = createWorktreeManager({
      dsh: createDshReader({ rootPath: workspaceRoot }),
      dshHome,
      sidecar,
      idFactory: () => worktreeId,
    });

    await expectCode(
      reusedProvider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/reused-id' }),
      'SIDECAR_CORRUPT',
    );
    assert.equal(await exists(path.join(dshHome, 'clutch-dsh-worktree', 'worktree', worktreeId)), false);
    assert.deepEqual((await sidecar.read('ws_one')).worktrees.map((record) => record.worktreeId), [worktreeId]);
    void provider;
  });
});

test('creates a generated Worktree and persists only approved relation metadata', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, provider, sidecar, dsh }) => {
    await runGit(workspaceRoot, ['branch', 'feature/example']);
    const dshFixturePath = path.join(dshHome, 'dsh-project-session-fixture.json');
    await writeFile(dshFixturePath, '{"title":"DSH-owned","messages":["history"],"cwd":"original"}\n');
    const dshFixtureBefore = await readFile(dshFixturePath);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/example' });
    const expectedPath = path.join(dshHome, 'clutch-dsh-worktree', 'worktree', record.worktreeId);

    assert.equal(record.absolutePath, expectedPath);
    assert.equal(record.source, 'plugin');
    assert.equal(path.isAbsolute(record.absolutePath), true);
    assert.equal(await exists(record.absolutePath), true);
    const snapshot = await sidecar.read('ws_one');
    assert.equal(snapshot.schemaVersion, SIDECAR_SCHEMA_VERSION);
    assert.equal(snapshot.workspaceId, 'ws_one');
    assert.equal(snapshot.revision, '2');
    assert.deepEqual(snapshot.worktrees, [record]);
    assert.deepEqual(snapshot.bindings, []);
    assert.match(snapshot.repositoryFingerprint, /^v1-[a-f0-9]{64}$/);
    assert.equal(snapshot.repository, undefined);
    assert.equal((await provider.listBranches({ workspaceId: 'ws_one' })).find((branch) => branch.name === 'main').checkedOut, true);
    assert.equal((await provider.listBranches({ workspaceId: 'ws_one' })).find((branch) => branch.name === 'feature/example').checkedOut, true);
    assert.deepEqual(await readFile(dshFixturePath), dshFixtureBefore);

    dsh.addSession({
      sessionId: 'session_content',
      workspaceId: 'ws_one',
      projectId: 'project_one',
      cwd: record.absolutePath,
      title: 'must stay in DSH',
      messages: ['not sidecar data'],
    });
    await provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'session_content' });
    assert.deepEqual(await readFile(dshFixturePath), dshFixtureBefore);
    const sidecarText = await readFile(path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json'), 'utf8');
    assert.equal(sidecarText.includes('must stay in DSH'), false);
    assert.equal(sidecarText.includes('messages'), false);
    assert.equal(sidecarText.includes(workspaceRoot), false);
    await provider.removeWorktree({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      mutationToken: await mutationTokenFor(provider, 'ws_one', record.worktreeId),
    });
    assert.deepEqual(await readFile(dshFixturePath), dshFixtureBefore);
  });
});

test('rejects a destructive Worktree action with a stale mutation token', async () => {
  await withGitFixture(async ({ dsh, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/stale-token']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/stale-token' });
    const listed = (await provider.listWorktrees({ workspaceId: 'ws_one' }))[0];
    assert.equal(typeof listed.mutationToken, 'string');

    await sidecar.mutate('ws_one', (snapshot) => ({
      result: undefined,
      snapshot: {
        ...snapshot,
        bindings: [{
          workspaceId: 'ws_one',
          worktreeId: record.worktreeId,
          sessionId: 'detached-history',
          status: 'detached',
        }, ...snapshot.bindings],
      },
    }));

    await expectCode(
      provider.removeWorktree({
        workspaceId: 'ws_one',
        worktreeId: record.worktreeId,
        mutationToken: listed.mutationToken,
      }),
      'WORKTREE_STATE_CONFLICT',
    );
    assert.equal(await exists(record.absolutePath), true);
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'active');
    void dsh;
  });
});

test('rejects a destructive Worktree action when its mutation token is omitted', async () => {
  await withGitFixture(async ({ workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/missing-token']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/missing-token' });

    await expectCode(
      provider.removeWorktree({ workspaceId: 'ws_one', worktreeId: record.worktreeId }),
      'WORKTREE_STATE_CONFLICT',
    );
    assert.equal(await exists(record.absolutePath), true);
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'active');
  });
});

test('refuses to remove a Worktree after its registered path is replaced', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, provider, sidecar, tempRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/replaced-path']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/replaced-path' });
    const mutationToken = await mutationTokenFor(provider, 'ws_one', record.worktreeId);
    const replacement = path.join(tempRoot, 'replacement-directory');
    await rename(record.absolutePath, replacement);
    await symlink(replacement, record.absolutePath, 'dir');

    await expectCode(
      provider.removeWorktree({
        workspaceId: 'ws_one',
        worktreeId: record.worktreeId,
        mutationToken,
      }),
      'WORKTREE_IDENTITY_CHANGED',
    );
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'active');
    assert.equal(await exists(replacement), true);
    void dshHome;
  });
});

test('rejects a destructive action when the Workspace repository identity changes', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, provider, sidecar, tempRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/repository-change']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/repository-change' });
    const mutationToken = await mutationTokenFor(provider, 'ws_one', record.worktreeId);
    await new LocalGitAdapter().removeWorktree(workspaceRoot, record.absolutePath);

    const otherRoot = path.join(tempRoot, 'other-repository');
    await mkdir(otherRoot, { recursive: true });
    await runGit(otherRoot, ['init']);
    await runGit(otherRoot, ['config', 'user.email', 'test@example.invalid']);
    await runGit(otherRoot, ['config', 'user.name', 'Test User']);
    await runGit(otherRoot, ['branch', '-M', 'main']);
    await writeFile(path.join(otherRoot, 'README.md'), '# other\n');
    await runGit(otherRoot, ['add', 'README.md']);
    await runGit(otherRoot, ['commit', '-m', 'initial']);

    const originalGetWorkspace = dsh.getWorkspace;
    dsh.getWorkspace = async (workspaceId) => {
      const current = await originalGetWorkspace(workspaceId);
      return current === undefined ? undefined : { ...current, rootPath: otherRoot };
    };

    await expectCode(
      provider.removeWorktree({
        workspaceId: 'ws_one',
        worktreeId: record.worktreeId,
        mutationToken,
      }),
      'WORKTREE_IDENTITY_CHANGED',
    );
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'active');
    assert.equal(await exists(path.join(dshHome, 'clutch-dsh-worktree', 'worktree', record.worktreeId)), false);
  });
});

test('lists only unmanaged branch-attached external Worktrees in Git list order', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, tempRoot }) => {
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot, 'feature/external');
    const detachedPath = path.join(tempRoot, 'detached');
    await runGit(workspaceRoot, ['worktree', 'add', '--detach', detachedPath, 'HEAD']);
    await runGit(workspaceRoot, ['branch', 'feature/plugin']);
    await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/plugin' });

    assert.deepEqual(await provider.listImportCandidates({ workspaceId: 'ws_one' }), [
      { absolutePath: await realpath(externalPath), branch: 'feature/external' },
    ]);
  });
});

test('imports an external Worktree without mutating Git or its directory and is idempotent', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, tempRoot, sidecar }) => {
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot);
    const directoryBefore = await readFile(path.join(externalPath, 'README.md'));
    const gitBefore = (await runGit(workspaceRoot, ['worktree', 'list', '--porcelain'])).stdout;

    const imported = await provider.importWorktree({ workspaceId: 'ws_one', absolutePath: externalPath });
    assert.deepEqual(imported, {
      worktreeId: imported.worktreeId,
      workspaceId: 'ws_one',
      absolutePath: await realpath(externalPath),
      branch: 'feature/external',
      source: 'external',
      status: 'active',
    });
    assert.deepEqual(await readFile(path.join(externalPath, 'README.md')), directoryBefore);
    assert.equal((await runGit(workspaceRoot, ['worktree', 'list', '--porcelain'])).stdout, gitBefore);
    assert.deepEqual(
      await provider.importWorktree({ workspaceId: 'ws_one', absolutePath: externalPath }),
      imported,
    );
    assert.equal((await sidecar.read('ws_one')).worktrees.length, 1);
  });
});

test('serializes external import behind the repository mutation lock', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, tempRoot, sidecar }) => {
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot, 'feature/import-lock');
    const git = new LocalGitAdapter();
    const identity = await git.resolveRepositoryIdentity(workspaceRoot);
    const transaction = new WorktreeMutationTransaction({ dshHome, git, sidecar });
    const lock = new CrossProcessMutationLock({
      lockRoot: path.join(dshHome, 'clutch-dsh-worktree', 'locks'),
      acquisitionTimeoutMs: 500,
    });
    let release;
    const held = lock.run(`repository:${createRepositoryFingerprint(identity.identity)}`, async () => {
      await new Promise((resolve) => {
        release = resolve;
      });
    });

    const importing = transaction.import({
      workspaceId: 'ws_one',
      workspaceRoot,
      absolutePath: externalPath,
      worktreeId: 'wt_import_lock',
    });
    await delay(80);
    assert.deepEqual((await sidecar.read('ws_one')).worktrees, []);
    release();
    await held;
    const record = await importing;
    assert.equal(record.worktreeId, 'wt_import_lock');
    assert.equal(record.source, 'external');
  });
});

test('imports an external Worktree through a physical-path alias and stores its canonical path', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, tempRoot }) => {
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot);
    const aliasPath = path.join(tempRoot, 'external-alias');
    await symlink(externalPath, aliasPath, 'dir');

    const imported = await provider.importWorktree({ workspaceId: 'ws_one', absolutePath: aliasPath });
    assert.equal(imported.absolutePath, await realpath(externalPath));
  });
});

test('revalidates Git membership inside the serialized import mutation', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, tempRoot, sidecar }) => {
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot);
    const raceSidecar = {
      read: (...args) => sidecar.read(...args),
      async mutate(workspaceId, mutation) {
        await runGit(workspaceRoot, ['worktree', 'remove', '--force', externalPath]);
        return sidecar.mutate(workspaceId, mutation);
      },
    };
    const provider = createWorktreeManager({ dsh, dshHome, sidecar: raceSidecar });

    await expectCode(
      provider.importWorktree({ workspaceId: 'ws_one', absolutePath: externalPath }),
      'WORKTREE_IMPORT_INVALID',
    );
    assert.deepEqual((await sidecar.read('ws_one')).worktrees, []);
  });
});

test('keeps historical sidecar records out of import candidates', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, tempRoot, sidecar }) => {
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot);
    const imported = await provider.importWorktree({ workspaceId: 'ws_one', absolutePath: externalPath });
    await sidecar.mutate('ws_one', (snapshot) => ({
      result: undefined,
      snapshot: {
        ...snapshot,
        worktrees: snapshot.worktrees.map((record) =>
          record.worktreeId === imported.worktreeId ? { ...record, status: 'removed' } : record,
        ),
      },
    }));

    assert.deepEqual(await provider.listImportCandidates({ workspaceId: 'ws_one' }), []);
  });
});

test('removes an imported Worktree before detaching its active binding without touching DSH bytes', async () => {
  await withGitFixture(async ({ dsh, dshHome, provider, sidecar, workspaceRoot, tempRoot }) => {
    const externalPath = await addExternalWorktree(workspaceRoot, tempRoot);
    const fixturePath = path.join(dshHome, 'dsh-owned.json');
    await writeFile(fixturePath, '{"session":"owned","messages":["keep"]}\n');
    const fixtureBefore = await readFile(fixturePath);
    const imported = await provider.importWorktree({ workspaceId: 'ws_one', absolutePath: externalPath });
    dsh.addSession({
      sessionId: 'session_external_remove',
      workspaceId: 'ws_one',
      projectId: 'project_one',
      cwd: imported.absolutePath,
    });
    await provider.bindSession({
      workspaceId: 'ws_one',
      worktreeId: imported.worktreeId,
      sessionId: 'session_external_remove',
    });

    await provider.removeWorktree({
      workspaceId: 'ws_one',
      worktreeId: imported.worktreeId,
      mutationToken: await mutationTokenFor(provider, 'ws_one', imported.worktreeId),
    });
    const snapshot = await sidecar.read('ws_one');
    assert.equal(await exists(externalPath), false);
    assert.equal(snapshot.worktrees[0].status, 'removed');
    assert.equal(snapshot.bindings[0].status, 'detached');
    assert.deepEqual(await readFile(fixturePath), fixtureBefore);
  });
});

test('rejects import validation failures and managed physical paths', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, tempRoot }) => {
    await addExternalWorktree(workspaceRoot, tempRoot);
    const outsidePath = path.join(tempRoot, 'outside');
    const filePath = path.join(tempRoot, 'not-a-directory');
    await mkdir(outsidePath);
    await writeFile(filePath, 'not a directory');

    for (const absolutePath of [
      'relative/path',
      path.join(tempRoot, 'missing'),
      filePath,
      outsidePath,
      workspaceRoot,
    ]) {
      await expectCode(provider.importWorktree({ workspaceId: 'ws_one', absolutePath }), 'WORKTREE_IMPORT_INVALID');
    }

    const detachedPath = path.join(tempRoot, 'detached-import');
    await runGit(workspaceRoot, ['worktree', 'add', '--detach', detachedPath, 'HEAD']);
    await expectCode(
      provider.importWorktree({ workspaceId: 'ws_one', absolutePath: detachedPath }),
      'WORKTREE_IMPORT_INVALID',
    );
    const otherRepository = await createGitWorkspace();
    try {
      await expectCode(
        provider.importWorktree({ workspaceId: 'ws_one', absolutePath: otherRepository.workspaceRoot }),
        'WORKTREE_IMPORT_INVALID',
      );
    } finally {
      await rm(otherRepository.tempRoot, { recursive: true, force: true });
    }

    await runGit(workspaceRoot, ['branch', 'feature/plugin-path']);
    const plugin = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/plugin-path' });
    await expectCode(provider.importWorktree({ workspaceId: 'ws_one', absolutePath: plugin.absolutePath }), 'WORKTREE_ALREADY_MANAGED');
  });
});

test('normalizes v1 reads and writes source-aware schema v3 on mutation', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const worktreeRoot = path.join(dshHome, 'clutch-dsh-worktree', 'worktree');
    const shardPath = path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json');
    await mkdir(path.dirname(shardPath), { recursive: true });
    await writeFile(shardPath, `${JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'ws_one',
      worktrees: [{
        worktreeId: 'wt_v1',
        workspaceId: 'ws_one',
        absolutePath: path.join(worktreeRoot, 'wt_v1'),
        branch: 'feature/v1',
        status: 'active',
      }],
      bindings: [],
    })}\n`);
    assert.equal((await sidecar.read('ws_one')).worktrees[0].source, 'plugin');
    assert.equal(JSON.parse(await readFile(shardPath, 'utf8')).schemaVersion, 1);

    await sidecar.mutate('ws_one', (snapshot) => ({ result: undefined, snapshot }));
    const persisted = JSON.parse(await readFile(shardPath, 'utf8'));
    assert.equal(persisted.schemaVersion, 3);
    assert.equal(typeof persisted.revision, 'string');
    assert.equal(persisted.worktrees[0].source, 'plugin');
  });
});

test('cleans up a newly created Worktree when sidecar persistence fails', async () => {
  await withGitFixture(async ({ dshHome, dsh, workspaceRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/sidecar-failure']);
    const sidecar = {
      async read() {
        return { schemaVersion: SIDECAR_SCHEMA_VERSION, workspaceId: 'ws_one', worktrees: [], bindings: [] };
      },
      async mutate() {
        throw new WorktreeProviderError('SIDECAR_UNAVAILABLE', 'sidecar write failed', { reason: 'test' });
      },
    };
    const provider = createWorktreeManager({
      dsh,
      dshHome,
      sidecar,
      idFactory: () => 'wt_sidecar_failure',
    });

    await expectCode(provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/sidecar-failure' }), 'SIDECAR_UNAVAILABLE');
    assert.equal(await exists(path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_sidecar_failure')), false);
  });
});

test('returns sync-required when cleanup after sidecar failure also fails', async () => {
  await withGitFixture(async ({ dshHome, dsh, workspaceRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/cleanup-failure']);
    const baseGit = new LocalGitAdapter();
    const git = {
      listBranches: (...args) => baseGit.listBranches(...args),
      listWorktrees: (...args) => baseGit.listWorktrees(...args),
      validateRepository: (...args) => baseGit.validateRepository(...args),
      createWorktree: (...args) => baseGit.createWorktree(...args),
      async removeWorktree() {
        throw new Error('cleanup blocked');
      },
    };
    const sidecar = {
      async read() {
        return { schemaVersion: SIDECAR_SCHEMA_VERSION, workspaceId: 'ws_one', worktrees: [], bindings: [] };
      },
      async mutate() {
        throw new WorktreeProviderError('SIDECAR_UNAVAILABLE', 'sidecar write failed', { reason: 'test' });
      },
    };
    const provider = createWorktreeManager({
      dsh,
      dshHome,
      git,
      sidecar,
      idFactory: () => 'wt_cleanup_failure',
    });

    await expectCode(provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/cleanup-failure' }), 'SIDECAR_SYNC_REQUIRED');
    assert.equal(await exists(path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_cleanup_failure')), true);
  });
});

test('binds a Session idempotently and rejects a second active Worktree', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, dsh }) => {
    await runGit(workspaceRoot, ['branch', 'feature/one']);
    await runGit(workspaceRoot, ['branch', 'feature/two']);
    const first = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/one' });
    const second = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/two' });
    dsh.addSession({ sessionId: 'session_bound', workspaceId: 'ws_one', projectId: 'project_one', cwd: first.absolutePath });

    const binding = await provider.bindSession({ workspaceId: 'ws_one', worktreeId: first.worktreeId, sessionId: 'session_bound' });
    assert.deepEqual(
      await provider.bindSession({ workspaceId: 'ws_one', worktreeId: first.worktreeId, sessionId: 'session_bound' }),
      binding,
    );
    await expectCode(
      provider.bindSession({ workspaceId: 'ws_one', worktreeId: second.worktreeId, sessionId: 'session_bound' }),
      'SESSION_ALREADY_BOUND',
    );
  });
});

test('puts the newest Session binding at the head of its Worktree group', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, dsh }) => {
    await runGit(workspaceRoot, ['branch', 'feature/session-order']);
    const worktree = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'feature/session-order',
    });
    dsh.addSession({
      sessionId: 'session-old',
      workspaceId: 'ws_one',
      projectId: 'project_one',
      cwd: worktree.absolutePath,
    });
    dsh.addSession({
      sessionId: 'session-new',
      workspaceId: 'ws_one',
      projectId: 'project_one',
      cwd: worktree.absolutePath,
    });

    await provider.bindSession({
      workspaceId: 'ws_one',
      worktreeId: worktree.worktreeId,
      sessionId: 'session-old',
    });
    await provider.bindSession({
      workspaceId: 'ws_one',
      worktreeId: worktree.worktreeId,
      sessionId: 'session-new',
    });

    assert.deepEqual(await provider.listBindings({ workspaceId: 'ws_one' }), [
      {
        workspaceId: 'ws_one',
        worktreeId: worktree.worktreeId,
        sessionId: 'session-new',
        status: 'active',
      },
      {
        workspaceId: 'ws_one',
        worktreeId: worktree.worktreeId,
        sessionId: 'session-old',
        status: 'active',
      },
    ]);
  });
});

test('sidecar upsert rejects a Session binding conflict with a stable error', async () => {
  await withGitFixture(async ({ dshHome, workspaceRoot, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/binding-one']);
    await runGit(workspaceRoot, ['branch', 'feature/binding-two']);
    const first = await createWorktreeManager({
      dsh: createDshReader({ rootPath: workspaceRoot }),
      dshHome,
      sidecar,
      idFactory: () => 'wt_binding_one',
    }).createWorktree({ workspaceId: 'ws_one', branch: 'feature/binding-one' });
    const second = await createWorktreeManager({
      dsh: createDshReader({ rootPath: workspaceRoot }),
      dshHome,
      sidecar,
      idFactory: () => 'wt_binding_two',
    }).createWorktree({ workspaceId: 'ws_one', branch: 'feature/binding-two' });

    await sidecar.upsertBinding(makeBinding({ worktreeId: first.worktreeId, sessionId: 'session_conflict' }));
    await expectCode(
      sidecar.upsertBinding(makeBinding({ worktreeId: second.worktreeId, sessionId: 'session_conflict' })),
      'SESSION_ALREADY_BOUND',
    );
  });
});

test('rejects missing, mismatched, and relative Session bindings', async () => {
  await withGitFixture(async ({ provider, workspaceRoot, dsh }) => {
    await runGit(workspaceRoot, ['branch', 'feature/bind']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/bind' });

    await expectCode(
      provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'missing' }),
      'SESSION_NOT_FOUND',
    );
    dsh.addSession({ sessionId: 'wrong_workspace', workspaceId: 'ws_other', cwd: record.absolutePath });
    await expectCode(
      provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'wrong_workspace' }),
      'SESSION_CWD_MISMATCH',
    );
    dsh.addSession({ sessionId: 'relative_cwd', workspaceId: 'ws_one', cwd: 'relative/path' });
    await expectCode(
      provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'relative_cwd' }),
      'SESSION_CWD_MISMATCH',
    );
    dsh.addSession({ sessionId: 'wrong_cwd', workspaceId: 'ws_one', cwd: workspaceRoot });
    await expectCode(
      provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'wrong_cwd' }),
      'SESSION_CWD_MISMATCH',
    );
  });
});

test('keeps stable sidecar relations unchanged when Git Worktree removal fails', async () => {
  await withGitFixture(async ({ dshHome, dsh, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/remove-failure']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/remove-failure' });
    const mutationToken = await mutationTokenFor(provider, 'ws_one', record.worktreeId);
    const before = await sidecar.read('ws_one');
    const baseGit = new LocalGitAdapter();
    const failingGit = {
      listBranches: (...args) => baseGit.listBranches(...args),
      listWorktrees: (...args) => baseGit.listWorktrees(...args),
      validateRepository: (...args) => baseGit.validateRepository(...args),
      createWorktree: (...args) => baseGit.createWorktree(...args),
      async removeWorktree() {
        throw new Error('remove blocked');
      },
    };
    const failingProvider = createWorktreeManager({ dsh, dshHome, git: failingGit, sidecar });

    await expectCode(
      failingProvider.removeWorktree({
        workspaceId: 'ws_one',
        worktreeId: record.worktreeId,
        mutationToken,
      }),
      'GIT_OPERATION_FAILED',
    );
    const after = await sidecar.read('ws_one');
    assert.deepEqual(after.worktrees, before.worktrees);
    assert.deepEqual(after.bindings, before.bindings);
    assert.equal(after.pendingOperation, undefined);
    assert.notEqual(after.revision, before.revision);
    assert.equal(await exists(record.absolutePath), true);
  });
});

test('reconciles a sidecar after Git removal succeeded but sidecar sync failed', async () => {
  await withGitFixture(async ({ dshHome, dsh, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/remove-sync']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/remove-sync' });
    const mutationToken = await mutationTokenFor(provider, 'ws_one', record.worktreeId);
    let failWrite = true;
    const flakySidecar = {
      read: (...args) => sidecar.read(...args),
      async mutate(workspaceId, mutation) {
        const current = await sidecar.read(workspaceId);
        const result = await mutation(current);
        if (failWrite) {
          failWrite = false;
          throw new WorktreeProviderError('SIDECAR_UNAVAILABLE', 'sidecar sync failed', { reason: 'test' });
        }
        return sidecar.mutate(workspaceId, () => result);
      },
    };
    const firstAttempt = createWorktreeManager({ dsh, dshHome, sidecar: flakySidecar });

    await expectCode(
      firstAttempt.removeWorktree({
        workspaceId: 'ws_one',
        worktreeId: record.worktreeId,
        mutationToken,
      }),
      'SIDECAR_SYNC_REQUIRED',
    );
    assert.equal(await exists(record.absolutePath), false);
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'active');

    const retry = createWorktreeManager({ dsh, dshHome, sidecar });
    await retry.removeWorktree({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      mutationToken: await mutationTokenFor(retry, 'ws_one', record.worktreeId),
    });
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'removed');
  });
});

test('marks a removed Worktree and its bindings detached only after Git succeeds', async () => {
  await withGitFixture(async ({ dsh, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/remove']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/remove' });
    dsh.addSession({ sessionId: 'session_remove', workspaceId: 'ws_one', projectId: 'project_one', cwd: record.absolutePath });
    await provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'session_remove' });

    await provider.removeWorktree({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      mutationToken: await mutationTokenFor(provider, 'ws_one', record.worktreeId),
    });
    const snapshot = await sidecar.read('ws_one');
    assert.equal(await exists(record.absolutePath), false);
    assert.equal(snapshot.worktrees[0].status, 'removed');
    assert.deepEqual(snapshot.bindings[0], {
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      sessionId: 'session_remove',
      status: 'detached',
    });
  });
});

test('moves Worktrees through Manage while preserving the sidecar order', async () => {
  await withGitFixture(async ({ dshHome, provider, sidecar }) => {
    await sidecar.upsertWorktree(makeRecord({
      worktreeId: 'wt_one',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_one'),
    }));
    await sidecar.upsertWorktree(makeRecord({
      worktreeId: 'wt_two',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_two'),
    }));

    assert.deepEqual(
      await provider.insertWorktreeBefore({
        workspaceId: 'ws_one',
        worktreeId: 'wt_two',
        beforeWorktreeId: 'wt_one',
      }),
      ['wt_two', 'wt_one'],
    );
  });
});

test('derives main, active, and detached runtime cwd without writing to DSH', async () => {
  await withGitFixture(async ({ dsh, workspaceRoot, provider }) => {
    await runGit(workspaceRoot, ['branch', 'feature/cwd']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/cwd' });
    dsh.addSession({ sessionId: 'session_cwd', workspaceId: 'ws_one', projectId: 'project_one', cwd: record.absolutePath });

    assert.equal(await provider.resolveRuntimeCwd({ workspaceId: 'ws_one', sessionId: 'session_cwd' }), workspaceRoot);
    await provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'session_cwd' });
    assert.equal(await provider.resolveRuntimeCwd({ workspaceId: 'ws_one', sessionId: 'session_cwd' }), record.absolutePath);
    await provider.removeWorktree({
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      mutationToken: await mutationTokenFor(provider, 'ws_one', record.worktreeId),
    });
    assert.equal(await provider.resolveRuntimeCwd({ workspaceId: 'ws_one', sessionId: 'session_cwd' }), workspaceRoot);
    assert.deepEqual(await provider.listBindings({ workspaceId: 'ws_one' }), [{
      workspaceId: 'ws_one',
      worktreeId: record.worktreeId,
      sessionId: 'session_cwd',
      status: 'detached',
    }]);
    assert.equal((await dsh.listSessions())[0].cwd, record.absolutePath);
  });
});

test('reports an explicit error for an active binding whose Worktree path disappeared', async () => {
  await withGitFixture(async ({ dshHome, dsh, provider, sidecar, workspaceRoot }) => {
    const missingPath = path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_missing');
    await sidecar.upsertWorktree(makeRecord({ worktreeId: 'wt_missing', absolutePath: missingPath }));
    await sidecar.upsertBinding(makeBinding({ worktreeId: 'wt_missing', sessionId: 'session_missing_path' }));
    dsh.addSession({ sessionId: 'session_missing_path', workspaceId: 'ws_one', cwd: workspaceRoot });

    await expectCode(
      provider.resolveRuntimeCwd({ workspaceId: 'ws_one', sessionId: 'session_missing_path' }),
      'WORKTREE_NOT_FOUND',
    );
  });
});

test('keeps the raw DSH Session read path available when sidecar data is corrupt', async () => {
  await withGitFixture(async ({ dshHome, dsh, provider }) => {
    const fixturePath = path.join(dshHome, 'dsh-sessions.json');
    const fixtureBytes = '{"title":"DSH-owned","messages":["history"],"transcript":"raw"}\n';
    await writeFile(fixturePath, fixtureBytes);
    dsh.addSession({ sessionId: 'session_raw', workspaceId: 'ws_one', cwd: '/tmp/raw' });
    const before = await readFile(fixturePath);
    await mkdir(path.join(dshHome, 'clutch-dsh-worktree', 'workspaces'), { recursive: true });
    await writeFile(path.join(dshHome, 'clutch-dsh-worktree', 'workspaces', 'ws_one.json'), '{not-json}\n');

    await expectCode(provider.listWorktrees({ workspaceId: 'ws_one' }), 'SIDECAR_CORRUPT');
    assert.deepEqual(await dsh.listSessions(), [{ sessionId: 'session_raw', workspaceId: 'ws_one', cwd: '/tmp/raw' }]);
    assert.deepEqual(await readFile(fixturePath), before);
  });
});

test('projects repair health when an active Worktree path is missing from Git', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, sidecar }) => {
    const record = makeRecord({
      worktreeId: 'wt_missing_health',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_missing_health'),
    });
    await sidecar.upsertWorktree(record);
    const baseGit = new LocalGitAdapter();
    const git = {
      validateRepository: (...args) => baseGit.validateRepository(...args),
      listBranches: (...args) => baseGit.listBranches(...args),
      listWorktrees: async () => [{ absolutePath: workspaceRoot }],
      createWorktree: (...args) => baseGit.createWorktree(...args),
      removeWorktree: (...args) => baseGit.removeWorktree(...args),
    };
    const manager = createWorktreeManager({ dsh, dshHome, sidecar, git });

    const result = await manager.listWorktrees({ workspaceId: 'ws_one' });
    assert.equal(result[0].health, 'repair');
  });
});

test('projects ready health when an active Worktree path is present in Git', async () => {
  await withGitFixture(async ({ provider, workspaceRoot }) => {
    await runGit(workspaceRoot, ['branch', 'feature/health']);
    const record = await provider.createWorktree({
      workspaceId: 'ws_one',
      branch: 'feature/health',
    });

    const result = await provider.listWorktrees({ workspaceId: 'ws_one' });
    assert.equal(
      result.find((candidate) => candidate.worktreeId === record.worktreeId).health,
      'ready',
    );
  });
});

test('projects repair on Git health failure and keeps removed records uncolored', async () => {
  await withGitFixture(async ({ dsh, dshHome, workspaceRoot, sidecar }) => {
    await sidecar.upsertWorktree({
      ...makeRecord({
        worktreeId: 'wt_failed_health',
        absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_failed_health'),
      }),
      status: 'active',
    });
    await sidecar.upsertWorktree({
      ...makeRecord({
        worktreeId: 'wt_removed_health',
        absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_removed_health'),
      }),
      status: 'removed',
    });
    const baseGit = new LocalGitAdapter();
    const git = {
      validateRepository: (...args) => baseGit.validateRepository(...args),
      listBranches: (...args) => baseGit.listBranches(...args),
      async listWorktrees() {
        throw new Error('git health unavailable');
      },
      createWorktree: (...args) => baseGit.createWorktree(...args),
      removeWorktree: (...args) => baseGit.removeWorktree(...args),
    };
    const manager = createWorktreeManager({ dsh, dshHome, sidecar, git });

    const result = await manager.listWorktrees({ workspaceId: 'ws_one' });
    assert.equal(result.find((record) => record.worktreeId === 'wt_failed_health').health, 'repair');
    assert.equal('health' in result.find((record) => record.worktreeId === 'wt_removed_health'), false);
    void workspaceRoot;
  });
});

test('does not persist transient Worktree health', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const record = makeRecord({
      worktreeId: 'wt_health',
      absolutePath: path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_health'),
    });

    await sidecar.upsertWorktree({ ...record, health: 'repair' });
    const raw = await readFile(sidecar.getShardPath('ws_one'), 'utf8');
    const snapshot = JSON.parse(raw);
    assert.equal('health' in snapshot.worktrees[0], false);
  });
});
