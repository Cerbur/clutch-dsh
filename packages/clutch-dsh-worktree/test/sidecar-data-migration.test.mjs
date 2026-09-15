import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LEGACY_SIDECAR_SCHEMA_VERSION,
  SIDECAR_SCHEMA_VERSION,
  WorkspaceShardedSidecarRepository,
  createRepositoryFingerprint,
  migrateSidecarSnapshot,
  validateSidecarSnapshot,
} from '../lib/index.js';

/**
 * Canonical test fixtures representing each schema version's historical on-disk structure.
 * Every time a new version is added, add migration test cases for all prior versions.
 *
 * Current versions:
 * - v1: Legacy minimal schema (no source, no revision, no metadata)
 * - v2: Added explicit 'source' ('plugin' | 'external')
 * - v3: Added 'revision', optional 'repositoryFingerprint', 'pendingOperation', 'recoveryIssues'
 * - v4: Added optional acquisition metadata ('instructions', 'baseBranch', 'createdAt', 'importedAt', 'diskCleanup')
 * - v5: Added 'baseCommit' on worktree records and create-worktree pending operations
 */

function createV1Fixture(workspaceId = 'ws_mig') {
  return {
    schemaVersion: 1,
    workspaceId,
    worktrees: [
      {
        workspaceId,
        worktreeId: 'wt_v1_active',
        absolutePath: '/tmp/repo/worktrees/wt_v1_active',
        branch: 'feature/v1-active',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v1_removed',
        absolutePath: '/tmp/repo/worktrees/wt_v1_removed',
        branch: 'feature/v1-removed',
        status: 'removed',
      },
    ],
    bindings: [
      {
        workspaceId,
        worktreeId: 'wt_v1_active',
        sessionId: 'sess_v1_active',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v1_removed',
        sessionId: 'sess_v1_detached',
        status: 'detached',
      },
    ],
  };
}

function createV2Fixture(workspaceId = 'ws_mig') {
  return {
    schemaVersion: 2,
    workspaceId,
    worktrees: [
      {
        workspaceId,
        worktreeId: 'wt_v2_plugin',
        absolutePath: '/tmp/repo/worktrees/wt_v2_plugin',
        branch: 'feature/v2-plugin',
        source: 'plugin',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v2_external',
        absolutePath: '/tmp/repo/worktrees/wt_v2_external',
        branch: 'feature/v2-external',
        source: 'external',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v2_removed',
        absolutePath: '/tmp/repo/worktrees/wt_v2_removed',
        branch: 'feature/v2-removed',
        source: 'plugin',
        status: 'removed',
      },
    ],
    bindings: [
      {
        workspaceId,
        worktreeId: 'wt_v2_plugin',
        sessionId: 'sess_v2_plugin',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v2_removed',
        sessionId: 'sess_v2_detached',
        status: 'detached',
      },
    ],
  };
}

function createV3Fixture(workspaceId = 'ws_mig') {
  const fingerprint = 'v1-' + 'c'.repeat(64);
  return {
    schemaVersion: 3,
    workspaceId,
    revision: '42',
    repositoryFingerprint: fingerprint,
    worktrees: [
      {
        workspaceId,
        worktreeId: 'wt_v3_active',
        absolutePath: '/tmp/repo/worktrees/wt_v3_active',
        branch: 'feature/v3-active',
        source: 'external',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v3_removed',
        absolutePath: '/tmp/repo/worktrees/wt_v3_removed',
        branch: 'feature/v3-removed',
        source: 'plugin',
        status: 'removed',
      },
    ],
    bindings: [
      {
        workspaceId,
        worktreeId: 'wt_v3_active',
        sessionId: 'sess_v3_active',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v3_removed',
        sessionId: 'sess_v3_detached',
        status: 'detached',
      },
    ],
    pendingOperation: {
      id: 'op_v3_remove',
      type: 'remove-worktree',
      phase: 'executing',
      workspaceId,
      worktreeId: 'wt_v3_removed',
      targetPath: '/tmp/repo/worktrees/wt_v3_removed',
      branch: 'feature/v3-removed',
      source: 'plugin',
      repositoryFingerprint: fingerprint,
      startedAt: '2026-09-01T00:00:00.000Z',
    },
    recoveryIssues: [
      {
        code: 'WORKTREE_RECOVERY_REQUIRED',
        observedAt: '2026-09-01T00:00:00.000Z',
        worktreeId: 'wt_v3_removed',
        operationId: 'op_v3_remove',
      },
    ],
  };
}

