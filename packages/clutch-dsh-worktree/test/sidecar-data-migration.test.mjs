/* global structuredClone */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SIDECAR_SCHEMA_VERSION,
  SUPPORTED_SIDECAR_SCHEMA_VERSIONS,
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
 * - v6: Added top-level Workspace-root 'mainInstructions'
 * - v7: Separates nested Workspace 'absolutePath' from 'gitRootPath', with journal 'workspacePath'
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

function createV5Fixture(workspaceId = 'ws_mig') {
  const fixture = createV4Fixture(workspaceId);
  return {
    ...fixture,
    schemaVersion: 5,
    worktrees: fixture.worktrees.map((record, index) => ({
      ...record,
      baseCommit: index === 1 ? 'b'.repeat(64) : 'a'.repeat(40),
    })),
    pendingOperation: {
      id: 'op_v5_create', type: 'create-worktree', phase: 'recovery-needed',
      workspaceId, worktreeId: 'wt_v5_pending',
      targetPath: '/tmp/repo/worktrees/wt_v5_pending',
      branch: 'feature/v5-pending', baseRef: 'main', baseCommit: 'c'.repeat(40),
      repositoryFingerprint: fixture.repositoryFingerprint,
      startedAt: '2026-09-11T00:00:00.000Z',
    },
  };
}

function createV6Fixture(workspaceId = 'ws_mig') {
  return {
    ...createV5Fixture(workspaceId),
    schemaVersion: 6,
    mainInstructions: 'Main 指令：保留原始 Workspace；run pnpm test.\nSecond line.',
  };
}

// Raw historical fixtures, never produced by the migration implementation under test.
const LEGACY_MIGRATION_CASES = [
  { version: 1, createFixture: createV1Fixture },
  { version: 2, createFixture: createV2Fixture },
  { version: 3, createFixture: createV3Fixture },
  { version: 4, createFixture: createV4Fixture },
  { version: 5, createFixture: createV5Fixture },
  { version: 6, createFixture: createV6Fixture },
];

// Independent expected shapes: only source, revision, and legacy cleanup are synthesized.
function expectedMigratedSnapshot(fixture, targetVersion = 7) {
  return {
    ...structuredClone(fixture),
    schemaVersion: targetVersion,
    ...(targetVersion >= 3 ? { revision: fixture.revision ?? '0' } : {}),
    worktrees: fixture.worktrees.map((record) => ({
      ...record,
      source: record.source ?? 'plugin',
      ...(targetVersion >= 4 && fixture.schemaVersion < 4 && record.status === 'removed'
        ? { diskCleanup: 'completed' }
        : {}),
    })),
  };
}

for (const { version, createFixture } of LEGACY_MIGRATION_CASES) {
  test(`migration v${version} -> v7 preserves historical fields, bindings, journals, and legacy paths`, () => {
    const fixture = createFixture();
    const before = structuredClone(fixture);
    const expected = expectedMigratedSnapshot(fixture);
    const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);
    assert.deepEqual(migrated, expected);
    assert.deepEqual(validateSidecarSnapshot(fixture, '/tmp/ws.json'), expected);
    assert.deepEqual(migrateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7), expected);
    assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json'), expected);
    assert.deepEqual(fixture, before, 'migration must not mutate the input');
    for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'gitRootPath'), false);
    if (migrated.pendingOperation) assert.equal(Object.hasOwn(migrated.pendingOperation, 'workspacePath'), false);
  });

  test(`migration v${version} -> v7 matches sequential upgrades through every intermediate version`, () => {
    const fixture = createFixture();
    let sequential = fixture;
    for (let targetVersion = version + 1; targetVersion <= 7; targetVersion++) {
      sequential = migrateSidecarSnapshot(sequential, '/tmp/ws.json', undefined, targetVersion);
    }
    assert.deepEqual(sequential, expectedMigratedSnapshot(fixture));
  });
}

