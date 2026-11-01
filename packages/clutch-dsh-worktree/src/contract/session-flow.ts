import type { SessionBinding, WorktreeRecord } from './index.js';

/** Host-owned creation, shared by browser, Agent dispatch and Dashboard tasks. */
export interface WorktreeSessionCreationResult {
  readonly sessionId: string;
  readonly bound: boolean;
  readonly error?: string;
  readonly state?: WorktreeSessionState;
}
export interface WorktreeSessionCreationRequest {
  readonly workspaceId: string;
  readonly worktreeId: string;
  /** Stable across uncertain transport retries; scoped to one Host lifetime. */
  readonly requestId: string;
}
export interface WorktreeSessionCreationManager {
  createWorktreeSession(input: WorktreeSessionCreationRequest): Promise<WorktreeSessionCreationResult>;
}
/** One authoritative relationship snapshot, with health reads limited to the target. */
export interface WorktreeSessionState {
  readonly workspaceId: string;
  readonly revision: string;
  readonly target?: WorktreeRecord;
  readonly bindings: readonly SessionBinding[];
}
