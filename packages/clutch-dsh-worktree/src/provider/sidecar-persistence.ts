import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  type SidecarMutation,
  type SidecarSnapshot,
  WorktreeProviderError,
  providerError,
} from './types.js';
import { corrupt, emptySnapshot, validateSidecarSnapshot } from './sidecar-schema.js';

/*
 * 互斥范围是“同一 repository 实例 + 同一 Workspace key”。它让该实例内的 mutation
 * 依次读取最新快照，但不会假装协调其他进程或其他 repository 实例；异常也会在 finally
 * 中释放队列，避免后续操作永久阻塞。
 *
 * Mutual exclusion is scoped to one repository instance and one Workspace key.
 * It makes mutations in that instance read the latest snapshot serially, but
 * does not pretend to coordinate another process or another repository instance.
 */
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

/** Owns sidecar file paths, per-Workspace serialization, and atomic disk I/O. */
export class SidecarPersistence {
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
    await this.assertStorageBoundary();
    const shardPath = this.getShardPath(workspaceId);
    let text: string;
    try {
      text = await readFile(shardPath, 'utf8');
    } catch (error) {
      // ENOENT is an uninitialized state; other filesystem failures remain unavailable.
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

  async mutate<T>(
    workspaceId: string,
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
  ): Promise<T> {
    return this.mutex.run(workspaceId, async () => {
      const current = await this.read(workspaceId);
      const result = await mutation(current);
      const next = validateSidecarSnapshot(result.snapshot, this.getShardPath(workspaceId), this.worktreeRoot);
      if (next.workspaceId !== workspaceId) {
        throw corrupt(this.getShardPath(workspaceId), 'sidecar mutation changed the Workspace identity');
      }
      if (result.changed !== false) await this.write(next);
      return result.result;
    });
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
      // Readers observe either the complete old file or complete new file.
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