test('migration v3 -> v7 normalizes transitional repository identities without losing the pending journal', () => {
  const fixture = createV3Fixture();
  const identity = { topLevel: '/tmp/repo', commonDirectory: '/tmp/repo/.git' };
  const legacySnapshot = { ...fixture };
  delete legacySnapshot.repositoryFingerprint;
  const legacyPending = { ...fixture.pendingOperation };
  delete legacyPending.repositoryFingerprint;
  const transitional = {
    ...legacySnapshot,
    repository: identity,
    pendingOperation: { ...legacyPending, repository: identity },
  };
  const before = structuredClone(transitional);
  const expected = {
    ...expectedMigratedSnapshot(fixture),
    repositoryFingerprint: createRepositoryFingerprint(identity),
    pendingOperation: { ...legacyPending, repositoryFingerprint: createRepositoryFingerprint(identity) },
  };
  assert.deepEqual(migrateSidecarSnapshot(transitional, '/tmp/ws.json', undefined, 7), expected);
  assert.deepEqual(transitional, before);
});

test('migration v6 -> v7 distinguishes disabled Main instructions from an absent field', () => {
  for (const mainInstructions of ['', undefined]) {
    const fixture = createV6Fixture();
    if (mainInstructions === undefined) delete fixture.mainInstructions;
    else fixture.mainInstructions = mainInstructions;
    const migrated = migrateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);
    assert.deepEqual(migrated, expectedMigratedSnapshot(fixture));
    assert.equal(Object.hasOwn(migrated, 'mainInstructions'), mainInstructions !== undefined);
  }
});

// ---------------------------------------------------------------------------
// 1. v1 -> v2, v3, v4, v5, v6, v7
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

test('migration v1 -> v5: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV1Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 5);

  assert.equal(migrated.schemaVersion, 5);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '0');
  assert.equal(migrated.worktrees[0].source, 'plugin');
  assert.equal(migrated.worktrees[1].source, 'plugin');
  assert.equal(migrated.worktrees[0].diskCleanup, undefined);
  assert.equal(migrated.worktrees[1].diskCleanup, 'completed');
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'baseCommit'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 5));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 5), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

test('migration v1 -> v6: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV1Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 6);

  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '0');
  assert.equal(migrated.worktrees[0].source, 'plugin');
  assert.equal(migrated.worktrees[1].source, 'plugin');
  assert.equal(migrated.worktrees[0].diskCleanup, undefined);
  assert.equal(migrated.worktrees[1].diskCleanup, 'completed');
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'baseCommit'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 6));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 6), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

test('migration v1 -> v7: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV1Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);

  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '0');
  assert.equal(migrated.worktrees[0].source, 'plugin');
  assert.equal(migrated.worktrees[1].source, 'plugin');
  assert.equal(migrated.worktrees[0].diskCleanup, undefined);
  assert.equal(migrated.worktrees[1].diskCleanup, 'completed');
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'baseCommit'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 7));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 7), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

test('keeps every supported schema version readable when the current version advances', () => {
  // The list is explicit instead of tracking the live constant.
  assert.deepEqual(SUPPORTED_SIDECAR_SCHEMA_VERSIONS, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(SUPPORTED_SIDECAR_SCHEMA_VERSIONS.includes(SIDECAR_SCHEMA_VERSION), true);
  assert.equal(SUPPORTED_SIDECAR_SCHEMA_VERSIONS.at(-1), SIDECAR_SCHEMA_VERSION);

  const v5Record = {
    schemaVersion: 5,
    workspaceId: 'ws_mig',
    revision: '0',
    worktrees: [{
      worktreeId: 'wt_mig',
      workspaceId: 'ws_mig',
      absolutePath: '/tmp/generated/wt_mig',
      branch: 'feature/v5',
      baseBranch: 'main',
      baseCommit: 'a'.repeat(40),
      createdAt: '2026-09-01T00:00:00.000Z',
      source: 'plugin',
      status: 'active',
    }],
    bindings: [],
  };
  const revalidated = validateSidecarSnapshot(v5Record, '/tmp/ws.json', undefined, 5);
  assert.equal(revalidated.worktrees[0].baseCommit, 'a'.repeat(40));
  assert.equal(revalidated.schemaVersion, 5);
  const migrated = validateSidecarSnapshot(v5Record, '/tmp/ws.json', undefined, 6);
  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.worktrees[0].baseCommit, 'a'.repeat(40));
  assert.equal(migrated.mainInstructions, undefined);
});