function createV4Fixture(workspaceId = 'ws_mig') {
  const fingerprint = 'v1-' + 'd'.repeat(64);
  return {
    schemaVersion: 4,
    workspaceId,
    revision: '99',
    repositoryFingerprint: fingerprint,
    worktrees: [
      {
        workspaceId,
        worktreeId: 'wt_v4_active',
        absolutePath: '/tmp/repo/worktrees/wt_v4_active',
        branch: 'feature/v4-active',
        source: 'plugin',
        status: 'active',
        instructions: 'pnpm test before commit',
        baseBranch: 'main',
        createdAt: '2026-09-10T12:00:00.000Z',
      },
      {
        workspaceId,
        worktreeId: 'wt_v4_archived',
        absolutePath: '/tmp/repo/worktrees/wt_v4_archived',
        branch: 'feature/v4-archived',
        source: 'external',
        status: 'removed',
        importedAt: '2026-09-10T13:00:00.000Z',
      },
      {
        workspaceId,
        worktreeId: 'wt_v4_cleaned',
        absolutePath: '/tmp/repo/worktrees/wt_v4_cleaned',
        branch: 'feature/v4-cleaned',
        source: 'plugin',
        status: 'removed',
        diskCleanup: 'completed',
      },
    ],
    bindings: [
      {
        workspaceId,
        worktreeId: 'wt_v4_active',
        sessionId: 'sess_v4_active',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v4_archived',
        sessionId: 'sess_v4_archived',
        status: 'active',
      },
      {
        workspaceId,
        worktreeId: 'wt_v4_cleaned',
        sessionId: 'sess_v4_detached',
        status: 'detached',
      },
    ],
    pendingOperation: {
      id: 'op_v4_clean',
      type: 'clean-worktree',
      phase: 'executing',
      workspaceId,
      worktreeId: 'wt_v4_cleaned',
      targetPath: '/tmp/repo/worktrees/wt_v4_cleaned',
      branch: 'feature/v4-cleaned',
      source: 'plugin',
      repositoryFingerprint: fingerprint,
      startedAt: '2026-09-10T14:00:00.000Z',
    },
    recoveryIssues: [
      {
        code: 'WORKTREE_IDENTITY_CHANGED',
        observedAt: '2026-09-10T14:00:00.000Z',
        worktreeId: 'wt_v4_cleaned',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// 1. v1 -> v2, v3, v4, v5
// ---------------------------------------------------------------------------

test('migration v1 -> v2: adds default source "plugin" and produces exact v2 schema shape', () => {
  const v1 = createV1Fixture();
  const v2 = validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, 2);

  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.workspaceId, 'ws_mig');
  assert.equal('revision' in v2, false);
  assert.equal('repositoryFingerprint' in v2, false);
  assert.equal(v2.worktrees.length, 2);
  assert.equal(v2.worktrees[0].source, 'plugin');
  assert.equal(v2.worktrees[1].source, 'plugin');
  assert.equal(v2.worktrees[0].worktreeId, 'wt_v1_active');
  assert.equal(v2.worktrees[1].worktreeId, 'wt_v1_removed');
  assert.deepEqual(v2.bindings, v1.bindings);

  // Assert exact keys of v2 snapshot and records
  assert.deepEqual(Object.keys(v2).sort(), ['bindings', 'schemaVersion', 'workspaceId', 'worktrees']);
  for (const record of v2.worktrees) {
    assert.deepEqual(Object.keys(record).sort(), ['absolutePath', 'branch', 'source', 'status', 'workspaceId', 'worktreeId']);
  }

  // Verify the migrated v2 snapshot validates as v2
  const revalidated = validateSidecarSnapshot(v2, '/tmp/ws.json', undefined, 2);
  assert.deepEqual(revalidated, v2);
});

test('migration v1 -> v3: normalizes source to "plugin", initializes revision to "0"', () => {
  const v1 = createV1Fixture();
  const v3 = validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, 3);

  assert.equal(v3.schemaVersion, 3);
  assert.equal(v3.workspaceId, 'ws_mig');
  assert.equal(v3.revision, '0');
  assert.equal(v3.worktrees[0].source, 'plugin');
  assert.equal(v3.worktrees[1].source, 'plugin');
  assert.equal('diskCleanup' in v3.worktrees[1], false);
  assert.deepEqual(v3.bindings, v1.bindings);

  // Verify valid v3 validation
  const revalidated = validateSidecarSnapshot(v3, '/tmp/ws.json', undefined, 3);
  assert.deepEqual(revalidated, v3);
});

test('migration v1 -> v4: normalizes legacy removed records to diskCleanup "completed"', () => {
  const v1 = createV1Fixture();
  const v4 = validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, 4);

  assert.equal(v4.schemaVersion, 4);
  assert.equal(v4.workspaceId, 'ws_mig');
  assert.equal(v4.revision, '0');
  assert.equal(v4.worktrees[0].status, 'active');
  assert.equal(v4.worktrees[0].diskCleanup, undefined);
  assert.equal(v4.worktrees[1].status, 'removed');
  assert.equal(v4.worktrees[1].diskCleanup, 'completed');
  assert.deepEqual(v4.bindings, v1.bindings);

  // Verify valid v4 validation
  const revalidated = validateSidecarSnapshot(v4, '/tmp/ws.json', undefined, 4);
  assert.deepEqual(revalidated, v4);
});

