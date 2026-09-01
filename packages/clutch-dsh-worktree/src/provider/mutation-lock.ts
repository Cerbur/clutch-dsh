import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { providerError } from './types.js';

export interface MutationLockOptions {
  readonly acquisitionTimeoutMs?: number;
  readonly leaseMs?: number;
  readonly heartbeatMs?: number;
}

export interface MutationLockHandle {
  readonly keyHash: string;
  assertHeld(): void;
  release(): Promise<void>;
}

interface LockOwner {
  readonly version: 1;
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly startedAt: string;
  readonly heartbeatAt: string;
}

const DEFAULT_ACQUISITION_TIMEOUT_MS = 10_000;
const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_HEARTBEAT_MS = 5_000;

function isAlreadyExists(error: unknown): boolean {
  return (error as { readonly code?: string }).code === 'EEXIST';
}

function isMissing(error: unknown): boolean {
  return (error as { readonly code?: string }).code === 'ENOENT';
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { readonly code?: string }).code === 'EPERM';
  }
}

function parseOwner(value: string): LockOwner | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<LockOwner>;
    if (
      parsed.version !== 1 ||
      typeof parsed.token !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.hostname !== 'string' ||
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.heartbeatAt !== 'string'
    ) {
      return undefined;
    }
    return parsed as LockOwner;
  } catch {
    return undefined;
  }
}

/**
 * A small cross-process lease lock backed by an atomically-created directory.
 * An owned directory is never reclaimed based on age alone: its stale owner
 * must also be provably dead on the same host. An ownerless directory is only
 * possible during interrupted lock acquisition, so it can be reclaimed after
 * one lease interval without stealing an alive Git operation.
 */
export class CrossProcessMutationLock {
  readonly lockRoot: string;

  private readonly acquisitionTimeoutMs: number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;

  constructor({
    lockRoot,
    acquisitionTimeoutMs = DEFAULT_ACQUISITION_TIMEOUT_MS,
    leaseMs = DEFAULT_LEASE_MS,
    heartbeatMs = DEFAULT_HEARTBEAT_MS,
  }: MutationLockOptions & { readonly lockRoot: string }) {
    if (!path.isAbsolute(lockRoot)) {
      throw providerError('SIDECAR_UNAVAILABLE', 'Mutation lock root must be an absolute path', { lockRoot });
    }
    if (acquisitionTimeoutMs < 0 || leaseMs <= 0 || heartbeatMs <= 0 || heartbeatMs >= leaseMs) {
      throw providerError('SIDECAR_UNAVAILABLE', 'Invalid mutation lock timing configuration', {
        acquisitionTimeoutMs,
        leaseMs,
        heartbeatMs,
      });
    }
    this.lockRoot = path.resolve(lockRoot);
    this.acquisitionTimeoutMs = acquisitionTimeoutMs;
    this.leaseMs = leaseMs;
    this.heartbeatMs = heartbeatMs;
  }

  getLockPath(key: string): string {
    const keyHash = createHash('sha256').update(key).digest('hex');
    return path.join(this.lockRoot, `${keyHash}.lock`);
  }

  async run<T>(key: string, operation: (handle: MutationLockHandle) => Promise<T>): Promise<T> {
    const handle = await this.acquire(key);
    try {
      return await operation(handle);
    } finally {
      await handle.release();
    }
  }

