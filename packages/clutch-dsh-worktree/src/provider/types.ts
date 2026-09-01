import type {
  SessionBinding,
  WorktreeErrorCode,
  WorktreeErrorDetails,
  WorktreeId,
  WorktreeRecord,
  WorkspaceId,
} from '../contract/index.js';
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess';

/**
 * 当前 sidecar 磁盘格式的唯一受支持版本；未知版本会被视为损坏，而不是被静默猜测或迁移。
 * The only supported on-disk sidecar format; unknown versions are treated as
 * corruption rather than guessed or silently migrated.
 */
export const LEGACY_SIDECAR_SCHEMA_VERSION = 1 as const;
export const SIDECAR_SCHEMA_VERSION = 3 as const;

export interface RepositoryIdentity {
  readonly topLevel: string;
  readonly commonDirectory: string;
}

export type PendingOperationPhase =
  | 'prepared'
  | 'executing'
  | 'verifying'
  | 'recovery-needed';

export interface CreateWorktreePendingOperation {
  readonly id: string;
  readonly type: 'create-worktree';
  readonly phase: PendingOperationPhase;
  readonly workspaceId: WorkspaceId;
  readonly worktreeId: WorktreeId;
  readonly targetPath: string;
  readonly branch: string;
  readonly baseRef?: string;
  readonly baseCommit?: string;
  readonly repositoryFingerprint: string;
  /** Legacy v3 journal field accepted on read and removed on the next stable write. */
  readonly repository?: RepositoryIdentity;
  readonly startedAt: string;
}

export interface RemoveWorktreePendingOperation {
  readonly id: string;
  readonly type: 'remove-worktree';
  readonly phase: PendingOperationPhase;
  readonly workspaceId: WorkspaceId;
  readonly worktreeId: WorktreeId;
  readonly targetPath: string;
  readonly branch: string;
  readonly source: 'plugin' | 'external';
  readonly repositoryFingerprint: string;
  /** Legacy v3 journal field accepted on read and removed on the next stable write. */
  readonly repository?: RepositoryIdentity;
  readonly startedAt: string;
}

export type PendingOperation =
  | CreateWorktreePendingOperation
  | RemoveWorktreePendingOperation;

export interface RecoveryIssue {
  readonly code: 'WORKTREE_RECOVERY_REQUIRED' | 'WORKTREE_IDENTITY_CHANGED';
  readonly worktreeId?: WorktreeId;
  readonly operationId?: string;
  readonly observedAt: string;
}

/**
 * 从 DSH 投影出的最小 Workspace 事实；Provider 不拥有、复制或写回这些数据。
 * Minimal Workspace facts projected from DSH; the Provider neither owns,
 * persists, nor writes these values back.
 */
export interface DshWorkspaceSummary {
  readonly workspaceId: WorkspaceId;
  readonly projectId?: string;
  readonly rootPath: string;
}

/**
 * 从 DSH Session header 投影出的只读事实；`cwd` 仅用于校验绑定关系，不成为 sidecar 数据。
 * Read-only facts projected from a DSH Session header; `cwd` is used only to
 * validate a binding and never becomes sidecar-owned data.
 */
export interface DshSessionSummary {
  readonly sessionId: string;
  readonly workspaceId?: WorkspaceId;
  readonly projectId?: string;
  readonly cwd: string;
}

/**
 * DSH 唯一数据源的只读端口；该接口刻意不暴露任何 Workspace 或 Session mutation。
 * Read-only port to the DSH source of truth; it deliberately exposes no
 * Workspace or Session mutation capability.
 */
export interface DshReadAdapter {
  getWorkspace(workspaceId: WorkspaceId): Promise<DshWorkspaceSummary | undefined>;
  /** Optional Workspace enumeration used by Host startup recovery. */
  listWorkspaces?(): Promise<readonly DshWorkspaceSummary[]>;
  getSession(sessionId: string): Promise<DshSessionSummary | undefined>;
  listSessions(): Promise<readonly DshSessionSummary[]>;
}

/**
 * `git worktree list --porcelain` 的最小投影；detached HEAD 等条目可以没有本地 branch。
 * Minimal projection of `git worktree list --porcelain`; entries such as a
 * detached HEAD may have no local branch.
 */
export interface GitWorktreeInfo {
  readonly absolutePath: string;
  readonly branch?: string;
  readonly headCommit?: string;
  readonly detached?: boolean;
}

/** Local branch facts with the physical checkout path, when Git reports one. */
export interface GitBranchWorktreeInfo {
  readonly name: string;
  readonly worktreePath?: string;
}

export interface GitRepositoryInspection {
  readonly identity: RepositoryIdentity;
  readonly headCommit?: string;
}

export interface GitCommandOptions {
  /** Abort only this Git invocation; the adapter does not own the controller. */
  readonly signal?: AbortSignal;
}

/**
 * Git Provider 消费的最小 subprocess capability；具体 local implementation 由 DSH Host
 * composition 持有。
 *
 * Minimal subprocess capability consumed by the Git Provider; the concrete local
 * implementation remains owned by the DSH Host composition.
 */
export type GitSubprocessRuntime = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>;

/**
 * Git worktree 的窄端口：只允许校验、列举、创建和删除，不提供任意 Git、远程或业务文件操作。
 * Narrow Git worktree port: it permits validation, listing, creation, and
 * removal only, with no arbitrary Git, remote, or working-file operations.
 */
