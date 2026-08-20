import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SessionBinding, WorktreeRecord } from '../contract/index.js';

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

/*
 * 每个 schema version 使用精确字段白名单，避免新版或注入字段被旧代码静默接受、随后在
 * 重写时丢失。格式演进必须显式提升 schema version。
 *
 * Each schema version uses an exact key allowlist so newer or injected fields
 * are not silently accepted and then lost on rewrite. Format evolution must be
 * represented by an explicit schema-version change.
 */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

// 可读取但不满足 schema/invariant 的数据属于 `SIDECAR_CORRUPT`；文件系统故障另报 `SIDECAR_UNAVAILABLE`。
// Readable data that violates the schema or invariants is `SIDECAR_CORRUPT`;
// filesystem failures are reported separately as `SIDECAR_UNAVAILABLE`.
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

/**
 * 校验完整 sidecar 快照及跨记录不变量：shard Workspace 身份一致、Worktree ID 唯一、
 * 每个 Session 至多一个 active binding，且 active binding 必须指向 active Worktree。
 *
 * Validates a complete sidecar snapshot and its cross-record invariants: one
 * Workspace identity per shard, unique Worktree IDs, at most one active binding
 * per Session, and every active binding targeting an active Worktree.
 *
 * 提供 `generatedWorktreeRoot` 时，还要求 Provider 生成的 ID 合法且路径精确等于
 * `<generatedWorktreeRoot>/<worktreeId>`。detached binding 可继续指向 removed 记录，
 * 以保留删除后的关系历史。
 *
 * When `generatedWorktreeRoot` is supplied, Provider-generated IDs must be
 * valid and paths must equal `<generatedWorktreeRoot>/<worktreeId>` exactly.
 * Detached bindings may continue to reference removed records so relationships
 * survive Worktree removal.
 */
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

/*
 * 互斥范围是“同一 repository 实例 + 同一 Workspace key”。它让该实例内的 mutation
 * 依次读取最新快照，但不会假装协调其他进程或其他 repository 实例；异常也会在 finally
 * 中释放队列，避免后续操作永久阻塞。
 *
 * Mutual exclusion is scoped to one repository instance and one Workspace key.
 * It makes mutations in that instance read the latest snapshot serially, but
 * does not pretend to coordinate another process or repository instance;
 * failures still release the queue in `finally` so later work cannot deadlock.
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

/**
 * 位于 DSH Home 下、按 Workspace 分 shard 的 sidecar repository；它只持久化外部
 * Worktree/Session 关系，不读取或写入 DSH 原始数据及 Workspace 业务文件。
 *
 * Workspace-sharded sidecar repository under DSH Home; it persists only the
 * external Worktree/Session relationship and never reads or writes DSH-owned
 * data or Workspace business files.
 *
 * 同一实例内的 mutation 按 Workspace 串行化，并通过同目录临时文件加 rename 提供完整旧版或
 * 完整新版的原子可见性；这不等同于跨进程锁，也不承诺 fsync 级崩溃持久性。
 *
 * Mutations are serialized per Workspace within one instance, and a temporary
 * file plus same-directory rename provides complete-old-or-complete-new atomic
 * visibility. This is neither a cross-process lock nor an fsync-level crash
 * durability guarantee.
 */
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

  /**
   * 将 Workspace ID 编码为单个稳定文件名，所有 shard 都限定在 Provider 自有目录中。
   * Encodes a Workspace ID into one stable filename, keeping every shard under
   * the Provider-owned directory.
   */
  getShardPath(workspaceId: string): string {
    return path.join(this.workspaceRoot, `${encodeURIComponent(workspaceId)}.json`);
  }

  /**
   * 读取并完整校验 shard；文件不存在表示尚无关系并返回空快照，损坏内容绝不自动修复。
   * Reads and fully validates a shard; a missing file means no relationships yet
   * and returns an empty snapshot, while corrupt content is never auto-repaired.
   */
  async read(workspaceId: string): Promise<SidecarSnapshot> {
    return this.readFromDisk(workspaceId);
  }

  /**
   * 在 Workspace 互斥区内重新读取最新快照、应用转换、复验全部不变量，再决定是否原子写入。
   * Re-reads the latest snapshot inside the Workspace mutex, applies the
   * transition, revalidates every invariant, and only then decides whether to
   * write atomically.
   *
   * mutation 抛错、返回非法快照或改变 Workspace 身份时，已有 shard 不会被本方法替换。
   * If the mutation throws, returns an invalid snapshot, or changes Workspace
   * identity, this method does not replace the existing shard.
   */
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

  /**
   * 按 Worktree ID 幂等插入；完全相同的记录直接复用，同一 ID 的不同 metadata 被视为损坏。
   * Idempotently inserts by Worktree ID; an identical record is reused, while
   * different metadata under the same ID is treated as corruption.
   */
  async upsertWorktree(record: WorktreeRecord): Promise<WorktreeRecord> {
    const { health: _health, ...persistedRecord } = record;
    void _health;
    return this.mutate(record.workspaceId, (snapshot) => {
      const existing = snapshot.worktrees.find(
        (candidate) => candidate.worktreeId === persistedRecord.worktreeId,
      );
      if (existing) {
        if (!sameWorktree(existing, persistedRecord)) {
          throw providerError('SIDECAR_CORRUPT', 'Worktree ID already contains different metadata', {
            worktreeId: persistedRecord.worktreeId,
          });
        }
        return { result: existing, snapshot, changed: false };
      }
      return {
        result: persistedRecord,
        snapshot: { ...snapshot, worktrees: [...snapshot.worktrees, persistedRecord] },
      };
    });
  }

  /**
   * 按 Session ID 幂等插入 binding；完全相同的关系直接复用，任何既有不同关系都返回冲突。
   * Idempotently inserts a binding by Session ID; an identical relationship is
   * reused, while any different existing relationship returns a conflict.
   */
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
      // ENOENT 是未初始化状态；权限、I/O 等其他失败意味着存储不可用，不能伪装成空索引。
      // ENOENT is an uninitialized state; permission, I/O, and other failures
      // mean storage is unavailable and must not masquerade as an empty index.
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
      // 读取者只会观察到完整旧文件或完整新文件；rename 前的临时内容从不作为 shard 读取。
      // Readers observe either the complete old file or complete new file; the
      // pre-rename temporary contents are never read as the shard.
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
          // 临时文件的尽力清理失败不能覆盖原始写入结果。
          // A failed best-effort temporary-file cleanup must not replace the
          // original write result.
          void error;
        }
      }
    }
  }

  /*
   * 每次 I/O 前拒绝关键存储父目录本身为 symlink，避免 Provider 自有相对布局被重定向到
   * Workspace 或 DSH 原始数据位置。目录不存在是首次初始化的正常状态。
   *
   * Before each I/O operation, reject critical storage parent directories that
   * are themselves symlinks so the Provider-owned relative layout cannot be
   * redirected into a Workspace or DSH-owned data. Missing directories are a
   * normal first-initialization state.
   */
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
