/**
 * 插件的稳定、浏览器安全契约层；这里只定义领域值与服务形状，不依赖 Git、sidecar 或 Node runtime。
 * Stable, browser-safe contract layer for the plugin; it defines domain values and service shapes without Git, sidecar, or Node runtime dependencies.
 *
 * @packageDocumentation
 */

/**
 * 跨 Host/浏览器边界保持稳定的领域错误码；新增、删除或重命名成员都属于公开契约变更。
 * Stable domain error codes shared across the Host/browser boundary; adding, removing, or renaming a member is a public contract change.
 */
export const WORKTREE_ERROR_CODES = Object.freeze([
  'WORKSPACE_NOT_FOUND',
  'WORKSPACE_NOT_GIT_REPOSITORY',
  'WORKTREE_REQUIRES_INITIAL_COMMIT',
  'WORKTREE_BRANCH_CONFLICT',
  'WORKTREE_NOT_FOUND',
  'WORKTREE_REMOVED',
  'SESSION_NOT_FOUND',
  'SESSION_CWD_MISMATCH',
  'SESSION_ALREADY_BOUND',
  'SIDECAR_UNAVAILABLE',
  'SIDECAR_CORRUPT',
  'SIDECAR_SYNC_REQUIRED',
  'GIT_OPERATION_FAILED',
] as const);

export type WorktreeErrorCode = (typeof WORKTREE_ERROR_CODES)[number];

export type WorkspaceId = string;
export type WorktreeId = string;
export type SessionId = string;

/**
 * Worktree 的持久化生命周期；`removed` 记录会保留，供 detached 关系与修复流程使用。
 * Persisted Worktree lifecycle; `removed` records remain available to detached relations and repair flows.
 */
export type WorktreeStatus = 'active' | 'removed';

/** Runtime-only Git health projection; this value is never persisted in the sidecar. */
export type WorktreeHealth = 'ready' | 'repair';

/**
 * Session 与 Worktree 的关系状态；删除 Worktree 只会将关系转为 `detached`，不会删除 Session。
 * Session-to-Worktree relation state; removing a Worktree only detaches the relation and never deletes the Session.
 */
export type BindingStatus = 'active' | 'detached';

/**
 * 插件 sidecar 持久化的 Worktree 元数据，不包含 DSH Workspace 或 Session 内容。
 * Worktree metadata persisted by the plugin sidecar; it contains no DSH Workspace or Session content.
 */
export interface WorktreeRecord {
  readonly worktreeId: WorktreeId;
  readonly workspaceId: WorkspaceId;
  readonly absolutePath: string;
  readonly branch: string;
  readonly status: WorktreeStatus;
  /** Runtime-only; never written to the sidecar. */
  readonly health?: WorktreeHealth;
}

/**
 * 面向分支选择器的 Git 投影；`isCurrent` 指主 Workspace，`checkedOut` 覆盖任意已注册 worktree。
 * Git projection for branch selection; `isCurrent` identifies the main Workspace and `checkedOut` covers any registered worktree.
 */
export interface BranchRecord {
  readonly name: string;
  readonly isCurrent: boolean;
  readonly checkedOut: boolean;
}

/**
 * 保存在 DSH 之外的关系记录；同一 Session 最多一个 active binding，该不变量由 Manage/Provider 写入路径强制执行。
 * Relation record stored outside DSH; the Manage/Provider write path enforces at most one active binding per Session.
 */
export interface SessionBinding {
  readonly workspaceId: WorkspaceId;
  readonly worktreeId: WorktreeId;
  readonly sessionId: SessionId;
  readonly status: BindingStatus;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type WorktreeErrorDetails = Readonly<Record<string, JsonValue>>;

/**
 * 可安全序列化的领域错误 DTO；`details` 必须保持为纯 JSON 值，避免泄漏 Provider 或 Node 对象。
 * Safely serializable domain error DTO; `details` stays plain JSON so Provider or Node objects cannot leak across boundaries.
 */
export interface WorktreeError {
  readonly code: WorktreeErrorCode;
  readonly message: string;
  readonly details: WorktreeErrorDetails;
}

/**
 * 创建错误 DTO 而不抛出异常，供 Host 将已识别的领域失败投影到 Remote result。
 * Creates an error DTO without throwing, allowing the Host to project recognized domain failures into a Remote result.
 */
export function createWorktreeError(
  code: WorktreeErrorCode,
  message: string,
  details: WorktreeErrorDetails = {},
): WorktreeError {
  return { code, message, details };
}

/**
 * Manage 层的稳定领域契约；它编排 DSH 只读数据、Git worktree 与外部 sidecar，但不拥有 DSH 数据。
 * Stable Manage-layer domain contract; it coordinates read-only DSH data, Git worktrees, and the external sidecar without owning DSH data.
 */
export interface WorktreeManager {
  /**
   * 返回 Workspace 的全部已记录 Worktree，包括为 detached 关系保留的 removed 记录。
   * Returns every recorded Worktree for the Workspace, including removed records retained for detached relations.
   */
  listWorktrees(input: { workspaceId: WorkspaceId }): Promise<readonly WorktreeRecord[]>;

