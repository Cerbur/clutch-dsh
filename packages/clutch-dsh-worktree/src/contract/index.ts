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

export type WorktreeStatus = 'active' | 'removed';
export type BindingStatus = 'active' | 'detached';

export interface WorktreeRecord {
  readonly worktreeId: WorktreeId;
  readonly workspaceId: WorkspaceId;
  readonly absolutePath: string;
  readonly branch: string;
  readonly status: WorktreeStatus;
}

export interface BranchRecord {
  readonly name: string;
  readonly isCurrent: boolean;
  readonly checkedOut: boolean;
}

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

export interface WorktreeError {
  readonly code: WorktreeErrorCode;
  readonly message: string;
  readonly details: WorktreeErrorDetails;
}

export function createWorktreeError(
  code: WorktreeErrorCode,
  message: string,
  details: WorktreeErrorDetails = {},
): WorktreeError {
  return { code, message, details };
}

export interface WorktreeManager {
  listWorktrees(input: { workspaceId: WorkspaceId }): Promise<readonly WorktreeRecord[]>;

  listBranches(input: { workspaceId: WorkspaceId }): Promise<readonly BranchRecord[]>;

  createWorktree(input: { workspaceId: WorkspaceId; branch: string }): Promise<WorktreeRecord>;

  removeWorktree(input: { workspaceId: WorkspaceId; worktreeId: WorktreeId }): Promise<void>;

  listBindings(input: { workspaceId: WorkspaceId }): Promise<readonly SessionBinding[]>;

  bindSession(input: {
    workspaceId: WorkspaceId;
    worktreeId: WorktreeId;
    sessionId: SessionId;
  }): Promise<SessionBinding>;
}

export const WORKTREE_REMOTE_METHODS = Object.freeze([
  'listWorktrees',
  'listBranches',
  'createWorktree',
  'removeWorktree',
  'listBindings',
  'bindSession',
] as const);

export type WorktreeRemoteMethod = (typeof WORKTREE_REMOTE_METHODS)[number];

export type WorktreeRemoteResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: WorktreeError };

/** Browser-safe Host projection. It contains domain values only, never Provider objects. */
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
