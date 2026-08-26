import path from 'node:path';

import type { SessionBinding, WorktreeRecord } from '../contract/index.js';
import {
  LEGACY_SIDECAR_SCHEMA_VERSION,
  SIDECAR_SCHEMA_VERSION,
  type SidecarSnapshot,
  WorktreeProviderError,
  providerError,
} from './types.js';

const LEGACY_WORKTREE_KEYS = ['absolutePath', 'branch', 'status', 'workspaceId', 'worktreeId'];
const WORKTREE_KEYS = ['absolutePath', 'branch', 'source', 'status', 'workspaceId', 'worktreeId'];
const BINDING_KEYS = ['sessionId', 'status', 'workspaceId', 'worktreeId'];
const SNAPSHOT_KEYS = ['bindings', 'schemaVersion', 'workspaceId', 'worktrees'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
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

/** Validate v1/v2 on-disk data and return the current in-memory v2 projection. */
export function validateSidecarSnapshot(
  value: unknown,
  pathname: string,
  generatedWorktreeRoot?: string,
): SidecarSnapshot {
  if (
    !isObject(value) ||
    !hasExactKeys(value, SNAPSHOT_KEYS) ||
    (value.schemaVersion !== LEGACY_SIDECAR_SCHEMA_VERSION && value.schemaVersion !== SIDECAR_SCHEMA_VERSION) ||
    typeof value.workspaceId !== 'string' ||
    !Array.isArray(value.worktrees) ||
    !Array.isArray(value.bindings)
  ) {
    throw corrupt(pathname, 'invalid sidecar snapshot');
  }

  const schemaVersion = value.schemaVersion;
  for (const record of value.worktrees) assertWorktreeRecord(record, pathname, schemaVersion);
  for (const binding of value.bindings) assertBinding(binding, pathname);

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

  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    workspaceId,
    worktrees,
    bindings: value.bindings,
  };
}

export function emptySnapshot(workspaceId: string): SidecarSnapshot {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    workspaceId,
    worktrees: [],
    bindings: [],
  };
}
