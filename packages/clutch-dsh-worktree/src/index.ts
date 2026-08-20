export { WORKTREE_ERROR_CODES, createWorktreeError } from './contract/index.js';
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
