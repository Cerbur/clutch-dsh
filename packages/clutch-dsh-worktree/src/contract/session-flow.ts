/** Host-owned creation, shared by browser, Agent dispatch and Dashboard tasks. */
export interface WorktreeSessionCreationResult {
  readonly sessionId: string;
  readonly bound: boolean;
  readonly error?: string;
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