test('v7 captures nested Workspace and Git-root paths and rejects paths outside the checkout', () => {
  const snapshot = {
    schemaVersion: 7, workspaceId: 'ws_nested', revision: '0', bindings: [],
    worktrees: [{
      worktreeId: 'wt_nested', workspaceId: 'ws_nested', branch: 'topic',
      source: 'plugin', status: 'active',
      absolutePath: '/tmp/generated/wt_nested/packages/app',
      gitRootPath: '/tmp/generated/wt_nested',
    }],
  };
  assert.deepEqual(validateSidecarSnapshot(snapshot, '/tmp/ws.json', '/tmp/generated'), snapshot);
  for (const absolutePath of ['/tmp/elsewhere', '/tmp/generated/wt_nested/../other', 'packages/app']) {
    assert.throws(() => validateSidecarSnapshot({
      ...snapshot, worktrees: [{ ...snapshot.worktrees[0], absolutePath }],
    }, '/tmp/ws.json', '/tmp/generated'), { code: 'SIDECAR_CORRUPT' });
  }
  assert.throws(() => validateSidecarSnapshot({ ...snapshot, schemaVersion: 6 }, '/tmp/ws.json'), { code: 'SIDECAR_CORRUPT' });
});

test('v6 preserves Main instructions and rejects the field in v5 or malformed snapshots', () => {
  const v5 = validateSidecarSnapshot(createV1Fixture(), '/tmp/ws.json', undefined, 5);
  assert.equal(v5.mainInstructions, undefined);
  const v6 = validateSidecarSnapshot(
    { ...v5, schemaVersion: 6, mainInstructions: 'Use the Workspace root context.' },
    '/tmp/ws.json',
    undefined,
    6,
  );
  assert.equal(v6.mainInstructions, 'Use the Workspace root context.');
  assert.equal(
    validateSidecarSnapshot({ ...v5, schemaVersion: 6 }, '/tmp/ws.json', undefined, 6).mainInstructions,
    undefined,
  );

  assert.throws(
    () => validateSidecarSnapshot({ ...v5, mainInstructions: 'legacy field' }, '/tmp/ws.json', undefined, 6),
    { code: 'SIDECAR_CORRUPT' },
  );
  for (const mainInstructions of [42, {}, 'x'.repeat(32_001)]) {
    assert.throws(
      () => validateSidecarSnapshot({ ...v6, mainInstructions }, '/tmp/ws.json', undefined, 6),
      { code: 'SIDECAR_CORRUPT' },
    );
  }
  assert.throws(
    () => validateSidecarSnapshot({ ...v6, unknownField: true }, '/tmp/ws.json', undefined, 6),
    { code: 'SIDECAR_CORRUPT' },
  );
});

test('migration v1 -> current: migrates legacy v1 directly to the current schema', () => {
  const v1 = createV1Fixture();
  const v5 = validateSidecarSnapshot(v1, '/tmp/ws.json');

  assert.equal(v5.schemaVersion, SIDECAR_SCHEMA_VERSION);
  assert.equal(v5.workspaceId, 'ws_mig');
  assert.equal(v5.revision, '0');
  assert.equal(v5.worktrees[0].source, 'plugin');
  assert.equal(v5.worktrees[1].diskCleanup, 'completed');
  assert.deepEqual(v5.bindings, v1.bindings);

  // migrateSidecarSnapshot helper behaves identically and shares the
  // validateSidecarSnapshot parameter order.
  const migratedViaHelper = migrateSidecarSnapshot(v1, '/tmp/ws.json');
  assert.deepEqual(migratedViaHelper, v5);

  // Default targetVersion is the current schema.
  const defaultMigrated = validateSidecarSnapshot(v1, '/tmp/ws.json');
  assert.deepEqual(defaultMigrated, v5);
});

