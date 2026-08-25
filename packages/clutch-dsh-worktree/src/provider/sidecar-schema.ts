import path from 'node:path';

import type { SessionBinding, WorktreeRecord } from '../contract/index.js';
import {
  SIDECAR_SCHEMA_VERSION,
  type SidecarSnapshot,
  WorktreeProviderError,
  providerError,
} from './types.js';

const WORKTREE_KEYS = ['absolutePath', 'branch', 'status', 'workspaceId', 'worktreeId'];
const BINDING_KEYS = ['sessionId', 'status', 'workspaceId', 'worktreeId'];
const SNAPSHOT_KEYS = ['bindings', 'schemaVersion', 'workspaceId', 'worktrees'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/*
 * 每个 schema version 使用精确字段白名单，避免新版或注入字段被旧代码静默接受、随后在
 * 重写时丢失。格式演进必须显式提升 schema version。
 *
 * Each schema version uses an exact key allowlist so newer or injected fields
 * are not silently accepted and then lost on rewrite. Format evolution must
 * be represented by an explicit schema-version change.
 */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

// 可读取但不满足 schema/invariant 的数据属于 `SIDECAR_CORRUPT`；文件系统故障另报 `SIDECAR_UNAVAILABLE`。
// Readable data that violates the schema or invariants is `SIDECAR_CORRUPT`;
// filesystem failures are reported separately as `SIDECAR_UNAVAILABLE`.
export function corrupt(
  pathname: string,
  message: string,
  details: Record<string, string | number> = {},
): WorktreeProviderError {
  return providerError('SIDECAR_CORRUPT', `${message}: ${pathname}`, { path: pathname, ...details });
}

function assertWorktreeRecord(value: unknown, pathname: string): asserts value is WorktreeRecord {
  if (
    !isObject(value) ||
    !hasExactKeys(value, WORKTREE_KEYS) ||
    typeof value.worktreeId !== 'string' ||
    typeof value.workspaceId !== 'string' ||
    typeof value.absolutePath !== 'string' ||
    !path.isAbsolute(value.absolutePath) ||
    typeof value.branch !== 'string' ||
    (value.status !== 'active' && value.status !== 'removed')
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

/** Validate one complete sidecar snapshot and every cross-record invariant. */
export function validateSidecarSnapshot(
  value: unknown,
  pathname: string,
  generatedWorktreeRoot?: string,
): SidecarSnapshot {
  if (
    !isObject(value) ||
    !hasExactKeys(value, SNAPSHOT_KEYS) ||
    value.schemaVersion !== SIDECAR_SCHEMA_VERSION ||
    typeof value.workspaceId !== 'string' ||
    !Array.isArray(value.worktrees) ||
    !Array.isArray(value.bindings)
  ) {
    throw corrupt(pathname, 'invalid sidecar snapshot');
  }

  for (const record of value.worktrees) assertWorktreeRecord(record, pathname);
  for (const binding of value.bindings) assertBinding(binding, pathname);

  const workspaceId = value.workspaceId;
  const worktreeIds = new Set<string>();
  for (const record of value.worktrees) {
    if (record.workspaceId !== workspaceId) {
      throw corrupt(pathname, 'Worktree record belongs to another Workspace');
    }
    if (worktreeIds.has(record.worktreeId)) {
      throw corrupt(pathname, 'sidecar contains duplicate Worktree IDs');
    }
    worktreeIds.add(record.worktreeId);
    if (generatedWorktreeRoot) {
      // 这是词法路径约束；关键父目录的物理 symlink 边界由 I/O 前的检查单独负责。
      // This is a lexical path constraint; physical symlink boundaries for the
      // critical parent directories are checked separately before I/O.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.worktreeId)) {
        throw corrupt(pathname, 'Worktree record has an invalid generated ID');
      }
      const expectedPath = path.resolve(generatedWorktreeRoot, record.worktreeId);
      if (path.resolve(record.absolutePath) !== expectedPath) {
        throw corrupt(pathname, 'Worktree path is outside the generated DSH Home root');
      }
    }
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

  // 只有 detached binding 可以保留对非 active Worktree 的关系；active 状态绝不静默降级。
  // Only detached bindings may retain a relationship to a non-active Worktree;
  // an active relationship is never silently downgraded.
  const worktreeStatus = new Map(value.worktrees.map((record) => [record.worktreeId, record.status]));
  for (const binding of value.bindings) {
    if (binding.status === 'active' && worktreeStatus.get(binding.worktreeId) !== 'active') {
      throw corrupt(pathname, 'active binding does not point to an active Worktree');
    }
  }

  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    workspaceId,
    worktrees: value.worktrees,
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
