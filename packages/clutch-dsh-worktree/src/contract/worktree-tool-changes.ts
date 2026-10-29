/** Runtime notifications; never persisted in the Sidecar. */
export interface WorktreeToolChange {
  readonly workspaceId: string;
  readonly worktreeId: string;
  /** Optional admission identity, shared with the initiating Client refresh. */
  readonly requestId?: string;
}

export interface WorktreeToolChangeBatch {
  readonly revision: number;
  readonly changes: readonly WorktreeToolChange[];
}