  private async acquire(key: string): Promise<MutationLockHandle> {
    try {
      if ((await lstat(this.lockRoot)).isSymbolicLink()) {
        throw providerError('SIDECAR_UNAVAILABLE', `Mutation lock root must not be a symlink: ${this.lockRoot}`, {
          path: this.lockRoot,
        });
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    await mkdir(this.lockRoot, { recursive: true, mode: 0o700 });
    const keyHash = createHash('sha256').update(key).digest('hex');
    const lockPath = this.getLockPath(key);
    let owner: LockOwner = {
      version: 1,
      token: randomUUID(),
      pid: process.pid,
      hostname: os.hostname(),
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
    const startedAt = Date.now();
    let lost = false;
    let released = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

    const writeOwner = async (): Promise<void> => {
      const ownerPath = path.join(lockPath, 'owner.json');
      const temporaryPath = `${ownerPath}.${owner.token}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(owner)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
        await rename(temporaryPath, ownerPath);
      } finally {
        try {
          await rm(temporaryPath, { force: true });
        } catch {
          // Best-effort cleanup must not hide the owner publication result.
        }
      }
    };

    const heartbeat = async (): Promise<void> => {
      if (released) return;
      try {
        owner = { ...owner, heartbeatAt: new Date().toISOString() };
        await writeOwner();
      } catch {
        lost = true;
      }
    };

    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer);
      try {
        const current = parseOwner(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
        if (current?.token === owner.token) await rm(lockPath, { recursive: true, force: true });
      } catch (error) {
        if (!isMissing(error)) void error;
      }
    };

    while (true) {
      try {
        await mkdir(lockPath, { recursive: false, mode: 0o700 });
        try {
          await writeOwner();
        } catch (error) {
          await rm(lockPath, { recursive: true, force: true });
          throw error;
        }
        heartbeatTimer = setInterval(() => {
          void heartbeat();
        }, this.heartbeatMs);
        heartbeatTimer.unref?.();
        return {
          keyHash,
          assertHeld: () => {
            if (lost) {
              throw providerError('WORKTREE_RECOVERY_REQUIRED', 'Mutation lock lease was lost', { keyHash });
            }
          },
          release,
        };
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        try {
          if ((await lstat(lockPath)).isSymbolicLink()) {
            throw providerError('SIDECAR_UNAVAILABLE', `Mutation lock path must not be a symlink: ${lockPath}`, {
              path: lockPath,
            });
          }
        } catch (symlinkError) {
          if (!isMissing(symlinkError)) throw symlinkError;
        }
        await this.reclaimIfDead(lockPath);
        if (Date.now() - startedAt >= this.acquisitionTimeoutMs) {
          throw providerError('WORKTREE_MUTATION_BUSY', 'Another process is mutating this Worktree state', {
            keyHash,
            timeoutMs: this.acquisitionTimeoutMs,
          });
        }
        await delay(Math.min(50, Math.max(5, this.heartbeatMs / 10)));
      }
    }
  }

  private async reclaimIfDead(lockPath: string): Promise<void> {
    let owner: LockOwner | undefined;
    let ownerFileMissing = false;
    try {
      owner = parseOwner(await readFile(path.join(lockPath, 'owner.json'), 'utf8'));
    } catch (error) {
      if (isMissing(error)) ownerFileMissing = true;
      else return;
    }
    if (ownerFileMissing) {
      let lockStats;
      try {
        lockStats = await stat(lockPath);
      } catch (error) {
        if (isMissing(error)) return;
        return;
      }
      if (Date.now() - lockStats.mtimeMs < this.leaseMs) return;
      await this.abandon(lockPath);
      return;
    }
    if (!owner || owner.hostname !== os.hostname()) return;
    const heartbeatAt = Date.parse(owner.heartbeatAt);
    if (!Number.isFinite(heartbeatAt) || Date.now() - heartbeatAt < this.leaseMs) return;
    if (processIsAlive(owner.pid)) return;

    // Rename is the ownership handoff: a contender cannot remove a newly
    // acquired lock after another contender has already moved this directory.
    await this.abandon(lockPath);
  }

  private async abandon(lockPath: string): Promise<void> {
    try {
      if ((await lstat(lockPath)).isSymbolicLink()) return;
    } catch (error) {
      if (isMissing(error)) return;
      return;
    }
    const abandonedPath = `${lockPath}.abandoned-${randomUUID()}`;
    try {
      await rename(lockPath, abandonedPath);
      await rm(abandonedPath, { recursive: true, force: true });
    } catch (error) {
      if (!isMissing(error)) void error;
    }
  }
}

export const MUTATION_LOCK_DEFAULTS = Object.freeze({
  acquisitionTimeoutMs: DEFAULT_ACQUISITION_TIMEOUT_MS,
  leaseMs: DEFAULT_LEASE_MS,
  heartbeatMs: DEFAULT_HEARTBEAT_MS,
});
