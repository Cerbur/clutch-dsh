import type { NativeChangesManager } from '../../../contract/native-changes.js';
import type { DashboardRecord } from '../dashboard-selection.js';

export type NativeChangesResult = 'opened' | 'session-required' | 'session-switching' |
  'unavailable' | 'directory-mismatch' | 'verification-failed' | 'stale';

export interface NativeChangesScreen {
  readonly supported?: boolean;
  readonly sessionId?: string;
  readonly workspaceId?: string;
  readonly cwd?: string;
  readonly ready: boolean;
  readonly mountedSessionId?: string;
}

export interface NativeChangesSidebar {
  /** Must inspect the live native resource registry, rather than assume Forge is installed. */
  accepts(address: string): boolean;
  open(address: string): void;
}

/** Session selection and Host validation are separate from native sidebar navigation. */
export function createNativeChangesNavigation(options: {
  readonly manager: NativeChangesManager;
  readonly screen: () => NativeChangesScreen;
  readonly sidebar: () => NativeChangesSidebar | undefined;
  readonly openSession: (sessionId: string) => void;
}) {
  let disposed = false;
  let inFlight: { key: string; isCurrent: () => boolean; promise: Promise<NativeChangesResult> } | undefined;
  return {
    dispose() { disposed = true; },
    open(record: DashboardRecord, sessionIds: readonly string[], isCurrent: () => boolean,
      openSession = options.openSession): Promise<NativeChangesResult> {
      const key = JSON.stringify([record.workspaceId, record.worktreeId, record.absolutePath]);
      if (inFlight?.key === key && inFlight.isCurrent()) return inFlight.promise;
      const active = () => !disposed && isCurrent();
      const run = async (): Promise<NativeChangesResult> => {
        if (!active()) return 'stale';
        const before = options.screen();
        if (before.supported === false) return 'unavailable';
        // The live current binding includes untouched blank Sessions. Do not filter on blank.
        const candidates = [...new Set([
          ...(before.workspaceId === record.workspaceId && before.sessionId ? [before.sessionId] : []),
          ...sessionIds,
        ])];
        if (!candidates.length) return 'session-required';
        try {
          if (!options.sidebar()?.accepts(`dsh-resource://forge-changes/${encodeURIComponent(candidates[0]!)}/local`)) {
            return 'unavailable';
          }
        } catch { return 'unavailable'; }
        let target: string | undefined;
        try {
          for (const sessionId of candidates) {
            if (await options.manager.canOpenNativeChanges({ workspaceId: record.workspaceId,
              worktreeId: record.worktreeId, sessionId, expectedPath: record.absolutePath })) {
              target = sessionId;
              break;
            }
            if (!active()) return 'stale';
          }
        } catch {
          return active() ? 'verification-failed' : 'stale';
        }
        if (!active()) return 'stale';
        const after = options.screen();
        if (after.supported === false) return 'unavailable';
        // A Session/cwd change during the read cancels this click; never redirect a newer view.
        if (after.sessionId !== before.sessionId || after.cwd !== before.cwd) return 'session-switching';
        if (!target) return 'directory-mismatch';
        if (target !== after.sessionId) {
          openSession(target);
          // openSession is void: list selection and native rightbar adoption are separate commits.
          // Require a fresh click after rendering instead of opening a resource into the old store.
          return 'session-switching';
        }
        if (!after.ready || after.mountedSessionId !== target || !after.cwd) return 'session-switching';
        const address = `dsh-resource://forge-changes/${encodeURIComponent(target)}/local`;
        try {
          const sidebar = options.sidebar();
          if (!sidebar?.accepts(address)) return 'unavailable';
          sidebar.open(address);
          return 'opened';
        } catch (error) {
          return error instanceof Error && error.message === 'sidebarRight: no session surface is mounted'
            ? 'session-switching' : 'unavailable';
        }
      };
      const promise = run().finally(() => {
        if (inFlight?.promise === promise) inFlight = undefined;
      });
      inFlight = { key, isCurrent, promise };
      return promise;
    },
  };
}
