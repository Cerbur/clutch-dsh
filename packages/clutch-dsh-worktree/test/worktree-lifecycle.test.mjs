import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSidecarSnapshot } from '../lib/provider/sidecar/sidecar-schema.js';
import { createWorktreeMutationToken } from '../lib/provider/mutation-token.js';

const record = {
  workspaceId: 'ws1',
  worktreeId: 'wt1',
  absolutePath: '/tmp/wt1',
  branch: 'feature/archive',
  source: 'external',
  status: 'removed',
};
const binding = {
  workspaceId: 'ws1',
  worktreeId: 'wt1',
  sessionId: 's1',
  status: 'active',
};

test('v4 accepts archived records with active bindings', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 4,
      workspaceId: 'ws1',
      revision: '0',
      worktrees: [record],
      bindings: [binding],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.bindings[0].status, 'active');
});

test('legacy removed remains cleaned and detached', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 3,
      workspaceId: 'ws1',
      revision: '7',
      worktrees: [record],
      bindings: [{ ...binding, status: 'detached' }],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.revision, '7');
  assert.equal(snapshot.worktrees[0].diskCleanup, 'completed');
  assert.equal(snapshot.bindings[0].status, 'detached');
});

test('cleaned records cannot retain active bindings', () => {
  assert.throws(
    () =>
      validateSidecarSnapshot(
        {
          schemaVersion: 4,
          workspaceId: 'ws1',
          revision: '0',
          worktrees: [{ ...record, diskCleanup: 'completed' }],
          bindings: [binding],
        },
        '/tmp/ws1.json',
      ),
    { code: 'SIDECAR_CORRUPT' },
  );
});

test('v1 source normalizes to plugin', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 1,
      workspaceId: 'ws1',
      worktrees: [{
        workspaceId: 'ws1',
        worktreeId: 'wt_v1',
        absolutePath: '/tmp/wt_v1',
        branch: 'feature/v1',
        status: 'active',
      }],
      bindings: [],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.revision, '0');
  assert.equal(snapshot.worktrees[0].source, 'plugin');
});

test('v2 retains explicit source and defaults revision to 0', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 2,
      workspaceId: 'ws1',
      worktrees: [{
        workspaceId: 'ws1',
        worktreeId: 'wt_v2',
        absolutePath: '/tmp/wt_v2',
        branch: 'feature/v2',
        source: 'external',
        status: 'active',
      }],
      bindings: [],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.revision, '0');
  assert.equal(snapshot.worktrees[0].source, 'external');
});

test('v3 preserves revision and repository fingerprint', () => {
  const fingerprint = 'v1-' + 'a'.repeat(64);
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 3,
      workspaceId: 'ws1',
      revision: '42',
      repositoryFingerprint: fingerprint,
      worktrees: [{
        workspaceId: 'ws1',
        worktreeId: 'wt_v3',
        absolutePath: '/tmp/wt_v3',
        branch: 'feature/v3',
        source: 'external',
        status: 'active',
      }],
      bindings: [],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.schemaVersion, 6);
  assert.equal(snapshot.revision, '42');
  assert.equal(snapshot.repositoryFingerprint, fingerprint);
  assert.equal(snapshot.worktrees[0].diskCleanup, undefined);
});

test('v3 active binding to legacy removed record is rejected as corrupt', () => {
  assert.throws(
    () =>
      validateSidecarSnapshot(
        {
          schemaVersion: 3,
          workspaceId: 'ws1',
          revision: '1',
          worktrees: [record],
          bindings: [binding],
        },
        '/tmp/ws1.json',
      ),
    { code: 'SIDECAR_CORRUPT' },
  );
});

test('v6 stores Main instructions while v5 rejects the new field', () => {
  const base = {
    schemaVersion: 6,
    workspaceId: 'ws1',
    revision: '0',
    mainInstructions: 'Workspace guidance',
    worktrees: [],
    bindings: [],
  };
  assert.equal(validateSidecarSnapshot(base, '/tmp/ws1.json').mainInstructions, 'Workspace guidance');
  assert.throws(
    () => validateSidecarSnapshot({ ...base, schemaVersion: 5 }, '/tmp/ws1.json'),
    { code: 'SIDECAR_CORRUPT' },
  );
});

