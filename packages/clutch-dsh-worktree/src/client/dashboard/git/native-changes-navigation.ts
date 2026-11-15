import type { NativeChangesManager } from '../../../contract/native-changes.js';
import type { DashboardRecord } from '../dashboard-selection.js';
import type { ConfirmNativeForge, NativeForgeResult } from './native-forge-activation.js';
import { nativeDiffReporter, nativeDiffRequest, NativeDiffRequestTimeout, waitNativeDiffPoll } from './native-diff-wait.js';
import type { NativeDiffDiagnostic } from './native-diff-wait.js';

export type NativeChangesResult = 'opened' | 'session-required' | 'session-switching' |
  'unavailable' | 'directory-mismatch' | 'verification-failed' | 'verification-timeout' |
  'session-ready-timeout' | Exclude<NativeForgeResult, 'ready'>;

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
  readonly ensureAvailable?: (address: string, confirm: ConfirmNativeForge | undefined,
    signal: AbortSignal, isCurrent: () => boolean) => Promise<NativeForgeResult>;
  readonly readyTimeoutMs?: number;
  readonly verificationTimeoutMs?: number;
  readonly pollMs?: number;
  readonly onDiagnostic?: (event: NativeDiffDiagnostic) => void;
  readonly syncBase?: (record: DashboardRecord, sessionId: string, address: string,
    isCurrent: () => boolean, signal: AbortSignal, baseBranch: string | undefined) => Promise<unknown>;
}) {
  let disposed = false;
  const pending = new Set<AbortController>();
  let inFlight: { key: string; isCurrent: () => boolean; promise: Promise<NativeChangesResult> } | undefined;
  return {
    dispose() { disposed = true; for (const controller of pending) controller.abort(); },
    open(record: DashboardRecord, sessionIds: readonly string[], isCurrent: () => boolean,
      openSession = options.openSession, confirm?: ConfirmNativeForge,
      baseSelection?: { readonly baseBranch?: string }): Promise<NativeChangesResult> {
      // An explicit empty selection (Main's None) must not reuse the saved Base.
      const baseBranch = baseSelection === undefined ? record.baseBranch : baseSelection.baseBranch;
      const key = JSON.stringify([record.workspaceId, record.worktreeId, record.absolutePath, baseBranch]);
      if (inFlight?.key === key && inFlight.isCurrent()) return inFlight.promise;
      const active = () => !disposed && isCurrent();
      const report = nativeDiffReporter(options.onDiagnostic);
      const controller = new AbortController();
      pending.add(controller);
      const timer = setInterval(() => { if (!active()) controller.abort(); }, 100);
      controller.signal.addEventListener('abort', () => clearInterval(timer), { once: true });
      const run = async (): Promise<NativeChangesResult> => {
        if (!active()) return 'stale';
        const before = options.screen();
        let activated = false;
        let expectedCwd = before.cwd;
        let readyDeadline = 0;
        let reportedWait = false;
        let waitingForCurrent = false;
        const moved = (screen: NativeChangesScreen) => {
          if (screen.sessionId !== before.sessionId) { report('session-changed'); return true; }
          if (expectedCwd !== undefined && screen.cwd !== undefined && screen.cwd !== expectedCwd) {
            report('directory-changed');
            return true;
          }
          return false;
        };
        const pauseForMount = async (): Promise<NativeChangesResult | undefined> => {
          if (!activated) return 'session-switching';
          if (Date.now() >= readyDeadline) return 'session-ready-timeout';
          if (!reportedWait) { reportedWait = true; report('session-mount-wait'); }
          await waitNativeDiffPoll(controller.signal, Math.min(options.pollMs ?? 100, readyDeadline - Date.now()));
          return undefined;
        };
        if (before.supported === false) return 'unavailable';
        // The live current binding includes untouched blank Sessions. Do not filter on blank.
        const candidates = [...new Set([
          ...(before.workspaceId === record.workspaceId && before.sessionId ? [before.sessionId] : []),
          ...sessionIds,
        ])];
        if (!candidates.length) return 'session-required';
        try {
          const sidebar = options.sidebar();
          if (!sidebar) return 'unavailable';
          const address = `dsh-resource://forge-changes/${encodeURIComponent(candidates[0]!)}/local`;
          if (!sidebar.accepts(address)) {
            if (!options.ensureAvailable) return 'unavailable';
            report('activation-start');
            const result = await options.ensureAvailable(address, confirm, controller.signal, active);
            if (!active()) return 'stale';
            if (result !== 'ready') return result;
            activated = true;
            readyDeadline = Date.now() + (options.readyTimeoutMs ?? 15_000);
          }
        } catch { return 'unavailable'; }
        // Registration and Session-store adoption are independent. A newly enabled
        // provider may register while the same Session is still loading/remounting.
        // Resolve the authorized target first: an unrelated/current-absent surface
        // must not block selecting a retained candidate. Each retry after readiness
        // validates the directory again; no pre-wait Host result is reused.
        while (active()) {
          if (activated) {
            const current = options.screen();
            if (current.supported === false) return 'unavailable';
            if (moved(current)) return 'session-switching';
            if (waitingForCurrent && (!current.ready || current.mountedSessionId !== before.sessionId || !current.cwd)) {
              const result = await pauseForMount();
              if (result) return result;
              continue;
            }
            expectedCwd ??= current.cwd;
          }
          let target: string | undefined;
          try {
            for (const sessionId of candidates) {
              if (await nativeDiffRequest(controller.signal, options.verificationTimeoutMs ?? 15_000,
                (signal) => options.manager.canOpenNativeChanges({ workspaceId: record.workspaceId,
                  worktreeId: record.worktreeId, sessionId, expectedPath: record.absolutePath }, signal))) {
                target = sessionId;
                break;
              }
              if (!active()) return 'stale';
            }
          } catch (error) {
            report('directory-verification-failed');
            return !active() ? 'stale' : error instanceof NativeDiffRequestTimeout ? 'verification-timeout' : 'verification-failed';
          }
          if (!active()) return 'stale';
          const after = options.screen();
          if (after.supported === false) return 'unavailable';
          // A Session/cwd change during the read cancels this click; never redirect a newer view.
          if (moved(after) || (!activated && after.cwd !== before.cwd)) return 'session-switching';
          if (!target) return 'directory-mismatch';
          if (target !== after.sessionId) {
            report('session-selected');
            openSession(target);
            // openSession is void: list selection and native rightbar adoption are separate commits.
            // Require a fresh click after rendering instead of opening a resource into the old store.
            return 'session-switching';
          }
          if (!after.ready || after.mountedSessionId !== target || !after.cwd) {
            waitingForCurrent = true;
            const result = await pauseForMount();
            if (result) return result;
            continue;
          }
          if (expectedCwd === undefined) {
            // The first published cwd is not correlated with the completed Host
            // read. Pin it, then authorize again; never use that earlier success.
            expectedCwd = after.cwd;
            continue;
          }
          const address = `dsh-resource://forge-changes/${encodeURIComponent(target)}/local`;
          try {
            const sidebar = options.sidebar();
            if (!sidebar?.accepts(address)) return 'unavailable';
            sidebar.open(address);
            if (options.syncBase) {
              const sameTarget = () => {
                const screen = options.screen();
                return active() && screen.sessionId === target && screen.mountedSessionId === target &&
                  screen.ready && screen.cwd === after.cwd;
              };
              try { await options.syncBase(record, target, address, sameTarget, controller.signal, baseBranch); }
              catch { /* Optional Forge compatibility bridge must not break native navigation. */ }
            }
            return 'opened';
          } catch (error) {
            if (!(error instanceof Error) || error.message !== 'sidebarRight: no session surface is mounted') return 'unavailable';
            waitingForCurrent = true;
            const result = await pauseForMount();
            if (result) return result;
          }
        }
        return 'stale';
      };
      const promise = run().then((result) => {
        report('navigation-finished', result);
        return result;
      }).finally(() => {
        clearInterval(timer);
        pending.delete(controller);
        controller.abort();
        if (inFlight?.promise === promise) inFlight = undefined;
      });
      inFlight = { key, isCurrent, promise };
      return promise;
    },
  };
}
