/** Read-only authorization for a Session-scoped native Changes navigation. */
export interface NativeChangesTarget {
  readonly workspaceId: string;
  readonly worktreeId: string;
  readonly sessionId: string;
  /** Reject a Dashboard whose directory projection has since changed. */
  readonly expectedPath: string;
}

export interface NativeChangesManager {
  /** The optional signal cancels the Client read; it is never serialized into the Host input. */
  canOpenNativeChanges(input: NativeChangesTarget, signal?: AbortSignal): Promise<boolean>;
}
