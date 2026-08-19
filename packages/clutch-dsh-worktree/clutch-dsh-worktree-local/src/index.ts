export { LocalGitAdapter } from './git.js';
export { LocalWorktreeProviderImpl, createLocalWorktreeProvider } from './provider.js';
export {
  WorkspaceShardedSidecarRepository,
  validateSidecarSnapshot,
} from './sidecar.js';
export {
  SIDECAR_SCHEMA_VERSION,
  WorktreeProviderError,
  providerError,
} from './types.js';
export type {
  DshReadAdapter,
  DshSessionSummary,
  DshWorkspaceSummary,
  GitWorktreeAdapter,
  GitWorktreeInfo,
  LocalWorktreeProvider,
  LocalWorktreeProviderOptions,
  RuntimeCwdInput,
  SidecarMutation,
  SidecarSnapshot,
  SidecarStore,
} from './types.js';
