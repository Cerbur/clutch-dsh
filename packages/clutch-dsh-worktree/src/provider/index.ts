export { LocalGitAdapter } from './git.js';
export {
  WorkspaceShardedSidecarRepository,
  validateSidecarSnapshot,
} from './sidecar.js';
export {
  SIDECAR_SCHEMA_VERSION,
  WorktreeProviderError,
  isWorktreeProviderError,
  providerError,
} from './types.js';
export type {
  DshReadAdapter,
  DshSessionSummary,
  DshWorkspaceSummary,
  GitWorktreeAdapter,
  GitWorktreeInfo,
  SidecarMutation,
  SidecarSnapshot,
  SidecarStore,
} from './types.js';
