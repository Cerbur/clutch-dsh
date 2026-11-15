import { nativeDiffReporter, nativeDiffRequest, NativeDiffRequestTimeout, waitNativeDiffPoll } from './native-diff-wait.js';
import type { NativeDiffDiagnostic } from './native-diff-wait.js';

export const NATIVE_FORGE_BUNDLE = '@deepseek-ai/dsh-experimental-forge-bundle';

export interface NativeForgeState {
  readonly enabled: boolean;
  readonly manageable: boolean;
}

export type NativeForgeApplication = 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled';
export interface NativeForgeManager {
  readNativeForge(signal: AbortSignal): Promise<NativeForgeState | undefined>;
  enableNativeForge(signal: AbortSignal): Promise<NativeForgeApplication>;
}
export type ConfirmNativeForge = (signal: AbortSignal) => Promise<boolean>;
export type NativeForgeResult = 'ready' | 'cancelled' | 'stale' | 'unavailable' |
  'forge-enable-failed' | 'forge-restart-required' | 'forge-overridden' | 'forge-timeout' |
  'forge-state-timeout' | 'forge-enable-timeout';

/** Only a user action calls this flow. Selection belongs to DSH and is never rolled back. */
export async function ensureNativeForge(options: {
  manager: NativeForgeManager;
  ready: () => boolean;
  confirm?: ConfirmNativeForge;
  signal: AbortSignal;
  isCurrent?: () => boolean;
  timeoutMs?: number;
  recoveryTimeoutMs?: number;
  pollMs?: number;
  onDiagnostic?: (event: NativeDiffDiagnostic) => void;
}): Promise<NativeForgeResult> {
  const { manager, ready, confirm, signal } = options;
  const retired = () => signal.aborted || options.isCurrent?.() === false;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const report = nativeDiffReporter(options.onDiagnostic);
  const waitForRegistration = async (limit: number): Promise<boolean> => {
    const deadline = Date.now() + limit;
    while (!retired()) {
      if (ready()) return true;
      if (Date.now() >= deadline) return false;
      await waitNativeDiffPoll(signal, Math.min(options.pollMs ?? 100, deadline - Date.now()));
    }
    return false;
  };
  // Bound each management request independently; a confirmation has no time limit.
  const request = <T,>(run: (signal: AbortSignal) => Promise<T>) => nativeDiffRequest(signal, timeoutMs, run);
  try {
    if (retired()) return 'stale';
    if (ready()) return 'ready';
    let state = await request((signal) => manager.readNativeForge(signal));
    report('selection-read');
    if (retired()) return 'stale';
    if (!state || !state.manageable) return 'unavailable';
    if (!state.enabled) {
      if (!confirm) return 'unavailable';
      if (!await confirm(signal)) return retired() ? 'stale' : 'cancelled';
      report('confirmed');
      if (retired()) return 'stale';
      // Another window may have enabled it while the confirmation was open.
      state = await request((signal) => manager.readNativeForge(signal));
      if (retired()) return 'stale';
      if (!state || !state.manageable) return 'unavailable';
      if (!state.enabled) {
        let application: NativeForgeApplication;
        try {
          application = await request((signal) => manager.enableNativeForge(signal));
        } catch (error) {
          if (retired()) return 'stale';
          // Aborting the RPC does not undo a saved Host mutation. Recover from a lost
          // response by observing registration AND rereading selection, never resending.
          report('enable-response-lost', error instanceof NativeDiffRequestTimeout ? 'timeout' : 'transport-error');
          if (!await waitForRegistration(options.recoveryTimeoutMs ?? timeoutMs)) {
            return retired() ? 'stale' : 'forge-enable-timeout';
          }
          let saved: NativeForgeState | undefined;
          try { saved = await request((signal) => manager.readNativeForge(signal)); }
          catch (error) {
            return retired() ? 'stale' : error instanceof NativeDiffRequestTimeout ? 'forge-enable-timeout' : 'forge-enable-failed';
          }
          if (retired()) return 'stale';
          if (!saved?.enabled || !saved.manageable || !ready()) return 'forge-enable-failed';
          report('enable-reconciled');
          return 'ready';
        }
        report('enable-response', application);
        if (retired()) return 'stale';
        if (application === 'restart-required') return 'forge-restart-required';
        if (application === 'overridden') return 'forge-overridden';
        if (application !== 'applied') return 'forge-enable-failed';
      }
    }
    // Host success does not imply that the browser has mounted the native definition.
    if (await waitForRegistration(timeoutMs)) { report('registered'); return 'ready'; }
    return retired() ? 'stale' : 'forge-timeout';
  } catch (error) {
    return retired() ? 'stale' : error instanceof NativeDiffRequestTimeout ? 'forge-state-timeout' : 'forge-enable-failed';
  }
}
