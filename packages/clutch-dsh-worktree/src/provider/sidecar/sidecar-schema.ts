import path from 'node:path';

import type { SessionBinding, WorktreeRecord } from '../../contract/index.js';
import { createRepositoryFingerprint } from '../git/repository-fingerprint.js';
import {
  LEGACY_SIDECAR_SCHEMA_VERSION,
  SIDECAR_SCHEMA_VERSION,
  type PendingOperation,
  type RecoveryIssue,
  type RepositoryIdentity,
  type SidecarSnapshot,
  WorktreeProviderError,
  providerError,
} from '../types.js';

const LEGACY_WORKTREE_KEYS = ['absolutePath', 'branch', 'status', 'workspaceId', 'worktreeId'];
const WORKTREE_KEYS = ['absolutePath', 'branch', 'source', 'status', 'workspaceId', 'worktreeId'];
// Preserve known development-build metadata without accepting arbitrary fields.
const V4_OPTIONAL_WORKTREE_KEYS = ['diskCleanup', 'instructions', 'createdAt', 'importedAt', 'baseBranch'];
const V5_OPTIONAL_WORKTREE_KEYS = [...V4_OPTIONAL_WORKTREE_KEYS, 'baseCommit'];

/**
 * Every on-disk schema version this build still reads, oldest first. Listing the
 * versions explicitly keeps legacy reads working when `SIDECAR_SCHEMA_VERSION`
 * advances, instead of silently dropping the previous version's optional keys.
 */
export const SUPPORTED_SIDECAR_SCHEMA_VERSIONS: readonly number[] = [
  LEGACY_SIDECAR_SCHEMA_VERSION,
  2,
  3,
  4,
  5,
];

/** Versions that persist the acquisition metadata group. */
const ACQUISITION_METADATA_SCHEMA_VERSIONS = new Set([4, 5]);
/** Versions that persist the immutable acquisition commit. */
const BASE_COMMIT_SCHEMA_VERSIONS = new Set([5]);

function isSupportedSchemaVersion(schemaVersion: number): boolean {
  return SUPPORTED_SIDECAR_SCHEMA_VERSIONS.includes(schemaVersion);
}

/** Optional Worktree keys for one on-disk schema version. */
function optionalWorktreeKeys(schemaVersion: number): readonly string[] {
  if (BASE_COMMIT_SCHEMA_VERSIONS.has(schemaVersion)) return V5_OPTIONAL_WORKTREE_KEYS;
  if (ACQUISITION_METADATA_SCHEMA_VERSIONS.has(schemaVersion)) return V4_OPTIONAL_WORKTREE_KEYS;
  return [];
}
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

