import type { WorktreeToolChangeBatch } from '../contract/worktree-tool-changes.js';

/** Coalesced identities and bounded long-poll lifetime; no Git or Session facts. */
export class WorktreeToolChanges {
  private revision = 0;
  private readonly latest = new Map<
    string,
    { revision: number; workspaceId: string; worktreeId: string }
  >();
  private readonly waiters = new Set<() => void>();
  private disposed = false;

  changed(workspaceId: string, worktreeId: string): void {
    if (this.disposed) return;
    this.latest.set(workspaceId, {
      revision: ++this.revision,
      workspaceId,
      worktreeId,
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
        const timer = setTimeout(wake, 20000);
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
        .map(({ workspaceId, worktreeId }) => ({ workspaceId, worktreeId })),
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const wake of [...this.waiters]) wake();
    this.latest.clear();
  }
}