test('unsupported schema versions are rejected', () => {
  for (const v of [0, 7, 99, -1]) {
    assert.throws(
      () =>
        validateSidecarSnapshot(
          {
            schemaVersion: v,
            workspaceId: 'ws1',
            worktrees: [],
            bindings: [],
          },
          '/tmp/ws1.json',
        ),
      { code: 'SIDECAR_CORRUPT' },
    );
  }
});

test('diskCleanup cannot be placed on active record', () => {
  assert.throws(
    () =>
      validateSidecarSnapshot(
        {
          schemaVersion: 4,
          workspaceId: 'ws1',
          revision: '0',
          worktrees: [{
            ...record,
            status: 'active',
            diskCleanup: 'completed',
          }],
          bindings: [],
        },
        '/tmp/ws1.json',
      ),
    { code: 'SIDECAR_CORRUPT' },
  );
});

test('invalid diskCleanup value is rejected', () => {
  assert.throws(
    () =>
      validateSidecarSnapshot(
        {
          schemaVersion: 4,
          workspaceId: 'ws1',
          revision: '0',
          worktrees: [{
            ...record,
            diskCleanup: 'pending',
          }],
          bindings: [],
        },
        '/tmp/ws1.json',
      ),
    { code: 'SIDECAR_CORRUPT' },
  );
});

test('runtime fields in JSON are rejected as corrupt', () => {
  for (const runtimeField of [{ health: 'ready' }, { activity: { state: 'idle' } }, { mutationToken: 'tok' }]) {
    assert.throws(
      () =>
        validateSidecarSnapshot(
          {
            schemaVersion: 4,
            workspaceId: 'ws1',
            revision: '0',
            worktrees: [{
              ...record,
              ...runtimeField,
            }],
            bindings: [],
          },
          '/tmp/ws1.json',
        ),
      { code: 'SIDECAR_CORRUPT' },
    );
  }
});

test('clean-worktree pending operation is accepted in v4', () => {
  const fingerprint = 'v1-' + 'b'.repeat(64);
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 4,
      workspaceId: 'ws1',
      revision: '5',
      worktrees: [{ ...record, diskCleanup: 'completed' }],
      bindings: [],
      pendingOperation: {
        id: 'op1',
        type: 'clean-worktree',
        phase: 'executing',
        workspaceId: 'ws1',
        worktreeId: 'wt1',
        targetPath: '/tmp/wt1',
        branch: 'feature/archive',
        source: 'external',
        repositoryFingerprint: fingerprint,
        startedAt: '2026-09-06T00:00:00.000Z',
      },
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.pendingOperation?.type, 'clean-worktree');
});

test('baseCommit is strict on create pending operations across schema versions', () => {
  const pendingOperation = {
    id: 'op1',
    type: 'create-worktree',
    phase: 'executing',
    workspaceId: 'ws1',
    worktreeId: 'wt1',
    targetPath: '/tmp/wt1',
    branch: 'feature/wt1',
    baseRef: 'main',
    baseCommit: 'a'.repeat(40),
    repositoryFingerprint: 'v1-' + 'b'.repeat(64),
    startedAt: '2026-09-06T00:00:00.000Z',
  };
  assert.throws(() => validateSidecarSnapshot({
    schemaVersion: 4,
    workspaceId: 'ws1',
    revision: '5',
    worktrees: [],
    bindings: [],
    pendingOperation,
  }, '/tmp/ws1.json'), { code: 'SIDECAR_CORRUPT' });
  const snapshot = validateSidecarSnapshot({
    schemaVersion: 5,
    workspaceId: 'ws1',
    revision: '5',
    worktrees: [],
    bindings: [],
    pendingOperation,
  }, '/tmp/ws1.json');
  assert.equal(snapshot.pendingOperation?.baseCommit, 'a'.repeat(40));
});

