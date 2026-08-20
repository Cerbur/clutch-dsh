import type { WorktreeManager } from '../contract/index.js';
import type {
  DshReadAdapter,
  GitWorktreeAdapter,
  SidecarStore,
} from '../provider/types.js';

export interface RuntimeCwdInput {
  readonly workspaceId: string;
  readonly sessionId: string;
}

export interface WorktreeManagerOptions {
  readonly dsh: DshReadAdapter;
  readonly dshHome: string;
  readonly git?: GitWorktreeAdapter;
  readonly sidecar?: SidecarStore;
  readonly idFactory?: () => string;
}

export interface WorktreeManagerService extends WorktreeManager {
  resolveRuntimeCwd(input: RuntimeCwdInput): Promise<string>;
}
