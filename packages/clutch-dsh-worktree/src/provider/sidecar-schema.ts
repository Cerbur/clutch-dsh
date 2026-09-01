import path from 'node:path';

import type { SessionBinding, WorktreeRecord } from '../contract/index.js';
import { createRepositoryFingerprint } from './repository-fingerprint.js';
import {
  LEGACY_SIDECAR_SCHEMA_VERSION,
  SIDECAR_SCHEMA_VERSION,
  type PendingOperation,
  type RecoveryIssue,
  type RepositoryIdentity,
  type SidecarSnapshot,
  WorktreeProviderError,
  providerError,
} from './types.js';

const LEGACY_WORKTREE_KEYS = ['absolutePath', 'branch', 'status', 'workspaceId', 'worktreeId'];
const WORKTREE_KEYS = ['absolutePath', 'branch', 'source', 'status', 'workspaceId', 'worktreeId'];
const BINDING_KEYS = ['sessionId', 'status', 'workspaceId', 'worktreeId'];
const LEGACY_SNAPSHOT_KEYS = ['bindings', 'schemaVersion', 'workspaceId', 'worktrees'];
const V3_REQUIRED_SNAPSHOT_KEYS = ['bindings', 'revision', 'schemaVersion', 'workspaceId', 'worktrees'];
const V3_OPTIONAL_SNAPSHOT_KEYS = ['pendingOperation', 'recoveryIssues', 'repository', 'repositoryFingerprint'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function hasAllowedKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

export function corrupt(
  pathname: string,
  message: string,
  details: Record<string, string | number> = {},
): WorktreeProviderError {
  return providerError('SIDECAR_CORRUPT', `${message}: ${pathname}`, { path: pathname, ...details });
}

function assertWorktreeRecord(
  value: unknown,
  pathname: string,
  schemaVersion: number,
): asserts value is WorktreeRecord {
  const legacy = schemaVersion === LEGACY_SIDECAR_SCHEMA_VERSION;
  if (
    !isObject(value) ||
    !hasExactKeys(value, legacy ? LEGACY_WORKTREE_KEYS : WORKTREE_KEYS) ||
    typeof value.worktreeId !== 'string' ||
    typeof value.workspaceId !== 'string' ||
    typeof value.absolutePath !== 'string' ||
    !path.isAbsolute(value.absolutePath) ||
    typeof value.branch !== 'string' ||
    (value.status !== 'active' && value.status !== 'removed') ||
    (!legacy && value.source !== 'plugin' && value.source !== 'external')
  ) {
    throw corrupt(pathname, 'invalid Worktree record');
  }
}

function assertBinding(value: unknown, pathname: string): asserts value is SessionBinding {
  if (
    !isObject(value) ||
    !hasExactKeys(value, BINDING_KEYS) ||
    typeof value.workspaceId !== 'string' ||
    typeof value.worktreeId !== 'string' ||
    typeof value.sessionId !== 'string' ||
    (value.status !== 'active' && value.status !== 'detached')
  ) {
    throw corrupt(pathname, 'invalid Session binding');
  }
}

function assertRepositoryIdentity(value: unknown, pathname: string): asserts value is RepositoryIdentity {
  if (
    !isObject(value) ||
    !hasExactKeys(value, ['commonDirectory', 'topLevel']) ||
    typeof value.topLevel !== 'string' ||
    !path.isAbsolute(value.topLevel) ||
    typeof value.commonDirectory !== 'string' ||
    !path.isAbsolute(value.commonDirectory)
  ) {
    throw corrupt(pathname, 'invalid repository identity');
  }
}

function assertPendingOperation(value: unknown, pathname: string): asserts value is PendingOperation {
  if (!isObject(value)) throw corrupt(pathname, 'invalid pending operation');

  const commonKeys = [
    'id',
    'phase',
    'startedAt',
    'targetPath',
    'type',
    'workspaceId',
    'worktreeId',
  ];
  const phaseValid =
    value.phase === 'prepared' ||
    value.phase === 'executing' ||
    value.phase === 'verifying' ||
    value.phase === 'recovery-needed';
  if (
    typeof value.id !== 'string' ||
    value.id.length === 0 ||
    typeof value.workspaceId !== 'string' ||
    typeof value.worktreeId !== 'string' ||
    typeof value.targetPath !== 'string' ||
    !path.isAbsolute(value.targetPath) ||
    typeof value.startedAt !== 'string' ||
    !phaseValid
  ) {
    throw corrupt(pathname, 'invalid pending operation');
  }
  if (value.repository !== undefined) assertRepositoryIdentity(value.repository, pathname);
  if (
    value.repositoryFingerprint !== undefined &&
    (typeof value.repositoryFingerprint !== 'string' || !/^v1-[a-f0-9]{64}$/.test(value.repositoryFingerprint))
  ) {
    throw corrupt(pathname, 'invalid pending repository fingerprint');
  }
  if (value.repository === undefined && value.repositoryFingerprint === undefined) {
    throw corrupt(pathname, 'pending operation has no repository identity');
  }

  if (value.type === 'create-worktree') {
    if (
      !hasAllowedKeys(value, commonKeys, ['baseCommit', 'baseRef', 'branch', 'repository', 'repositoryFingerprint']) ||
      typeof value.branch !== 'string' ||
      (value.baseCommit !== undefined && typeof value.baseCommit !== 'string') ||
      (value.baseRef !== undefined && typeof value.baseRef !== 'string')
    ) {
      throw corrupt(pathname, 'invalid create pending operation');
    }
    return;
  }

  if (value.type === 'remove-worktree') {
    if (
      !hasAllowedKeys(value, [...commonKeys, 'branch', 'source'], ['repository', 'repositoryFingerprint']) ||
      typeof value.branch !== 'string' ||
      (value.source !== 'plugin' && value.source !== 'external')
    ) {
      throw corrupt(pathname, 'invalid remove pending operation');
    }
    return;
  }

  throw corrupt(pathname, 'unknown pending operation type');
}

function normalizePendingOperation(operation: PendingOperation): PendingOperation {
  // A short-lived v3 development build wrote the full repository identity into
  // the journal. Keep accepting that shape, but never carry the raw paths into
  // the current in-memory/write projection once the fingerprint is available.
  const legacyOperation = operation as PendingOperation & {
    readonly repositoryFingerprint?: string;
  };
  const { repository: _repository, ...withoutRepository } = legacyOperation;
  void _repository;
  return {
    ...withoutRepository,
    repositoryFingerprint: legacyOperation.repositoryFingerprint ??
      createRepositoryFingerprint(legacyOperation.repository as RepositoryIdentity),
  } as PendingOperation;
}

function assertRecoveryIssue(value: unknown, pathname: string): asserts value is RecoveryIssue {
  if (
    !isObject(value) ||
    !hasAllowedKeys(value, ['code', 'observedAt'], ['operationId', 'worktreeId']) ||
    (value.code !== 'WORKTREE_RECOVERY_REQUIRED' && value.code !== 'WORKTREE_IDENTITY_CHANGED') ||
    typeof value.observedAt !== 'string' ||
    (value.operationId !== undefined && typeof value.operationId !== 'string') ||
    (value.worktreeId !== undefined && typeof value.worktreeId !== 'string')
  ) {
    throw corrupt(pathname, 'invalid recovery issue');
  }
}

function normalizeWorktreeRecord(record: WorktreeRecord, schemaVersion: number): WorktreeRecord {
  return schemaVersion === LEGACY_SIDECAR_SCHEMA_VERSION
    ? { ...record, source: 'plugin' }
    : record;
}

function assertGeneratedPluginPath(
  record: WorktreeRecord,
  pathname: string,
  generatedWorktreeRoot: string | undefined,
): void {
  if (!generatedWorktreeRoot || record.source !== 'plugin') return;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.worktreeId)) {
    throw corrupt(pathname, 'Worktree record has an invalid generated ID');
  }
  const expectedPath = path.resolve(generatedWorktreeRoot, record.worktreeId);
  if (path.resolve(record.absolutePath) !== expectedPath) {
    throw corrupt(pathname, 'Worktree path is outside the generated DSH Home root');
  }
}