// ---------------------------------------------------------------------------
// 2. v2 -> v3, v4, v5, v6, v7
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
  const migratedToV6 = validateSidecarSnapshot(v5, '/tmp/ws.json', undefined, 6);
  assert.equal(migratedToV6.schemaVersion, 6);
  assert.equal(migratedToV6.mainInstructions, undefined);
  assert.equal(migratedToV6.worktrees[0].baseCommit, v5.worktrees[0].baseCommit);
});

test('migration v2 -> v6: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV2Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 6);

  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '0');
  assert.equal(migrated.worktrees[0].source, 'plugin');
  assert.equal(migrated.worktrees[1].source, 'external');
  assert.equal(migrated.worktrees[2].diskCleanup, 'completed');
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'baseCommit'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 6));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 6), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

test('migration v2 -> v7: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV2Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);

  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '0');
  assert.equal(migrated.worktrees[0].source, 'plugin');
  assert.equal(migrated.worktrees[1].source, 'external');
  assert.equal(migrated.worktrees[2].diskCleanup, 'completed');
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'baseCommit'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 7));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 7), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

// ---------------------------------------------------------------------------
// 3. v3 -> v4, v5, v6, v7
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

test('migration v3 -> v6: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV3Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 6);

  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '42');
  assert.equal(migrated.repositoryFingerprint, fixture.repositoryFingerprint);
  assert.equal(migrated.worktrees[0].source, 'external');
  assert.equal(migrated.worktrees[1].diskCleanup, 'completed');
  assert.deepEqual(migrated.pendingOperation, fixture.pendingOperation);
  assert.deepEqual(migrated.recoveryIssues, fixture.recoveryIssues);
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 6));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 6), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

test('migration v3 -> v7: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV3Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);

  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '42');
  assert.equal(migrated.repositoryFingerprint, fixture.repositoryFingerprint);
  assert.equal(migrated.worktrees[0].source, 'external');
  assert.equal(migrated.worktrees[1].diskCleanup, 'completed');
  assert.deepEqual(migrated.pendingOperation, fixture.pendingOperation);
  assert.deepEqual(migrated.recoveryIssues, fixture.recoveryIssues);
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 7));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 7), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

// ---------------------------------------------------------------------------
// 4. v4 -> v5, v6, v7
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

test('migration v4 -> v6: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV4Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 6);

  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '99');
  assert.equal(migrated.repositoryFingerprint, fixture.repositoryFingerprint);
  assert.deepEqual(migrated.worktrees, fixture.worktrees);
  assert.equal(migrated.worktrees[0].instructions, 'pnpm test before commit');
  assert.equal(migrated.worktrees[0].baseBranch, 'main');
  assert.equal(migrated.worktrees[0].createdAt, '2026-09-10T12:00:00.000Z');
  assert.equal(migrated.worktrees[1].importedAt, '2026-09-10T13:00:00.000Z');
  assert.equal(migrated.worktrees[1].diskCleanup, undefined);
  assert.equal(migrated.bindings[1].status, 'active');
  assert.equal(migrated.worktrees[2].diskCleanup, 'completed');
  assert.deepEqual(migrated.pendingOperation, fixture.pendingOperation);
  assert.deepEqual(migrated.recoveryIssues, fixture.recoveryIssues);
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'baseCommit'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 6));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 6), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

test('migration v4 -> v7: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV4Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);

  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '99');
  assert.equal(migrated.repositoryFingerprint, fixture.repositoryFingerprint);
  assert.deepEqual(migrated.worktrees, fixture.worktrees);
  assert.equal(migrated.worktrees[0].instructions, 'pnpm test before commit');
  assert.equal(migrated.worktrees[0].baseBranch, 'main');
  assert.equal(migrated.worktrees[0].createdAt, '2026-09-10T12:00:00.000Z');
  assert.equal(migrated.worktrees[1].importedAt, '2026-09-10T13:00:00.000Z');
  assert.equal(migrated.worktrees[1].diskCleanup, undefined);
  assert.equal(migrated.bindings[1].status, 'active');
  assert.equal(migrated.worktrees[2].diskCleanup, 'completed');
  assert.deepEqual(migrated.pendingOperation, fixture.pendingOperation);
  assert.deepEqual(migrated.recoveryIssues, fixture.recoveryIssues);
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'baseCommit'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 7));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 7), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

