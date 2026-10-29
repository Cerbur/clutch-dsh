export type WorktreeSyncStrategy = 'rebase' | 'merge';

export interface WorktreeBaselineSyncRequest {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly strategy: WorktreeSyncStrategy;
  /** Saved baseline witnessed by the confirmation dialog. */
  readonly baseBranch: string;
  /** One admission identity; reuse it after transport failure. */
  readonly requestId: string;
}

export interface WorktreeSessionDispatchResult {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly model: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string };
  readonly status: 'dispatched' | 'binding-failed' | 'model-failed' | 'title-failed' | 'reporting-failed' | 'prompt-failed';
  readonly error?: string;
}

export interface WorktreeBaselineSyncManager {
  syncWorktreeBaseline(input: WorktreeBaselineSyncRequest): Promise<WorktreeSessionDispatchResult>;
}
