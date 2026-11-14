/** Read-only authorization for a Session-scoped native Changes navigation. */
export interface NativeChangesTarget {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string;
  /** Reject a Dashboard whose directory projection has since changed. */
  readonly expectedPath: string;
}

export interface NativeChangesManager {
  canOpenNativeChanges(input: NativeChangesTarget): Promise<boolean>;
}