// ---------------------------------------------------------------------------
// 5. v5 -> v6, v7
// ---------------------------------------------------------------------------

test('migration v5 -> v6: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV5Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 6);

  assert.equal(migrated.schemaVersion, 6);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '99');
  assert.equal(migrated.repositoryFingerprint, fixture.repositoryFingerprint);
  assert.deepEqual(migrated.worktrees, fixture.worktrees);
  assert.equal(migrated.worktrees[0].baseCommit, 'a'.repeat(40));
  assert.equal(migrated.worktrees[1].baseCommit, 'b'.repeat(64));
  assert.equal(migrated.bindings[1].status, 'active');
  assert.deepEqual(migrated.pendingOperation, fixture.pendingOperation);
  assert.equal(migrated.pendingOperation.baseCommit, 'c'.repeat(40));
  assert.deepEqual(migrated.recoveryIssues, fixture.recoveryIssues);
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 6));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 6), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

test('migration v5 -> v7: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV5Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);

  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '99');
  assert.equal(migrated.repositoryFingerprint, fixture.repositoryFingerprint);
  assert.deepEqual(migrated.worktrees, fixture.worktrees);
  assert.equal(migrated.worktrees[0].baseCommit, 'a'.repeat(40));
  assert.equal(migrated.worktrees[1].baseCommit, 'b'.repeat(64));
  assert.equal(migrated.bindings[1].status, 'active');
  assert.deepEqual(migrated.pendingOperation, fixture.pendingOperation);
  assert.equal(migrated.pendingOperation.baseCommit, 'c'.repeat(40));
  assert.deepEqual(migrated.recoveryIssues, fixture.recoveryIssues);
  assert.equal(Object.hasOwn(migrated, 'mainInstructions'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 7));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 7), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

// ---------------------------------------------------------------------------
// 6. v6 -> v7
// ---------------------------------------------------------------------------

test('migration v6 -> v7: preserves historical snapshot fields without inventing new metadata', () => {
  const fixture = createV6Fixture();
  const before = structuredClone(fixture);
  const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, 7);

  assert.equal(migrated.schemaVersion, 7);
  assert.equal(migrated.workspaceId, 'ws_mig');
  assert.equal(migrated.revision, '99');
  assert.equal(migrated.repositoryFingerprint, fixture.repositoryFingerprint);
  assert.equal(migrated.mainInstructions, fixture.mainInstructions);
  assert.deepEqual(migrated.worktrees, fixture.worktrees);
  assert.equal(migrated.worktrees[0].baseCommit, 'a'.repeat(40));
  assert.equal(migrated.worktrees[1].baseCommit, 'b'.repeat(64));
  assert.equal(migrated.bindings[1].status, 'active');
  assert.deepEqual(migrated.pendingOperation, fixture.pendingOperation);
  assert.equal(migrated.pendingOperation.baseCommit, 'c'.repeat(40));
  assert.deepEqual(migrated.recoveryIssues, fixture.recoveryIssues);
  for (const record of migrated.worktrees) assert.equal(Object.hasOwn(record, 'gitRootPath'), false);
  assert.equal(Object.hasOwn(migrated.pendingOperation, 'workspacePath'), false);
  assert.deepEqual(migrated.bindings, fixture.bindings);
  assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, 7));
  assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, 7), migrated);
  assert.deepEqual(fixture, before, 'migration must not mutate the input');
});

// ---------------------------------------------------------------------------
// 7. Transitive migration equivalence (stepwise vs direct historical targets)
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

