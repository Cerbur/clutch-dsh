import type { WorktreeManagerOptions } from './types.js';
import type { GitWorktreeAdapter, SidecarStore } from '../provider/types.js';

/** Internal Manage composition context shared by the responsibility-specific use-case modules. */
export interface WorktreeManagerContext {
  readonly dsh: WorktreeManagerOptions['dsh'];
  readonly dshHome: string;
  readonly git: GitWorktreeAdapter;
  readonly sidecar: SidecarStore;
  readonly idFactory: () => string;
}
