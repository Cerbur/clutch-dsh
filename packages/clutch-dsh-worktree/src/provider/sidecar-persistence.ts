import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CrossProcessMutationLock } from './mutation-lock.js';
import {
  type LockedSidecarStore,
  type SidecarMutation,
  type SidecarSnapshot,
  WorktreeProviderError,
  providerError,
} from './types.js';
import { corrupt, emptySnapshot, validateSidecarSnapshot } from './sidecar-schema.js';

interface ReadSnapshot {
  readonly snapshot: SidecarSnapshot;
  readonly needsMigration: boolean;
}

/** Owns sidecar file paths, cross-process serialization, schema migration, and atomic disk I/O. */
export class SidecarPersistence {
  readonly pluginRoot: string;
  readonly worktreeRoot: string;
  readonly workspaceRoot: string;
  readonly lockRoot: string;

  private readonly dshHome: string;
  private readonly mutationLock: CrossProcessMutationLock;

  constructor({ dshHome }: { readonly dshHome: string }) {
    if (!path.isAbsolute(dshHome)) {
      throw providerError('SIDECAR_UNAVAILABLE', 'DSH Home must be an absolute path', { dshHome });
    }
    this.dshHome = path.resolve(dshHome);
    this.pluginRoot = path.join(this.dshHome, 'clutch-dsh-worktree');
    this.worktreeRoot = path.join(this.pluginRoot, 'worktree');
    this.workspaceRoot = path.join(this.pluginRoot, 'workspaces');
    this.lockRoot = path.join(this.pluginRoot, 'locks');
    this.mutationLock = new CrossProcessMutationLock({ lockRoot: this.lockRoot });
  }

  getShardPath(workspaceId: string): string {
    return path.join(this.workspaceRoot, `${encodeURIComponent(workspaceId)}.json`);
  }

  async read(workspaceId: string): Promise<SidecarSnapshot> {
    return (await this.readSnapshot(workspaceId)).snapshot;
  }

  async runExclusive<T>(
    workspaceId: string,
    operation: (locked: LockedSidecarStore) => Promise<T>,
  ): Promise<T> {
    // Validate the lock/storage boundary before creating a lock directory. A
    // symlinked lock root must not become an alternate write location.
    await this.assertStorageBoundary();
    return this.mutationLock.run(`workspace:${workspaceId}`, async (lock) => {
      lock.assertHeld();
      const locked: LockedSidecarStore = {
        read: async () => {
          lock.assertHeld();
          return (await this.readSnapshot(workspaceId)).snapshot;
        },
        mutate: async <Value>(mutation: (snapshot: SidecarSnapshot) => SidecarMutation<Value> | Promise<SidecarMutation<Value>>) => {
          lock.assertHeld();
          return this.mutateLocked(workspaceId, mutation, lock);
        },
      };
      return operation(locked);
    });
  }