function isOptionalTimestamp(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
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
  const supportsAcquisitionMetadata = ACQUISITION_METADATA_SCHEMA_VERSIONS.has(schemaVersion);
  if (!isObject(value)) {
    throw corrupt(pathname, 'invalid Worktree record');
  }
  const keys = legacy ? LEGACY_WORKTREE_KEYS : WORKTREE_KEYS;
  if (
    !hasAllowedKeys(value, keys, optionalWorktreeKeys(schemaVersion)) ||
    (value.instructions !== undefined &&
      (typeof value.instructions !== 'string' || value.instructions.length > 32_000)) ||
    (value.baseBranch !== undefined &&
      (typeof value.baseBranch !== 'string' || value.baseBranch.length === 0)) ||
    (value.baseCommit !== undefined &&
      (typeof value.baseCommit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value.baseCommit))) ||
    !isOptionalTimestamp(value.createdAt) ||
    !isOptionalTimestamp(value.importedAt) ||
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
  if (supportsAcquisitionMetadata && value.diskCleanup !== undefined) {
    if (value.diskCleanup !== 'completed') {
      throw corrupt(pathname, 'invalid diskCleanup value');
    }
    if (value.status !== 'removed') {
      throw corrupt(pathname, 'active Worktree cannot have diskCleanup');
    }
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

function assertPendingOperation(
  value: unknown,
  pathname: string,
  schemaVersion: number,
): asserts value is PendingOperation {
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
      !hasAllowedKeys(value, commonKeys, [
        ...(BASE_COMMIT_SCHEMA_VERSIONS.has(schemaVersion) ? ['baseCommit'] : []),
        'baseRef',
        'branch',
        'repository',
        'repositoryFingerprint',
      ]) ||
      typeof value.branch !== 'string' ||
      (value.baseCommit !== undefined &&
        (typeof value.baseCommit !== 'string' || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value.baseCommit))) ||
      (value.baseRef !== undefined && typeof value.baseRef !== 'string')
    ) {
      throw corrupt(pathname, 'invalid create pending operation');
    }
    return;
  }

  if (value.type === 'remove-worktree' || value.type === 'clean-worktree') {
    if (
      !hasAllowedKeys(value, [...commonKeys, 'branch', 'source'], ['repository', 'repositoryFingerprint']) ||
      typeof value.branch !== 'string' ||
      (value.source !== 'plugin' && value.source !== 'external')
    ) {
      throw corrupt(pathname, `invalid ${value.type} pending operation`);
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

function normalizeWorktreeRecord(
  record: WorktreeRecord,
  schemaVersion: number,
  targetVersion: number = SIDECAR_SCHEMA_VERSION,
): WorktreeRecord {
  const normalized: Record<string, unknown> = {
    ...record,
    source: record.source ?? 'plugin',
  };
  if (schemaVersion < 4 && targetVersion >= 4 && record.status === 'removed') {
    normalized.diskCleanup = 'completed';
  }
  if (targetVersion < 5) {
    delete normalized.baseCommit;
  }
  if (targetVersion < 4) {
    delete normalized.diskCleanup;
    delete normalized.instructions;
    delete normalized.createdAt;
    delete normalized.importedAt;
    delete normalized.baseBranch;
  }
  if (targetVersion < 2) {
    delete normalized.source;
  }
  return normalized as unknown as WorktreeRecord;
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

/** Validate supported legacy/current on-disk data and return the projection migrated to targetVersion (defaults to SIDECAR_SCHEMA_VERSION). */
export function validateSidecarSnapshot(
  value: unknown,
  pathname: string,
  generatedWorktreeRoot?: string,
  targetVersion?: typeof SIDECAR_SCHEMA_VERSION,
): SidecarSnapshot;
export function validateSidecarSnapshot(
  value: unknown,
  pathname: string,
  generatedWorktreeRoot: string | undefined,
  targetVersion: number,
): SidecarSnapshot;
export function validateSidecarSnapshot(
  value: unknown,
  pathname: string,
  generatedWorktreeRoot?: string,
  targetVersion: number = SIDECAR_SCHEMA_VERSION,
): SidecarSnapshot {
  if (!isSupportedSchemaVersion(targetVersion)) {
    throw corrupt(pathname, 'unsupported sidecar schema version', { schemaVersion: targetVersion });
  }

  if (!isObject(value) || typeof value.schemaVersion !== 'number' || typeof value.workspaceId !== 'string') {
    throw corrupt(pathname, 'invalid sidecar snapshot');
  }

  const schemaVersion = value.schemaVersion;
  const validShape = schemaVersion === LEGACY_SIDECAR_SCHEMA_VERSION
    ? hasExactKeys(value, LEGACY_SNAPSHOT_KEYS)
    : schemaVersion === 2
      ? hasExactKeys(value, ['bindings', 'schemaVersion', 'workspaceId', 'worktrees'])
      : schemaVersion >= 3 && isSupportedSchemaVersion(schemaVersion) &&
        hasAllowedKeys(value, V3_REQUIRED_SNAPSHOT_KEYS, V3_OPTIONAL_SNAPSHOT_KEYS);
  if (!validShape || !Array.isArray(value.worktrees) || !Array.isArray(value.bindings)) {
    throw corrupt(pathname, 'invalid sidecar snapshot');
  }
  if (!isSupportedSchemaVersion(schemaVersion)) {
    throw corrupt(pathname, 'unsupported sidecar schema version', { schemaVersion });
  }
  if (schemaVersion > targetVersion) {
    throw corrupt(pathname, 'cannot downgrade sidecar schema version', { schemaVersion, targetVersion });
  }
  if (
    (schemaVersion === 3 || schemaVersion === 4 || schemaVersion === SIDECAR_SCHEMA_VERSION) &&
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
  if (value.pendingOperation !== undefined) assertPendingOperation(value.pendingOperation, pathname, schemaVersion);
  if (value.recoveryIssues !== undefined) {
    if (!Array.isArray(value.recoveryIssues)) throw corrupt(pathname, 'invalid recovery issues');
    for (const issue of value.recoveryIssues) assertRecoveryIssue(issue, pathname);
  }

  const workspaceId = value.workspaceId;
  const worktrees = value.worktrees.map((record) => normalizeWorktreeRecord(record, schemaVersion, targetVersion));
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

  const rawWorktreeMap = new Map((value.worktrees as WorktreeRecord[]).map((r) => [r.worktreeId, r]));
  for (const binding of value.bindings) {
    if (binding.status === 'active') {
      const target = rawWorktreeMap.get(binding.worktreeId);
      if (!target) {
        throw corrupt(pathname, 'active binding does not point to an active Worktree');
      }
      if (schemaVersion < 4) {
        if (target.status !== 'active') {
          throw corrupt(pathname, 'active binding does not point to an active Worktree');
        }
      } else {
        if (target.diskCleanup === 'completed') {
          throw corrupt(pathname, 'cleaned records cannot retain active bindings');
        }
      }
    }
  }

  if (targetVersion === 1) {
    return {
      schemaVersion: 1,
      workspaceId,
      worktrees,
      bindings: value.bindings,
    } as unknown as SidecarSnapshot;
  }

  if (targetVersion === 2) {
    return {
      schemaVersion: 2,
      workspaceId,
      worktrees,
      bindings: value.bindings,
    } as unknown as SidecarSnapshot;
  }

  let pendingOperation = value.pendingOperation === undefined
    ? undefined
    : normalizePendingOperation(value.pendingOperation);
  if (pendingOperation && targetVersion < 5 && 'baseCommit' in pendingOperation) {
    const { baseCommit: _discarded, ...restOp } = pendingOperation as unknown as Record<string, unknown>;
    void _discarded;
    pendingOperation = restOp as unknown as PendingOperation;
  }
  const repositoryFingerprint = value.repositoryFingerprint ??
    (value.repository === undefined ? undefined : createRepositoryFingerprint(value.repository));

  return {
    schemaVersion: targetVersion as typeof SIDECAR_SCHEMA_VERSION,
    workspaceId,
    revision: schemaVersion >= 3 ? (value.revision as string) : '0',
    ...(repositoryFingerprint !== undefined ? { repositoryFingerprint } : {}),
    worktrees,
    bindings: value.bindings,
    ...(pendingOperation !== undefined ? { pendingOperation } : {}),
    ...(value.recoveryIssues !== undefined ? { recoveryIssues: value.recoveryIssues } : {}),
  };
}

/**
 * Migration entry point for tools and tests. The parameter order and the
 * required diagnostic `pathname` match `validateSidecarSnapshot` so callers
 * cannot pass the schema version where a path is expected.
 */
export function migrateSidecarSnapshot(
  value: unknown,
  pathname: string,
  generatedWorktreeRoot?: string,
  targetVersion: number = SIDECAR_SCHEMA_VERSION,
): SidecarSnapshot {
  return validateSidecarSnapshot(value, pathname, generatedWorktreeRoot, targetVersion);
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