test('migration v1 -> v5: migrates legacy v1 directly to current schema version v5', () => {
  const v1 = createV1Fixture();
  const v5 = validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, 5);

  assert.equal(v5.schemaVersion, SIDECAR_SCHEMA_VERSION);
  assert.equal(v5.workspaceId, 'ws_mig');
  assert.equal(v5.revision, '0');
  assert.equal(v5.worktrees[0].source, 'plugin');
  assert.equal(v5.worktrees[1].diskCleanup, 'completed');
  assert.deepEqual(v5.bindings, v1.bindings);

  // migrateSidecarSnapshot helper behaves identically
  const migratedViaHelper = migrateSidecarSnapshot(v1, 5, '/tmp/ws.json');
  assert.deepEqual(migratedViaHelper, v5);

  // Default targetVersion is 5
  const defaultMigrated = validateSidecarSnapshot(v1, '/tmp/ws.json');
  assert.deepEqual(defaultMigrated, v5);
});

// ---------------------------------------------------------------------------
// 2. v2 -> v3, v4, v5
// ---------------------------------------------------------------------------

test('migration v2 -> v3: preserves explicit sources and initializes revision to "0"', () => {
  const v2 = createV2Fixture();
  const v3 = validateSidecarSnapshot(v2, '/tmp/ws.json', undefined, 3);

  assert.equal(v3.schemaVersion, 3);
  assert.equal(v3.workspaceId, 'ws_mig');
  assert.equal(v3.revision, '0');
  assert.equal(v3.worktrees[0].source, 'plugin');
  assert.equal(v3.worktrees[1].source, 'external');
  assert.equal(v3.worktrees[2].source, 'plugin');
  assert.equal('diskCleanup' in v3.worktrees[2], false);
  assert.deepEqual(v3.bindings, v2.bindings);

  const revalidated = validateSidecarSnapshot(v3, '/tmp/ws.json', undefined, 3);
  assert.deepEqual(revalidated, v3);
});

test('migration v2 -> v4: preserves explicit sources and sets removed records to diskCleanup "completed"', () => {
  const v2 = createV2Fixture();
  const v4 = validateSidecarSnapshot(v2, '/tmp/ws.json', undefined, 4);

  assert.equal(v4.schemaVersion, 4);
  assert.equal(v4.revision, '0');
  assert.equal(v4.worktrees[0].source, 'plugin');
  assert.equal(v4.worktrees[0].diskCleanup, undefined);
  assert.equal(v4.worktrees[1].source, 'external');
  assert.equal(v4.worktrees[2].source, 'plugin');
  assert.equal(v4.worktrees[2].status, 'removed');
  assert.equal(v4.worktrees[2].diskCleanup, 'completed');

  const revalidated = validateSidecarSnapshot(v4, '/tmp/ws.json', undefined, 4);
  assert.deepEqual(revalidated, v4);
});