for (const { version, createFixture } of LEGACY_MIGRATION_CASES) {
  for (const targetVersion of [6, 7]) {
    if (targetVersion <= version + 1) continue;
    const chain = Array.from({ length: targetVersion - version + 1 }, (_, index) => `v${version + index}`);
    test(`transitive migration equivalence: ${chain.join(' -> ')} equals direct v${version} -> v${targetVersion}`, () => {
      const fixture = createFixture();
      const before = structuredClone(fixture);
      const direct = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, targetVersion);
      let stepwise = fixture;
      for (let nextVersion = version + 1; nextVersion <= targetVersion; nextVersion++) {
        stepwise = validateSidecarSnapshot(stepwise, '/tmp/ws.json', undefined, nextVersion);
      }

      assert.equal(stepwise.schemaVersion, targetVersion);
      assert.deepEqual(stepwise, direct);
      assert.deepEqual(direct, expectedMigratedSnapshot(fixture, targetVersion));
      assert.deepEqual(fixture, before, 'stepwise and direct migrations must not mutate the input');
    });
  }
}

// ---------------------------------------------------------------------------
// 8. All-pairs migration matrix (all 21 combinations with 1 <= from < to <= 7)
// ---------------------------------------------------------------------------

for (const { version: fromVersion, createFixture } of LEGACY_MIGRATION_CASES) {
  for (let toVersion = fromVersion + 1; toVersion <= 7; toVersion++) {
    test(`all-pairs migration matrix: v${fromVersion} -> v${toVersion} validates the exact target shape without mutating input`, () => {
      const fixture = createFixture();
      const before = structuredClone(fixture);
      const migrated = validateSidecarSnapshot(fixture, '/tmp/ws.json', undefined, toVersion);

      assert.equal(migrated.schemaVersion, toVersion);
      assert.equal(migrated.workspaceId, fixture.workspaceId);
      assert.deepEqual(migrated, expectedMigratedSnapshot(fixture, toVersion));
      assert.deepEqual(validateSidecarSnapshot(migrated, '/tmp/ws.json', undefined, toVersion), migrated);
      assert.deepEqual(fixture, before, 'migration must not mutate the input');
    });
  }
}

// ---------------------------------------------------------------------------
// 9. Downgrade and unsupported version rejections
// ---------------------------------------------------------------------------

test('rejects downgrading schema version', () => {
  const v7 = validateSidecarSnapshot(createV6Fixture(), '/tmp/ws.json', undefined, 7);
  for (const target of [6, 5, 4, 3, 2, 1]) {
    assert.throws(
      () => validateSidecarSnapshot(v7, '/tmp/ws.json', undefined, target),
      { code: 'SIDECAR_CORRUPT' },
    );
  }

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
  for (const invalidTarget of [0, SIDECAR_SCHEMA_VERSION + 1, -1, 99]) {
    assert.throws(
      () => validateSidecarSnapshot(v1, '/tmp/ws.json', undefined, invalidTarget),
      { code: 'SIDECAR_CORRUPT' },
    );
  }
});

// ---------------------------------------------------------------------------
// 10. WorkspaceShardedSidecarRepository integration with legacy shard files
// ---------------------------------------------------------------------------

function withGeneratedPaths(fixture, worktreeRoot) {
  return {
    ...fixture,
    worktrees: fixture.worktrees.map((record) => ({
      ...record, absolutePath: path.join(worktreeRoot, record.worktreeId),
    })),
    ...(fixture.pendingOperation ? {
      pendingOperation: {
        ...fixture.pendingOperation,
        targetPath: path.join(worktreeRoot, fixture.pendingOperation.worktreeId),
      },
    } : {}),
  };
}

