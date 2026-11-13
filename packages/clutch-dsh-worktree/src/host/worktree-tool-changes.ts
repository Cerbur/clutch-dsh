import type { WorktreeToolChangeBatch } from '../contract/worktree-tool-changes.js';

// Desktop drains admitted /api requests before shutdown, with a 10s control
// deadline. Leave time for transport and the final task check; an idle read
// must finish even though Host disposal has not started yet.
const POLL_TIMEOUT_MS = 5_000;

/** Coalesced identities and bounded long-poll lifetime; no Git or Session facts. */
export class WorktreeToolChanges {
  private revision = 0;
  private readonly latest = new Map<
    string,
    { revision: number; workspaceId: string; worktreeId: string; requestId?: string }
  >();
  private readonly waiters = new Set<() => void>();
  private disposed = false;

  changed(workspaceId: string, worktreeId: string, requestId?: string): void {
    if (this.disposed) return;
    this.latest.set(workspaceId, {
      revision: ++this.revision,
      workspaceId,
      worktreeId,
      ...(requestId === undefined ? {} : { requestId }),
    });
    for (const wake of [...this.waiters]) wake();
  }

  async watch(
    afterRevision: number,
    signal: AbortSignal,
  ): Promise<WorktreeToolChangeBatch> {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0)
      throw new Error('Invalid revision');
    if (this.disposed) throw new Error('Worktree plugin is disposed');
    if (afterRevision === this.revision) {
      await new Promise<void>((resolve, reject) => {
        const done = (error?: unknown) => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          signal.removeEventListener('abort', abort);
          if (error) reject(error);
          else resolve();
        };
        const wake = () => done();
        const abort = () => done(signal.reason ?? new Error('Aborted'));
        const timer = setTimeout(wake, POLL_TIMEOUT_MS);
        this.waiters.add(wake);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
    signal.throwIfAborted();
    if (this.disposed) throw new Error('Worktree plugin is disposed');
    const baseline = afterRevision > this.revision ? 0 : afterRevision;
    return {
      revision: this.revision,
      changes: [...this.latest.values()]
        .filter((change) => change.revision > baseline)
        .map(({ workspaceId, worktreeId, requestId }) => ({
          workspaceId, worktreeId, ...(requestId === undefined ? {} : { requestId }),
        })),
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const wake of [...this.waiters]) wake();
    this.latest.clear();
  }
}
