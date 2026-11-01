import type { WorktreeManager } from '../../contract/index.js';
import { WorktreeSessionActionError, type WorktreeSessionSnapshotReader } from './worktree-session.js';

/** Local blanks must not reuse Sessions whose original cwd hides a Worktree binding. */
export function createLocalSessionConnector(options: {
  manager: Pick<WorktreeManager, 'listBindings'>;
  sessions: WorktreeSessionSnapshotReader;
  workspace(id: string): { readonly path: string; readonly sessionIds: readonly string[] } | undefined;
  archivedSessionIds(): readonly string[];
  canReuseSession(input: { workspaceId: string; sessionId: string }): Promise<boolean>;
  createSession(input: { workspaceId: string; cwd: string; sessionId?: string }): Promise<string>;
  refreshSession(sessionId: string): Promise<void>;
  openSession(sessionId: string): void;
}) {
  const pending = new Map<string, Promise<void>>();
  let disposed = false;
  let generation = 0;
  return {
    create(workspaceId: string): Promise<void> {
      const existing = pending.get(workspaceId);
      if (existing) return existing;
      const ticket = ++generation;
      const run = async () => {
        const bindings = await options.manager.listBindings({ workspaceId });
        if (disposed) return;
        const workspace = options.workspace(workspaceId);
        const snapshot = options.sessions.getSnapshot();
        if (!workspace || snapshot.phase !== 'ready') {
          throw new WorktreeSessionActionError('WORKTREE_VIEW_UNAVAILABLE', 'Local Session source unavailable', true);
        }
        // Detached bindings also retain their native effective cwd. Never reset it
        // or reclassify those Sessions as Local merely because their header matches.
        const excluded = new Set(bindings.map((binding) => binding.sessionId));
        const archived = new Set(options.archivedSessionIds());
        let blank: string | undefined;
        for (const id of snapshot.ids) {
          const summary = snapshot.byId[id];
          if (summary?.blank && summary.cwd === workspace.path && workspace.sessionIds.includes(id)
            && !excluded.has(id) && !archived.has(id) &&
            await options.canReuseSession({ workspaceId, sessionId: id })) {
            blank = id;
            break;
          }
          if (disposed) return;
        }
        if (disposed) return;
        const sessionId = await options.createSession({ workspaceId, cwd: workspace.path,
          ...(blank === undefined ? {} : { sessionId: blank }) });
        if (blank !== undefined && blank !== sessionId) {
          void options.refreshSession(blank).catch(() => undefined);
        }
        if (!disposed && generation === ticket) {
          if (!(await options.canReuseSession({ workspaceId, sessionId }))) {
            throw new WorktreeSessionActionError('SESSION_CWD_MISMATCH', 'Local Session directory changed', true);
          }
          if (!disposed && generation === ticket) options.openSession(sessionId);
        }
      };
      const promise = run().finally(() => { if (pending.get(workspaceId) === promise) pending.delete(workspaceId); });
      pending.set(workspaceId, promise);
      return promise;
    },
    dispose() { disposed = true; generation += 1; pending.clear(); },
  };
}