for (const { version, createFixture } of LEGACY_MIGRATION_CASES) {
  test(`disk migration v${version} -> v7 leaves reads untouched and durably preserves historical data on first write`, async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), `sidecar-migration-v${version}-`));
    try {
      const repository = new WorkspaceShardedSidecarRepository({ dshHome: tempDir });
      const worktreeRoot = path.join(tempDir, 'clutch-dsh-worktree', 'worktree');
      const readyFixture = { ...createFixture(`ws_disk_v${version}`) };
      delete readyFixture.pendingOperation;
      delete readyFixture.recoveryIssues;
      const fixture = withGeneratedPaths(readyFixture, worktreeRoot);
      const expected = expectedMigratedSnapshot(fixture);
      const shardPath = repository.getShardPath(fixture.workspaceId);
      const originalText = JSON.stringify(fixture, null, 2);
      await mkdir(path.dirname(shardPath), { recursive: true });
      await writeFile(shardPath, originalText, 'utf8');

      assert.deepEqual(await repository.read(fixture.workspaceId), expected);
      assert.equal(await readFile(shardPath, 'utf8'), originalText);
      await assert.rejects(repository.mutate(fixture.workspaceId, (snapshot) => ({
        result: undefined, snapshot: { ...snapshot, workspaceId: 'wrong_workspace' },
      })), { code: 'SIDECAR_CORRUPT' });
      assert.equal(await readFile(shardPath, 'utf8'), originalText, 'failed writes must not upgrade the shard');

      const added = {
        workspaceId: fixture.workspaceId, worktreeId: `wt_new_${version}`,
        absolutePath: path.join(worktreeRoot, `wt_new_${version}`),
        branch: `feature/new-${version}`, source: 'plugin', status: 'active',
      };
      await repository.upsertWorktree(added);
      const written = {
        ...expected, revision: String(BigInt(expected.revision) + 1n),
        worktrees: [added, ...expected.worktrees],
      };
      assert.deepEqual(JSON.parse(await readFile(shardPath, 'utf8')), written);
      const restarted = new WorkspaceShardedSidecarRepository({ dshHome: tempDir });
      assert.deepEqual(await restarted.read(fixture.workspaceId), written);
      const textAfterWrite = await readFile(shardPath, 'utf8');
      await restarted.upsertWorktree(added);
      assert.equal(await readFile(shardPath, 'utf8'), textAfterWrite, 'idempotent writes must not bump revision');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  if (version < 3) continue;
  test(`disk migration v${version} -> v7 preserves recovery blockers and the interrupted operation journal`, async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), `sidecar-recovery-migration-v${version}-`));
    try {
      const repository = new WorkspaceShardedSidecarRepository({ dshHome: tempDir });
      const worktreeRoot = path.join(tempDir, 'clutch-dsh-worktree', 'worktree');
      const fixture = withGeneratedPaths(createFixture(`ws_pending_v${version}`), worktreeRoot);
      const expected = expectedMigratedSnapshot(fixture);
      const shardPath = repository.getShardPath(fixture.workspaceId);
      const originalText = JSON.stringify(fixture, null, 2);
      await mkdir(path.dirname(shardPath), { recursive: true });
      await writeFile(shardPath, originalText, 'utf8');

      assert.deepEqual(await repository.read(fixture.workspaceId), expected);
      await assert.rejects(repository.mutate(fixture.workspaceId, (snapshot) => ({
        result: undefined, snapshot, changed: false,
      })), { code: 'WORKTREE_RECOVERY_REQUIRED' });
      assert.equal(await readFile(shardPath, 'utf8'), originalText);
      // Recovery owns this administrative seam; a format-only write preserves its journal and revision.
      await repository.runExclusive(fixture.workspaceId, (locked) => locked.mutate((snapshot) => ({
        result: undefined, snapshot, changed: false,
      })));
      assert.deepEqual(JSON.parse(await readFile(shardPath, 'utf8')), expected);
      const restarted = new WorkspaceShardedSidecarRepository({ dshHome: tempDir });
      assert.deepEqual(await restarted.read(fixture.workspaceId), expected);
      await assert.rejects(restarted.mutate(fixture.workspaceId, (snapshot) => ({
        result: undefined, snapshot, changed: false,
      })), { code: 'WORKTREE_RECOVERY_REQUIRED' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
}