test('migration v2 -> v5: migrates v2 to v5 preserving explicit sources and marking removed records as cleaned', () => {
  const v2 = createV2Fixture();
  const v5 = validateSidecarSnapshot(v2, '/tmp/ws.json', undefined, 5);

  assert.equal(v5.schemaVersion, 5);
  assert.equal(v5.revision, '0');
  assert.equal(v5.worktrees[0].source, 'plugin');
  assert.equal(v5.worktrees[1].source, 'external');
  assert.equal(v5.worktrees[2].diskCleanup, 'completed');
  assert.deepEqual(v5.bindings, v2.bindings);

  const revalidated = validateSidecarSnapshot(v5, '/tmp/ws.json', undefined, 5);
  assert.deepEqual(revalidated, v5);
});

// ---------------------------------------------------------------------------
// 3. v3 -> v4, v5
// ---------------------------------------------------------------------------

test('migration v3 -> v4: preserves revision, converts transitional repository, marks removed as cleaned', () => {
  const v3 = createV3Fixture();
  const v4 = validateSidecarSnapshot(v3, '/tmp/ws.json', undefined, 4);

  assert.equal(v4.schemaVersion, 4);
  assert.equal(v4.revision, '42');
  assert.equal(v4.repositoryFingerprint, v3.repositoryFingerprint);
  assert.equal(v4.worktrees[0].status, 'active');
  assert.equal(v4.worktrees[0].diskCleanup, undefined);
  assert.equal(v4.worktrees[1].status, 'removed');
  assert.equal(v4.worktrees[1].diskCleanup, 'completed');
  assert.deepEqual(v4.bindings, v3.bindings);
  assert.deepEqual(v4.pendingOperation, v3.pendingOperation);
  assert.deepEqual(v4.recoveryIssues, v3.recoveryIssues);

  const revalidated = validateSidecarSnapshot(v4, '/tmp/ws.json', undefined, 4);
  assert.deepEqual(revalidated, v4);
});

test('migration v3 -> v4 with transitional raw repository: computes repositoryFingerprint', () => {
  const identity = { topLevel: '/tmp/repo', commonDirectory: '/tmp/repo/.git' };
  const v3WithTransitional = {
    schemaVersion: 3,
    workspaceId: 'ws_mig',
    revision: '7',
    repository: identity,
    worktrees: [
      {
        workspaceId: 'ws_mig',
        worktreeId: 'wt_trans',
        absolutePath: '/tmp/repo/worktrees/wt_trans',
        branch: 'feature/trans',
        source: 'plugin',
        status: 'active',
      },
    ],
    bindings: [],
  };

  const v4 = validateSidecarSnapshot(v3WithTransitional, '/tmp/ws.json', undefined, 4);
  assert.equal(v4.schemaVersion, 4);
  assert.equal(v4.revision, '7');
  assert.equal(v4.repositoryFingerprint, createRepositoryFingerprint(identity));
  assert.equal('repository' in v4, false);
});

test('migration v3 -> v5: migrates v3 to v5 preserving revision, fingerprint, pendingOperation, and recoveryIssues', () => {
  const v3 = createV3Fixture();
  const v5 = validateSidecarSnapshot(v3, '/tmp/ws.json', undefined, 5);

  assert.equal(v5.schemaVersion, 5);
  assert.equal(v5.revision, '42');
  assert.equal(v5.repositoryFingerprint, v3.repositoryFingerprint);
  assert.equal(v5.worktrees[1].diskCleanup, 'completed');
  assert.deepEqual(v5.bindings, v3.bindings);
  assert.deepEqual(v5.pendingOperation, v3.pendingOperation);
  assert.deepEqual(v5.recoveryIssues, v3.recoveryIssues);

  const revalidated = validateSidecarSnapshot(v5, '/tmp/ws.json', undefined, 5);
  assert.deepEqual(revalidated, v5);
});

// ---------------------------------------------------------------------------
// 4. v4 -> v5
// ---------------------------------------------------------------------------