  /**
   * 列出本地分支及其主 Workspace/任意 worktree checkout 状态。
   * Lists local branches together with their main-Workspace and any-worktree checkout state.
   */
  listBranches(input: { workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]>;

  /**
   * 从已有本地分支创建路径受管的 Worktree；当 base branch 已 checkout 时，`newBranch`
   * 允许从它创建一个新的本地 branch。Git 成功而 sidecar 失败时实现必须执行补偿清理。
   * Creates a path-managed Worktree from an existing local branch. When the base
   * branch is already checked out, `newBranch` creates a new local branch from it.
   * Implementations must compensate if Git succeeds but sidecar persistence fails.
   */
  createWorktree(input: {
    workspaceId: WorkspaceId;
    branch: string;
    newBranch?: string;
  }): Promise<WorktreeRecord>;

  /**
   * 删除 Git Worktree 后保留 record，并将其 active bindings 转为 detached；不会删除任何 DSH Session。
   * Removes the Git Worktree while retaining its record and detaching active bindings; no DSH Session is deleted.
   */
  removeWorktree(input: { workspaceId: WorkspaceId; worktreeId: WorktreeId }): Promise<void>;

  /**
   * 返回 active 与 detached 关系，使调用方能够区分当前归属和待修复历史。
   * Returns active and detached relations so callers can distinguish current ownership from repairable history.
   */
  listBindings(input: { workspaceId: WorkspaceId }): Promise<readonly SessionBinding[]>;

  /**
   * 幂等写入同一 active 关系；已有其他 active/detached 关系或 DSH 归属/cwd 不匹配时拒绝写入。
   * Idempotently writes the same active relation; rejects another active/detached relation or mismatched DSH ownership/cwd.
   */
  bindSession(input: {
    workspaceId: WorkspaceId;
    worktreeId: WorktreeId;
    sessionId: SessionId;
  }): Promise<SessionBinding>;
}

/**
 * Browser Remote 可调用的方法白名单；runtime cwd 解析刻意不进入该边界。
 * Allowlist of Browser Remote methods; runtime cwd resolution is intentionally excluded from this boundary.
 */
export const WORKTREE_REMOTE_METHODS = Object.freeze([
  'listWorktrees',
  'listBranches',
  'createWorktree',
  'removeWorktree',
  'listBindings',
  'bindSession',
] as const);

export type WorktreeRemoteMethod = (typeof WORKTREE_REMOTE_METHODS)[number];

/**
 * Remote 的可辨识结果：已知领域失败作为数据返回，未知或未分类异常仍由 Host 抛出。
 * Discriminated Remote result: recognized domain failures travel as data, while unknown or unclassified exceptions still escape the Host.
 */
export type WorktreeRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: WorktreeError };

/**
 * 浏览器安全的 Host 投影，只包含领域值与可序列化结果，绝不暴露 Provider 对象。
 * Browser-safe Host projection containing only domain values and serializable results, never Provider objects.
 */
export interface WorktreeRemoteManager {
  listWorktrees(input: {
    workspaceId: WorkspaceId;
  }): Promise<WorktreeRemoteResult<readonly WorktreeRecord[]>>;

  listBranches(input: {
    workspaceId: WorkspaceId;
  }): Promise<WorktreeRemoteResult<readonly BranchRecord[]>>;

  createWorktree(input: {
    workspaceId: WorkspaceId;
    branch: string;
    newBranch?: string;
  }): Promise<WorktreeRemoteResult<WorktreeRecord>>;

  removeWorktree(input: {
    workspaceId: WorkspaceId;
    worktreeId: WorktreeId;
  }): Promise<WorktreeRemoteResult<null>>;

  listBindings(input: {
    workspaceId: WorkspaceId;
  }): Promise<WorktreeRemoteResult<readonly SessionBinding[]>>;

  bindSession(input: {
    workspaceId: WorkspaceId;
    worktreeId: WorktreeId;
    sessionId: SessionId;
  }): Promise<WorktreeRemoteResult<SessionBinding>>;
}