test('mutation token changes when diskCleanup or baseCommit changes', () => {
  const snap = { schemaVersion: 5, workspaceId: 'ws1', revision: '1' };
  const tok1 = createWorktreeMutationToken(snap, record);
  const tok2 = createWorktreeMutationToken(snap, { ...record, diskCleanup: 'completed' });
  const tok3 = createWorktreeMutationToken(snap, { ...record, baseCommit: 'a'.repeat(40) });
  assert.notEqual(tok1, tok2);
  assert.notEqual(tok1, tok3);
});

test('validates sidecar v4 worktree records with optional acquisition metadata', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 4,
      workspaceId: 'ws1',
      revision: '1',
      worktrees: [
        {
          ...record,
          createdAt: '2026-09-10T13:00:52.192Z',
          baseBranch: 'main',
          instructions: 'custom instructions',
        },
        {
          ...record,
          worktreeId: 'wt_imported',
          absolutePath: '/tmp/wt_imported',
          source: 'external',
          importedAt: '2026-09-10T18:03:35.694Z',
        },
      ],
      bindings: [],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.worktrees[0].createdAt, '2026-09-10T13:00:52.192Z');
  assert.equal(snapshot.worktrees[0].baseBranch, 'main');
  assert.equal(snapshot.worktrees[0].instructions, 'custom instructions');
  assert.equal(snapshot.worktrees[1].importedAt, '2026-09-10T18:03:35.694Z');
  assert.deepEqual(validateSidecarSnapshot(JSON.parse(JSON.stringify(snapshot)), '/tmp/ws1.json'), snapshot);
});

test('metadata compatibility keeps schema validation strict', () => {
  for (const metadata of [
    { instructions: 1 }, { instructions: 'x'.repeat(32_001) },
    { baseBranch: '' }, { baseBranch: null },
    { baseCommit: 'a'.repeat(40) },
    { createdAt: 'invalid' }, { importedAt: 42 },
    { transcript: 'not allowed' }, { health: 'ready' },
  ]) {
    assert.throws(() => validateSidecarSnapshot({
      schemaVersion: 4, workspaceId: 'ws1', revision: '0',
      worktrees: [{ ...record, ...metadata }], bindings: [],
    }, '/tmp/ws1.json'), { code: 'SIDECAR_CORRUPT' });
  }
  for (const schemaVersion of [1, 2, 3]) {
    const legacyRecord = { ...record };
    delete legacyRecord.source;
    assert.throws(() => validateSidecarSnapshot({
      schemaVersion, workspaceId: 'ws1',
      ...(schemaVersion === 3 ? { revision: '0' } : {}),
      worktrees: [{ ...(schemaVersion === 1 ? legacyRecord : record), createdAt: '2026-09-10T13:00:52.192Z' }],
      bindings: [],
    }, '/tmp/ws1.json'), { code: 'SIDECAR_CORRUPT' });
  }
});

test('v5 accepts a stable acquisition baseCommit and rejects malformed values', () => {
  const snapshot = validateSidecarSnapshot(
    {
      schemaVersion: 5,
      workspaceId: 'ws1',
      revision: '1',
      worktrees: [{ ...record, baseBranch: 'main', baseCommit: 'A'.repeat(40) }],
      bindings: [],
    },
    '/tmp/ws1.json',
  );
  assert.equal(snapshot.worktrees[0].baseCommit, 'A'.repeat(40));
  for (const baseCommit of ['', 'a'.repeat(39), 'g'.repeat(40), 123]) {
    assert.throws(() => validateSidecarSnapshot({
      schemaVersion: 5,
      workspaceId: 'ws1',
      revision: '1',
      worktrees: [{ ...record, baseCommit }],
      bindings: [],
    }, '/tmp/ws1.json'), { code: 'SIDECAR_CORRUPT' });
  }
  const sha256Snapshot = validateSidecarSnapshot({
    schemaVersion: 5,
    workspaceId: 'ws1',
    revision: '1',
    worktrees: [{ ...record, baseCommit: 'B'.repeat(64) }],
    bindings: [],
  }, '/tmp/ws1.json');
  assert.equal(sha256Snapshot.worktrees[0].baseCommit, 'B'.repeat(64));
});
