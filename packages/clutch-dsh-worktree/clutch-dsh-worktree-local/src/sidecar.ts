import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SessionBinding, WorktreeRecord } from 'clutch-dsh-worktree-manager';

import {
  SIDECAR_SCHEMA_VERSION,
  type SidecarMutation,
  type SidecarSnapshot,
  type SidecarStore,
  WorktreeProviderError,
  providerError,
} from './types.js';

const WORKTREE_KEYS = ['absolutePath', 'branch', 'status', 'workspaceId', 'worktreeId'];
const BINDING_KEYS = ['sessionId', 'status', 'workspaceId', 'worktreeId'];
const SNAPSHOT_KEYS = ['bindings', 'schemaVersion', 'workspaceId', 'worktrees'];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function corrupt(pathname: string, message: string, details: Record<string, string | number> = {}): WorktreeProviderError {
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

function emptySnapshot(workspaceId: string): SidecarSnapshot {
  return {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    workspaceId,
    worktrees: [],
    bindings: [],
  };
}

function sameWorktree(left: WorktreeRecord, right: WorktreeRecord): boolean {
  return (
    left.worktreeId === right.worktreeId &&
    left.workspaceId === right.workspaceId &&
    left.absolutePath === right.absolutePath &&
    left.branch === right.branch &&
    left.status === right.status
  );
}

function sameBinding(left: SessionBinding, right: SessionBinding): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.worktreeId === right.worktreeId &&
    left.sessionId === right.sessionId &&
    left.status === right.status
  );
}

class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}

export class WorkspaceShardedSidecarRepository implements SidecarStore {
  readonly pluginRoot: string;
  readonly worktreeRoot: string;
  readonly workspaceRoot: string;

  private readonly dshHome: string;
  private readonly mutex = new KeyedMutex();

  constructor({ dshHome }: { readonly dshHome: string }) {
    if (!path.isAbsolute(dshHome)) {
      throw providerError('SIDECAR_UNAVAILABLE', 'DSH Home must be an absolute path', { dshHome });
    }
    this.dshHome = path.resolve(dshHome);
    this.pluginRoot = path.join(this.dshHome, 'clutch-dsh-worktree');
    this.worktreeRoot = path.join(this.pluginRoot, 'worktree');
    this.workspaceRoot = path.join(this.pluginRoot, 'workspaces');
  }

  getShardPath(workspaceId: string): string {
    return path.join(this.workspaceRoot, `${encodeURIComponent(workspaceId)}.json`);
  }

  async read(workspaceId: string): Promise<SidecarSnapshot> {
    return this.readFromDisk(workspaceId);
  }

  async mutate<T>(
    workspaceId: string,
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
  ): Promise<T> {
    return this.mutex.run(workspaceId, async () => {
      const current = await this.readFromDisk(workspaceId);
      const result = await mutation(current);
      const next = validateSidecarSnapshot(result.snapshot, this.getShardPath(workspaceId), this.worktreeRoot);
      if (next.workspaceId !== workspaceId) {
        throw corrupt(this.getShardPath(workspaceId), 'sidecar mutation changed the Workspace identity');
      }
      if (result.changed !== false) await this.writeToDisk(next);
      return result.result;
    });
  }

  async upsertWorktree(record: WorktreeRecord): Promise<WorktreeRecord> {
    return this.mutate(record.workspaceId, (snapshot) => {
      const existing = snapshot.worktrees.find((candidate) => candidate.worktreeId === record.worktreeId);
      if (existing) {
        if (!sameWorktree(existing, record)) {
          throw providerError('SIDECAR_CORRUPT', 'Worktree ID already contains different metadata', {
            worktreeId: record.worktreeId,
          });
        }
        return { result: existing, snapshot, changed: false };
      }
      return {
        result: record,
        snapshot: { ...snapshot, worktrees: [...snapshot.worktrees, record] },
      };
    });
  }

  async upsertBinding(binding: SessionBinding): Promise<SessionBinding> {
    return this.mutate(binding.workspaceId, (snapshot) => {
      const existing = snapshot.bindings.find((candidate) => candidate.sessionId === binding.sessionId);
      if (existing) {
        if (!sameBinding(existing, binding)) {
          throw providerError('SESSION_ALREADY_BOUND', 'Session is already bound to another Worktree', {
            sessionId: binding.sessionId,
            worktreeId: existing.worktreeId,
          });
        }
        return { result: existing, snapshot, changed: false };
      }
      return {
        result: binding,
        snapshot: { ...snapshot, bindings: [...snapshot.bindings, binding] },
      };
    });
  }

  private async readFromDisk(workspaceId: string): Promise<SidecarSnapshot> {
    await this.assertStorageBoundary();
    const shardPath = this.getShardPath(workspaceId);
    let text: string;
    try {
      text = await readFile(shardPath, 'utf8');
    } catch (error) {
      if ((error as { readonly code?: string }).code === 'ENOENT') return emptySnapshot(workspaceId);
      throw providerError('SIDECAR_UNAVAILABLE', `Unable to read sidecar shard: ${shardPath}`, {
        path: shardPath,
        cause: String(error),
      });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw providerError('SIDECAR_CORRUPT', `Unable to parse sidecar shard: ${shardPath}`, {
        path: shardPath,
        cause: String(error),
      });
    }
    const snapshot = validateSidecarSnapshot(parsed, shardPath, this.worktreeRoot);
    if (snapshot.workspaceId !== workspaceId) {
      throw corrupt(shardPath, 'sidecar shard Workspace identity does not match its filename');
    }
    return snapshot;
  }

  private async writeToDisk(snapshot: SidecarSnapshot): Promise<void> {
    await this.assertStorageBoundary();
    const shardPath = this.getShardPath(snapshot.workspaceId);
    const temporaryPath = `${shardPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.workspaceRoot, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, shardPath);
    } catch (error) {
      throw providerError('SIDECAR_UNAVAILABLE', `Unable to atomically write sidecar shard: ${shardPath}`, {
        path: shardPath,
        temporaryPath,
        cause: String(error),
      });
    } finally {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if ((error as { readonly code?: string }).code !== 'ENOENT') {
          // A failed best-effort cleanup must not replace the write result.
          void error;
        }
      }
    }
  }

  private async assertStorageBoundary(): Promise<void> {
    for (const [pathname, label] of [
      [this.dshHome, 'DSH Home'],
      [this.pluginRoot, 'plugin sidecar root'],
      [this.worktreeRoot, 'Worktree root'],
      [this.workspaceRoot, 'Workspace shard root'],
    ] as const) {
      try {
        if ((await lstat(pathname)).isSymbolicLink()) {
          throw providerError('SIDECAR_UNAVAILABLE', `${label} must not be a symlink: ${pathname}`, {
            path: pathname,
          });
        }
      } catch (error) {
        if ((error as { readonly code?: string }).code === 'ENOENT') continue;
        if (error instanceof WorktreeProviderError) throw error;
        throw providerError('SIDECAR_UNAVAILABLE', `Unable to inspect ${label}: ${pathname}`, {
          path: pathname,
          cause: String(error),
        });
      }
    }
  }
}
