import type {
  BranchRecord,
  JsonValue,
  SessionBinding,
  WorktreeErrorCode,
  WorktreeErrorDetails,
  WorktreeManager,
  WorktreeRecord,
  WorkspaceId,
} from 'clutch-dsh-worktree-manager';

export const SIDECAR_SCHEMA_VERSION = 1 as const;

export interface DshWorkspaceSummary {
  readonly workspaceId: WorkspaceId;
  readonly projectId?: string;
  readonly rootPath: string;
}

export interface DshSessionSummary {
  readonly sessionId: string;
  readonly workspaceId?: WorkspaceId;
  readonly projectId?: string;
  readonly cwd: string;
}

/** Read-only by construction: no DSH mutation methods are part of this adapter. */
export interface DshReadAdapter {
  getWorkspace(workspaceId: WorkspaceId): Promise<DshWorkspaceSummary | undefined>;
  getSession(sessionId: string): Promise<DshSessionSummary | undefined>;
  listSessions(): Promise<readonly DshSessionSummary[]>;
}

export interface GitWorktreeInfo {
  readonly absolutePath: string;
  readonly branch?: string;
}

export interface GitWorktreeAdapter {
  validateRepository(workspaceRoot: string): Promise<void>;
  listBranches(workspaceRoot: string): Promise<readonly string[]>;
  listWorktrees(workspaceRoot: string): Promise<readonly GitWorktreeInfo[]>;
  createWorktree(workspaceRoot: string, targetPath: string, branch: string): Promise<void>;
  removeWorktree(workspaceRoot: string, targetPath: string): Promise<void>;
}

export interface SidecarSnapshot {
  readonly schemaVersion: typeof SIDECAR_SCHEMA_VERSION;
  readonly workspaceId: WorkspaceId;
  readonly worktrees: readonly WorktreeRecord[];
  readonly bindings: readonly SessionBinding[];
}

export interface SidecarMutation<T> {
  readonly result: T;
  readonly snapshot: SidecarSnapshot;
  readonly changed?: boolean;
}

export interface SidecarStore {
  read(workspaceId: WorkspaceId): Promise<SidecarSnapshot>;
  mutate<T>(
    workspaceId: WorkspaceId,
    mutation: (snapshot: SidecarSnapshot) => SidecarMutation<T> | Promise<SidecarMutation<T>>,
  ): Promise<T>;
}

export interface LocalWorktreeProviderOptions {
  readonly dsh: DshReadAdapter;
  readonly dshHome: string;
  readonly git?: GitWorktreeAdapter;
  readonly sidecar?: SidecarStore;
  readonly idFactory?: () => string;
}

export interface RuntimeCwdInput {
  readonly workspaceId: WorkspaceId;
  readonly sessionId: string;
}

export interface LocalWorktreeProvider extends WorktreeManager {
  resolveRuntimeCwd(input: RuntimeCwdInput): Promise<string>;
}

export type ProviderJsonValue = JsonValue;

export class WorktreeProviderError extends Error {
  readonly code: WorktreeErrorCode;
  readonly details: WorktreeErrorDetails;

  constructor(code: WorktreeErrorCode, message: string, details: WorktreeErrorDetails = {}) {
    super(message);
    this.name = 'WorktreeProviderError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: WorktreeErrorCode; message: string; details: WorktreeErrorDetails } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function providerError(
  code: WorktreeErrorCode,
  message: string,
  details: WorktreeErrorDetails = {},
): WorktreeProviderError {
  return new WorktreeProviderError(code, message, details);
}

export function isWorktreeProviderError(error: unknown): error is WorktreeProviderError {
  return error instanceof WorktreeProviderError;
}

export type { BranchRecord, SessionBinding, WorktreeManager, WorktreeRecord };
