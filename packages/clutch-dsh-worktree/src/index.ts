export {
  WORKTREE_ERROR_CODES,
  WORKTREE_REMOTE_METHODS,
  createWorktreeError,
} from './contract/index.js';
export type {
  BranchRecord,
  BindingStatus,
  JsonPrimitive,
  JsonValue,
  SessionBinding,
  WorktreeError,
  WorktreeErrorCode,
  WorktreeErrorDetails,
  WorktreeManager,
  WorktreeRemoteManager,
  WorktreeRemoteMethod,
  WorktreeRemoteResult,
  WorktreeRecord,
  WorktreeStatus,
  WorktreeId,
  WorkspaceId,
  SessionId,
} from './contract/index.js';
export { LocalGitAdapter } from './provider/git.js';
export {
  WorkspaceShardedSidecarRepository,
  validateSidecarSnapshot,
} from './provider/sidecar.js';
export {
  SIDECAR_SCHEMA_VERSION,
  WorktreeProviderError,
  isWorktreeProviderError,
  providerError,
} from './provider/types.js';
export type {
  DshReadAdapter,
  DshSessionSummary,
  DshWorkspaceSummary,
  GitWorktreeAdapter,
  GitWorktreeInfo,
  SidecarMutation,
  SidecarSnapshot,
  SidecarStore,
} from './provider/types.js';
export { WorktreeManagerImpl, createWorktreeManager } from './manage/index.js';
export type {
  RuntimeCwdInput,
  WorktreeManagerOptions,
  WorktreeManagerService,
} from './manage/index.js';
export {
  DshHostReadAdapter,
  WorktreeRemoteService,
  createWorktreeRemoteProjection,
} from './host/index.js';
export type { DshHostReadContext, WorktreeHostConfig } from './host/index.js';
export { WorktreeRemoteService as default } from './host/index.js';