  private async readSnapshot(workspaceId: string): Promise<ReadSnapshot> {
    await this.assertStorageBoundary();
    const shardPath = this.getShardPath(workspaceId);
    let text: string;
    try {
      text = await readFile(shardPath, 'utf8');
    } catch (error) {
      // ENOENT is an uninitialized state; other filesystem failures remain unavailable.
      if ((error as { readonly code?: string }).code === 'ENOENT') {
        return { snapshot: emptySnapshot(workspaceId), needsMigration: false };
      }
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
    const parsedObject = parsed !== null && typeof parsed === 'object'
      ? parsed as { readonly repository?: unknown; readonly pendingOperation?: unknown }
      : undefined;
    const legacyRepositoryField = parsedObject?.repository !== undefined ||
      (parsedObject?.pendingOperation !== null &&
        typeof parsedObject?.pendingOperation === 'object' &&
        parsedObject.pendingOperation !== undefined &&
        'repository' in parsedObject.pendingOperation);
    return {
      snapshot,
      needsMigration: (parsed !== null && typeof parsed === 'object' &&
        (parsed as { readonly schemaVersion?: unknown }).schemaVersion !== snapshot.schemaVersion) ||
        legacyRepositoryField,
    };
  }

  async mutate<T>(
    workspaceId: string,
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
  ): Promise<T> {
    return this.runExclusive(workspaceId, async (locked) => {
      const current = await locked.read();
      if (current.pendingOperation !== undefined || (current.recoveryIssues?.length ?? 0) > 0) {
        const operationId = current.pendingOperation?.id;
        throw providerError(
          'WORKTREE_RECOVERY_REQUIRED',
          operationId
            ? `Workspace has a pending Worktree operation: ${operationId}`
            : `Workspace has unresolved Worktree recovery issues: ${workspaceId}`,
          {
            workspaceId,
            ...(operationId ? { operationId } : {}),
            ...(current.recoveryIssues ? { recoveryCodes: current.recoveryIssues.map((issue) => issue.code) } : {}),
          },
        );
      }
      return locked.mutate(mutation);
    });
  }

  private async mutateLocked<T>(
    workspaceId: string,
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
    lock: { assertHeld(): void },
  ): Promise<T> {
    const current = await this.readSnapshot(workspaceId);
    const result = await mutation(current.snapshot);
    lock.assertHeld();
    const next = stripLegacyRepositoryFields(
      validateSidecarSnapshot(result.snapshot, this.getShardPath(workspaceId), this.worktreeRoot),
    );
    if (next.workspaceId !== workspaceId) {
      throw corrupt(this.getShardPath(workspaceId), 'sidecar mutation changed the Workspace identity');
    }
    const shouldWrite = result.changed !== false || current.needsMigration;
    if (shouldWrite) {
      await this.write({ ...next, revision: nextRevision(current.snapshot.revision, result.changed !== false) });
    }
    return result.result;
  }

  private async write(snapshot: SidecarSnapshot): Promise<void> {
    await this.assertStorageBoundary();
    const shardPath = this.getShardPath(snapshot.workspaceId);
    // 临时文件与目标 shard 位于同一目录，从而避免跨文件系统 rename；随机后缀防止并发残留碰撞。
    // The temporary file shares the shard directory to avoid a cross-filesystem
    // rename, and its random suffix prevents collisions with concurrent debris.
    const temporaryPath = `${shardPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.workspaceRoot, { recursive: true });
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await syncFile(temporaryPath);
      // Readers observe either the complete old file or complete new file.
      await rename(temporaryPath, shardPath);
      await syncDirectory(this.workspaceRoot);
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
          // Best-effort cleanup must not replace the original write result.
          void error;
        }
      }
    }
  }

  /* Reject critical storage parent directories that are themselves symlinks before every I/O. */
  private async assertStorageBoundary(): Promise<void> {
    for (const [pathname, label] of [
      [this.dshHome, 'DSH Home'],
      [this.pluginRoot, 'plugin sidecar root'],
      [this.worktreeRoot, 'Worktree root'],
      [this.workspaceRoot, 'Workspace shard root'],
      [this.lockRoot, 'Mutation lock root'],
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

function stripLegacyRepositoryFields(snapshot: SidecarSnapshot): SidecarSnapshot {
  const { repository: _repository, pendingOperation, ...withoutRepository } = snapshot;
  void _repository;
  if (pendingOperation === undefined) return withoutRepository;
  const { repository: _pendingRepository, ...withoutPendingRepository } = pendingOperation;
  void _pendingRepository;
  return {
    ...withoutRepository,
    pendingOperation: withoutPendingRepository,
  };
}

function nextRevision(current: string, changed: boolean): string {
  if (!changed) return current;
  return (BigInt(current) + 1n).toString();
}

async function syncFile(pathname: string): Promise<void> {
  const handle = await open(pathname, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(pathname: string): Promise<void> {
  try {
    const handle = await open(pathname, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as { readonly code?: string }).code;
    // Windows and some filesystems do not support opening directories for fsync.
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EISDIR' && code !== 'EPERM') throw error;
  }
}
