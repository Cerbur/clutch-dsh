/**
 * Provider 层公共入口：仅暴露底层 Git、sidecar、DSH 只读端口及统一错误词汇；
 * Worktree/Session 生命周期编排和业务冲突判断仍属于 Manage 层。
 *
 * Provider public surface: only low-level Git, sidecar, read-only DSH ports, and
 * the shared error vocabulary are exported here; Worktree/Session lifecycle
 * orchestration and policy conflicts remain the responsibility of Manage.
 */
export { LocalGitAdapter } from './git/adapter.js';
export {
  WorkspaceShardedSidecarRepository,
  validateSidecarSnapshot,
} from './sidecar/repository.js';
export {
  SIDECAR_SCHEMA_VERSION,
  LEGACY_SIDECAR_SCHEMA_VERSION,
  WorktreeProviderError,
  isWorktreeProviderError,
  providerError,
} from './types.js';
export { CrossProcessMutationLock } from './sidecar/mutation-lock.js';
export { createWorktreeMutationToken } from './mutation-token.js';
export { createRepositoryFingerprint } from './git/repository-fingerprint.js';
export { WorktreeMutationTransaction } from './transaction/index.js';
export type {
  DshReadAdapter,
  DshSessionSummary,
  DshWorkspaceSummary,
  GitBranchWorktreeInfo,
  GitCommandOptions,
  GitSubprocessRuntime,
  GitWorktreeAdapter,
  GitRepositoryInspection,
  GitWorktreeInfo,
  LockedSidecarStore,
  PendingOperation,
  RecoveryIssue,
  RepositoryIdentity,
  SidecarMutation,
  SidecarSnapshot,
  SidecarStore,
} from './types.js';
