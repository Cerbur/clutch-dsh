/** Narrow DSH Session navigation face used by the Worktree surface. */
export interface SessionOpener {
  open(sessionId: string): void;
}

/** Open an existing Session through DSH without touching the peer view mode. */
export function openWorktreeSession(opener: SessionOpener, sessionId: string): void {
  opener.open(sessionId);
}