test('migration v4 -> v5: preserves all acquisition metadata and archived active bindings', () => {
  const v4 = createV4Fixture();
  const v5 = validateSidecarSnapshot(v4, '/tmp/ws.json', undefined, 5);

  assert.equal(v5.schemaVersion, 5);
  assert.equal(v5.revision, '99');
  assert.equal(v5.repositoryFingerprint, v4.repositoryFingerprint);

  // Verify acquisition metadata is preserved intact
  assert.equal(v5.worktrees[0].instructions, 'pnpm test before commit');
  assert.equal(v5.worktrees[0].baseBranch, 'main');
  assert.equal(v5.worktrees[0].createdAt, '2026-09-10T12:00:00.000Z');

  // Verify archived worktree without diskCleanup retains its active binding
  assert.equal(v5.worktrees[1].status, 'removed');
  assert.equal(v5.worktrees[1].importedAt, '2026-09-10T13:00:00.000Z');
  assert.equal(v5.worktrees[1].diskCleanup, undefined);
  assert.equal(v5.bindings[1].worktreeId, 'wt_v4_archived');
  assert.equal(v5.bindings[1].status, 'active');

  // Cleaned worktree preserves diskCleanup: completed
  assert.equal(v5.worktrees[2].diskCleanup, 'completed');

  // Pending operation and recovery issues preserved
  assert.deepEqual(v5.pendingOperation, v4.pendingOperation);
  assert.deepEqual(v5.recoveryIssues, v4.recoveryIssues);

  const revalidated = validateSidecarSnapshot(v5, '/tmp/ws.json', undefined, 5);
  assert.deepEqual(revalidated, v5);
});

// ---------------------------------------------------------------------------
// 5. Transitive migration equivalence (stepwise vs direct)
// ---------------------------------------------------------------------------

test('transitive migration equivalence: v1 -> v2 -> v3 -> v4 -> v5 equals direct v1 -> v5', () => {
  const v1 = createV1Fixture();
  const directV5 = validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, 5);

  const stepV2 = validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, 2);
  const stepV3 = validateSidecarSnapshot(stepV2, '/tmp/ws.json', undefined, 3);
  const stepV4 = validateSidecarSnapshot(stepV3, '/tmp/ws.json', undefined, 4);
  const stepV5 = validateSidecarSnapshot(stepV4, '/tmp/ws.json', undefined, 5);

  assert.deepEqual(stepV5, directV5);
});

test('transitive migration equivalence: v2 -> v3 -> v4 -> v5 equals direct v2 -> v5', () => {
  const v2 = createV2Fixture();
  const directV5 = validateSidecarSnapshot(v2, '/tmp/ws.json', undefined, 5);

  const stepV3 = validateSidecarSnapshot(v2, '/tmp/ws.json', undefined, 3);
  const stepV4 = validateSidecarSnapshot(stepV3, '/tmp/ws.json', undefined, 4);
  const stepV5 = validateSidecarSnapshot(stepV4, '/tmp/ws.json', undefined, 5);

  assert.deepEqual(stepV5, directV5);
});

test('transitive migration equivalence: v3 -> v4 -> v5 equals direct v3 -> v5', () => {
  const v3 = createV3Fixture();
  const directV5 = validateSidecarSnapshot(v3, '/tmp/ws.json', undefined, 5);

  const stepV4 = validateSidecarSnapshot(v3, '/tmp/ws.json', undefined, 4);
  const stepV5 = validateSidecarSnapshot(stepV4, '/tmp/ws.json', undefined, 5);

  assert.deepEqual(stepV5, directV5);
});

// ---------------------------------------------------------------------------
// 6. Downgrade and unsupported version rejections
// ---------------------------------------------------------------------------

