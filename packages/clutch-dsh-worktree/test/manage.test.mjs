import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  LocalGitAdapter,
  SIDECAR_SCHEMA_VERSION,
  WorktreeProviderError,
  WorkspaceShardedSidecarRepository,
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

function createDshReader({ workspaceId = 'ws_one', projectId = 'project_one', rootPath, sessions = [] }) {
  const sessionMap = new Map(sessions.map((session) => [session.sessionId, { ...session }]));
  const workspace = { workspaceId, projectId, rootPath };

  return {
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

function makeRecord({ workspaceId = 'ws_one', worktreeId = 'wt_seed', absolutePath, branch = 'feature/seed' } = {}) {
  return {
    worktreeId,
    workspaceId,
    absolutePath,
    branch,
    status: 'active',
  };
}

function makeBinding({ workspaceId = 'ws_one', worktreeId = 'wt_seed', sessionId = 'session_seed' } = {}) {
  return { workspaceId, worktreeId, sessionId, status: 'active' };
}

test('initializes an empty Workspace-sharded sidecar without a global index', async () => {
  await withGitFixture(async ({ dshHome, sidecar }) => {
    const snapshot = await sidecar.read('ws_one');

    assert.deepEqual(snapshot, {
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      workspaceId: 'ws_one',
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
    assert.equal(path.isAbsolute(record.absolutePath), true);
    assert.equal(await exists(record.absolutePath), true);
    assert.deepEqual(await sidecar.read('ws_one'), {
      schemaVersion: SIDECAR_SCHEMA_VERSION,
      workspaceId: 'ws_one',
      worktrees: [record],
      bindings: [],
    });
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
    await provider.removeWorktree({ workspaceId: 'ws_one', worktreeId: record.worktreeId });
    assert.deepEqual(await readFile(dshFixturePath), dshFixtureBefore);
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

test('keeps sidecar unchanged when Git Worktree removal fails', async () => {
  await withGitFixture(async ({ dshHome, dsh, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/remove-failure']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/remove-failure' });
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
      failingProvider.removeWorktree({ workspaceId: 'ws_one', worktreeId: record.worktreeId }),
      'GIT_OPERATION_FAILED',
    );
    assert.deepEqual(await sidecar.read('ws_one'), before);
    assert.equal(await exists(record.absolutePath), true);
  });
});

test('reconciles a sidecar after Git removal succeeded but sidecar sync failed', async () => {
  await withGitFixture(async ({ dshHome, dsh, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/remove-sync']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/remove-sync' });
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
      firstAttempt.removeWorktree({ workspaceId: 'ws_one', worktreeId: record.worktreeId }),
      'SIDECAR_SYNC_REQUIRED',
    );
    assert.equal(await exists(record.absolutePath), false);
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'active');

    const retry = createWorktreeManager({ dsh, dshHome, sidecar });
    await retry.removeWorktree({ workspaceId: 'ws_one', worktreeId: record.worktreeId });
    assert.equal((await sidecar.read('ws_one')).worktrees[0].status, 'removed');
  });
});

test('marks a removed Worktree and its bindings detached only after Git succeeds', async () => {
  await withGitFixture(async ({ dsh, workspaceRoot, provider, sidecar }) => {
    await runGit(workspaceRoot, ['branch', 'feature/remove']);
    const record = await provider.createWorktree({ workspaceId: 'ws_one', branch: 'feature/remove' });
    dsh.addSession({ sessionId: 'session_remove', workspaceId: 'ws_one', projectId: 'project_one', cwd: record.absolutePath });
    await provider.bindSession({ workspaceId: 'ws_one', worktreeId: record.worktreeId, sessionId: 'session_remove' });

    await provider.removeWorktree({ workspaceId: 'ws_one', worktreeId: record.worktreeId });
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
    await provider.removeWorktree({ workspaceId: 'ws_one', worktreeId: record.worktreeId });
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
