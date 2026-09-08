import { CrossProcessMutationLock } from '../sidecar/mutation-lock.js';
import type { GitWorktreeAdapter, SidecarStore } from '../types.js';

/** Runtime resources only; transaction behavior lives in focused function modules. */
export interface TransactionDependencies {
  readonly dshHome: string;
  readonly git: GitWorktreeAdapter;
  readonly sidecar: SidecarStore;
  readonly repositoryLock: CrossProcessMutationLock;
}