test('rejects downgrading schema version', () => {
  const v5 = validateSidecarSnapshot(createV4Fixture(), '/tmp/ws.json', undefined, 5);
  for (const target of [4, 3, 2, 1]) {
    assert.throws(
      () => validateSidecarSnapshot(v5, '/tmp/ws.json', undefined, target),
      { code: 'SIDECAR_CORRUPT' },
    );
  }

  const v4 = createV4Fixture();
  for (const target of [3, 2, 1]) {
    assert.throws(
      () => validateSidecarSnapshot(v4, '/tmp/ws.json', undefined, target),
      { code: 'SIDECAR_CORRUPT' },
    );
  }

  const v3 = createV3Fixture();
  for (const target of [2, 1]) {
    assert.throws(
      () => validateSidecarSnapshot(v3, '/tmp/ws.json', undefined, target),
      { code: 'SIDECAR_CORRUPT' },
    );
  }

  const v2 = createV2Fixture();
  assert.throws(
    () => validateSidecarSnapshot(v2, '/tmp/ws.json', undefined, 1),
    { code: 'SIDECAR_CORRUPT' },
  );
});

test('rejects unsupported target versions', () => {
  const v1 = createV1Fixture();
  for (const invalidTarget of [0, 6, -1, 99]) {
    assert.throws(
      () => validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, invalidTarget),
      { code: 'SIDECAR_CORRUPT' },
    );
  }
});

// ---------------------------------------------------------------------------
// 7. WorkspaceShardedSidecarRepository integration with legacy shard files
// ---------------------------------------------------------------------------

test('WorkspaceShardedSidecarRepository migrates legacy shards (v1, v2, v3, v4) on disk upon read and mutation', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'sidecar-migration-repo-'));
  try {
    const repository = new WorkspaceShardedSidecarRepository({ dshHome: tempDir });

    // Test each legacy version on disk
    const worktreeRoot = path.join(tempDir, 'clutch-dsh-worktree', 'worktree');
    function adjustPaths(fixture) {
      return {
        ...fixture,
        worktrees: fixture.worktrees.map((w) => ({
          ...w,
          absolutePath: path.join(worktreeRoot, w.worktreeId),
        })),
        ...(fixture.pendingOperation ? {
          pendingOperation: {
            ...fixture.pendingOperation,
            targetPath: path.join(worktreeRoot, fixture.pendingOperation.worktreeId),
          },
        } : {}),
      };
    }

    const legacyVersions = [
      { version: 1, fixture: adjustPaths(createV1Fixture('ws_disk_v1')) },
      { version: 2, fixture: adjustPaths(createV2Fixture('ws_disk_v2')) },
      { version: 3, fixture: adjustPaths({ ...createV3Fixture('ws_disk_v3'), pendingOperation: undefined, recoveryIssues: undefined }) },
      { version: 4, fixture: adjustPaths({ ...createV4Fixture('ws_disk_v4'), pendingOperation: undefined, recoveryIssues: undefined }) },
    ];

    for (const { version, fixture } of legacyVersions) {
      const shardPath = repository.getShardPath(fixture.workspaceId);
      await mkdir(path.dirname(shardPath), { recursive: true });
      await writeFile(shardPath, JSON.stringify(fixture, null, 2), 'utf8');

      // 1. Read normalizes to v5 in memory without corrupting on-disk raw data before mutation
      const readSnapshot = await repository.read(fixture.workspaceId);
      assert.equal(readSnapshot.schemaVersion, SIDECAR_SCHEMA_VERSION);
      assert.equal(readSnapshot.workspaceId, fixture.workspaceId);

      // On-disk file is still the original version until first mutation
      const rawBeforeMutation = JSON.parse(await readFile(shardPath, 'utf8'));
      assert.equal(rawBeforeMutation.schemaVersion, version);

      // 2. First mutation triggers migration write to v5
      await repository.upsertWorktree({
        workspaceId: fixture.workspaceId,
        worktreeId: `wt_new_${version}`,
        absolutePath: path.join(worktreeRoot, `wt_new_${version}`),
        branch: `feature/new-${version}`,
        source: 'plugin',
        status: 'active',
      });

      // Shard on disk is now migrated to v5 with incremented revision
      const rawAfterMutation = JSON.parse(await readFile(shardPath, 'utf8'));
      assert.equal(rawAfterMutation.schemaVersion, SIDECAR_SCHEMA_VERSION);
      assert.equal(typeof rawAfterMutation.revision, 'string');
      assert.ok(rawAfterMutation.worktrees.some((w) => w.worktreeId === `wt_new_${version}`));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