export interface GitWorktreeAdapter {
  /** Validate the repository without changing the long-standing adapter contract. */
  validateRepository(workspaceRoot: string, options?: GitCommandOptions): Promise<void>;
  /**
   * Resolve the Git worktree/repository root used for repository-wide reads.
   * Optional for backwards compatibility with injected adapters written before
   * subdirectory Workspaces were supported; the local adapter always provides it.
   */
  resolveRepositoryRoot?(workspaceRoot: string, options?: GitCommandOptions): Promise<string>;
  /** Resolve canonical repository identity for cross-process Git mutation locking. */
  resolveRepositoryIdentity?(workspaceRoot: string, options?: GitCommandOptions): Promise<GitRepositoryInspection>;
  /**
   * Resolve local branches and their checkout paths in one read when supported.
   * Optional for adapters that predate the worktreepath ref-format atom.
   */
  listBranchesWithWorktreePaths?(
    workspaceRoot: string,
    options?: GitCommandOptions,
  ): Promise<readonly GitBranchWorktreeInfo[]>;
  listBranches(workspaceRoot: string, options?: GitCommandOptions): Promise<readonly string[]>;
  listWorktrees(workspaceRoot: string, options?: GitCommandOptions): Promise<readonly GitWorktreeInfo[]>;
  createWorktree(
    workspaceRoot: string,
    targetPath: string,
    branch: string,
    newBranch?: string,
    options?: GitCommandOptions,
  ): Promise<void>;
  removeWorktree(workspaceRoot: string, targetPath: string, options?: GitCommandOptions): Promise<void>;
}

/**
 * 单个 Workspace shard 的完整外部关系快照；这里只保存 Worktree 元数据和 Session binding。
 * Complete external-relation snapshot for one Workspace shard; it contains
 * only Worktree metadata and Session bindings.
 */
export interface SidecarSnapshot {
  readonly schemaVersion: typeof SIDECAR_SCHEMA_VERSION;
  readonly workspaceId: WorkspaceId;
  readonly revision: string;
  /** Stable repository witness; it contains no project root or raw filesystem path. */
  readonly repositoryFingerprint?: string;
  /** Provider-only repository metadata; never projected to the browser contract. */
  readonly repository?: RepositoryIdentity;
  readonly worktrees: readonly WorktreeRecord[];
  readonly bindings: readonly SessionBinding[];
  readonly pendingOperation?: PendingOperation;
  readonly recoveryIssues?: readonly RecoveryIssue[];
}

/**
 * 一次 mutation 的返回值和完整下一快照；`changed: false` 表示幂等命中并跳过磁盘替换。
 * Result and complete next snapshot of one mutation; `changed: false` marks an
 * idempotent hit and skips disk replacement.
 *
 * 即使跳过写入，具体 repository 仍会校验返回的快照，避免幂等分支绕过不变量。
 * Even when persistence is skipped, the concrete repository still validates
 * the returned snapshot so an idempotent branch cannot bypass invariants.
 */
export interface SidecarMutation<T> {
  readonly result: T;
  readonly snapshot: SidecarSnapshot;
  readonly changed?: boolean;
}

/**
 * sidecar 持久化端口；调用方通过一次 `mutate` 提交完整状态转换，不自行拼接 read/write 竞态窗口。
 * Sidecar persistence port; callers submit a complete state transition through
 * one `mutate` call instead of composing a racy read/write pair themselves.
 */
export interface SidecarStore {
  read(workspaceId: WorkspaceId): Promise<SidecarSnapshot>;
  mutate<T>(
    workspaceId: WorkspaceId,
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
  ): Promise<T>;
  insertWorktreeBefore(
    workspaceId: WorkspaceId,
    worktreeId: WorktreeId,
    beforeWorktreeId?: WorktreeId,
  ): Promise<readonly WorktreeId[]>;
  /**
   * Hold the cross-process Workspace shard lock while running a compound
   * mutation. Implementations without this optional seam retain legacy
   * compatibility but cannot provide the Git/sidecar transaction guarantee.
   */
  runExclusive?<T>(
    workspaceId: WorkspaceId,
    operation: (locked: LockedSidecarStore) => Promise<T>,
  ): Promise<T>;
}

export interface LockedSidecarStore {
  read(): Promise<SidecarSnapshot>;
  mutate<T>(
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
  ): Promise<T>;
}

/**
 * Provider/Manage 边界使用的结构化错误；稳定 code 供调用方分支，details 保留诊断上下文。
 * Structured error used across the Provider/Manage boundary; callers branch on
 * the stable code while details retain diagnostic context.
 */
export class WorktreeProviderError extends Error {
  readonly code: WorktreeErrorCode;
  readonly details: WorktreeErrorDetails;

  constructor(code: WorktreeErrorCode, message: string, details: WorktreeErrorDetails = {}) {
    super(message);
    this.name = 'WorktreeProviderError';
    this.code = code;
    this.details = details;
  }

  /**
   * 生成可安全投影到 Remote/日志边界的纯数据表示，不包含 stack 或运行时原型。
   * Produces a plain-data representation safe for Remote/logging boundaries,
   * excluding the stack and runtime prototype.
   */
  toJSON(): { code: WorktreeErrorCode; message: string; details: WorktreeErrorDetails } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/**
 * 统一构造 Provider 错误，确保 code、message 和 details 使用同一错误类型传播。
 * Constructs Provider errors consistently so code, message, and details travel
 * through a single error type.
 */
export function providerError(
  code: WorktreeErrorCode,
  message: string,
  details: WorktreeErrorDetails = {},
): WorktreeProviderError {
  return new WorktreeProviderError(code, message, details);
}

/**
 * 仅识别当前运行时中的真实 `WorktreeProviderError` 实例；反序列化后的同形对象不会通过。
 * Recognizes genuine `WorktreeProviderError` instances in this runtime only;
 * a structurally identical deserialized object does not pass this guard.
 */
export function isWorktreeProviderError(error: unknown): error is WorktreeProviderError {
  return error instanceof WorktreeProviderError;
}
