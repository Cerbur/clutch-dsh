/**
 * package 的 Host 入口：汇总稳定 contract、Node 侧 Provider/Manage 实现与真实 DSH
 * composition root。浏览器代码应改用 `./client`，避免把 Git、sidecar 或 Host 运行时
 * 带入 browser bundle。
 *
 * Package Host entry: it gathers the stable contract, Node-side Provider/Manage
 * implementations, and the real DSH composition root. Browser code should import
 * `./client` instead so Git, sidecar, and Host runtime code stay out of browser bundles.
 *
 * @packageDocumentation
 */
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
  WorktreeImportCandidate,
  WorktreeRemoteManager,
  WorktreeRemoteMethod,
  WorktreeRemoteResult,
  WorktreeRecord,
  WorktreeStatus,
  WorktreeSource,
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

// bundle patch 以默认导出装载同一个 Cordis 服务；命名导出保留给显式 Host 组合。
// The bundle patch loads the same Cordis service through the default export; the named
// export remains available to explicit Host compositions.
export { WorktreeRemoteService as default } from './host/index.js';
