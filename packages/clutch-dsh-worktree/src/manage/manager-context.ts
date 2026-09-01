import type { WorktreeManagerOptions } from './types.js';
import type { GitWorktreeAdapter, SidecarStore } from '../provider/types.js';
import type { WorktreeMutationTransaction } from '../provider/transaction.js';

/** Internal Manage composition context shared by the responsibility-specific use-case modules. */
export interface WorktreeManagerContext {
  readonly dsh: WorktreeManagerOptions['dsh'];
  readonly dshHome: string;
  readonly git: GitWorktreeAdapter;
  readonly sidecar: SidecarStore;
  readonly transaction: WorktreeMutationTransaction;
  readonly idFactory: () => string;
}