/** Validate v1/v2/v3 on-disk data and return the current in-memory v3 projection. */
export function validateSidecarSnapshot(
  value: unknown,
  pathname: string,
  generatedWorktreeRoot?: string,
): SidecarSnapshot {
  if (!isObject(value) || typeof value.schemaVersion !== 'number' || typeof value.workspaceId !== 'string') {
    throw corrupt(pathname, 'invalid sidecar snapshot');
  }

  const schemaVersion = value.schemaVersion;
  const validShape = schemaVersion === LEGACY_SIDECAR_SCHEMA_VERSION
    ? hasExactKeys(value, LEGACY_SNAPSHOT_KEYS)
    : schemaVersion === 2
      ? hasExactKeys(value, ['bindings', 'schemaVersion', 'workspaceId', 'worktrees'])
      : schemaVersion === SIDECAR_SCHEMA_VERSION &&
        hasAllowedKeys(value, V3_REQUIRED_SNAPSHOT_KEYS, V3_OPTIONAL_SNAPSHOT_KEYS);
  if (!validShape || !Array.isArray(value.worktrees) || !Array.isArray(value.bindings)) {
    throw corrupt(pathname, 'invalid sidecar snapshot');
  }
  if (schemaVersion !== LEGACY_SIDECAR_SCHEMA_VERSION && schemaVersion !== 2 && schemaVersion !== SIDECAR_SCHEMA_VERSION) {
    throw corrupt(pathname, 'unsupported sidecar schema version', { schemaVersion });
  }
  if (
    schemaVersion === SIDECAR_SCHEMA_VERSION &&
    (typeof value.revision !== 'string' || !/^\d+$/.test(value.revision))
  ) {
    throw corrupt(pathname, 'invalid sidecar revision');
  }
  if (
    value.repositoryFingerprint !== undefined &&
    (typeof value.repositoryFingerprint !== 'string' || !/^v1-[a-f0-9]{64}$/.test(value.repositoryFingerprint))
  ) {
    throw corrupt(pathname, 'invalid repository fingerprint');
  }

  for (const record of value.worktrees) assertWorktreeRecord(record, pathname, schemaVersion);
  for (const binding of value.bindings) assertBinding(binding, pathname);
  if (value.repository !== undefined) assertRepositoryIdentity(value.repository, pathname);
  if (value.pendingOperation !== undefined) assertPendingOperation(value.pendingOperation, pathname);
  if (value.recoveryIssues !== undefined) {
    if (!Array.isArray(value.recoveryIssues)) throw corrupt(pathname, 'invalid recovery issues');
    for (const issue of value.recoveryIssues) assertRecoveryIssue(issue, pathname);
  }

  const workspaceId = value.workspaceId;
  const worktrees = value.worktrees.map((record) => normalizeWorktreeRecord(record, schemaVersion));
  const worktreeIds = new Set<string>();
  for (const record of worktrees) {
    if (record.workspaceId !== workspaceId) {
      throw corrupt(pathname, 'Worktree record belongs to another Workspace');
    }
    if (worktreeIds.has(record.worktreeId)) {
      throw corrupt(pathname, 'sidecar contains duplicate Worktree IDs');
    }
    worktreeIds.add(record.worktreeId);
    assertGeneratedPluginPath(record, pathname, generatedWorktreeRoot);
  }
  for (const binding of value.bindings) {
    if (binding.workspaceId !== workspaceId) {
      throw corrupt(pathname, 'Session binding belongs to another Workspace');
    }
  }
  if (value.pendingOperation !== undefined && value.pendingOperation.workspaceId !== workspaceId) {
    throw corrupt(pathname, 'pending operation belongs to another Workspace');
  }

  const activeSessions = new Set<string>();
  for (const binding of value.bindings) {
    if (binding.status !== 'active') continue;
    if (activeSessions.has(binding.sessionId)) {
      throw corrupt(pathname, 'Session has more than one active Worktree binding');
    }
    activeSessions.add(binding.sessionId);
  }

  const worktreeStatus = new Map(worktrees.map((record) => [record.worktreeId, record.status]));
  for (const binding of value.bindings) {
    if (binding.status === 'active' && worktreeStatus.get(binding.worktreeId) !== 'active') {
      throw corrupt(pathname, 'active binding does not point to an active Worktree');
    }
  }

  const pendingOperation = value.pendingOperation === undefined
    ? undefined
    : normalizePendingOperation(value.pendingOperation);
  const repositoryFingerprint = value.repositoryFingerprint ??
    (value.repository === undefined ? undefined : createRepositoryFingerprint(value.repository));

  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    workspaceId,
    revision: schemaVersion === SIDECAR_SCHEMA_VERSION ? value.revision as string : '0',
    ...(repositoryFingerprint !== undefined ? { repositoryFingerprint } : {}),
    worktrees,
    bindings: value.bindings,
    ...(pendingOperation !== undefined ? { pendingOperation } : {}),
    ...(value.recoveryIssues !== undefined ? { recoveryIssues: value.recoveryIssues } : {}),
  };
}

export function emptySnapshot(workspaceId: string): SidecarSnapshot {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    workspaceId,
    revision: '0',
    worktrees: [],
    bindings: [],
  };
}
