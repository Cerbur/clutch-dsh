import type { WorktreeHostProbeResult } from './worktree-connection.js';

export type RestartNoticeReason = 'host-unavailable';

const MISSING_HOST_CODES = new Set([
  'gateway/service-unavailable',
  'gateway/definition-unavailable',
  'gateway/invocation-unavailable',
]);

/** A transient reminder owned by one Client fiber, independent of ready view content. */
export class RestartNotice {
  private reason?: RestartNoticeReason;
  private readonly notified = new Set<RestartNoticeReason>();
  private disposed = false;
  private pending?: AbortController;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly probe: (signal: AbortSignal) => Promise<WorktreeHostProbeResult>) {}

  getSnapshot = (): boolean => this.reason !== undefined;
  getReasonSnapshot = (): RestartNoticeReason | undefined => this.reason;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  dismiss = (): void => this.setReason(undefined);
  dismissReason = (reason: RestartNoticeReason): void => {
    if (this.reason === reason) this.dismiss();
  };

  async check(): Promise<void> {
    if (this.disposed) return;
    this.pending?.abort();
    const controller = new AbortController();
    this.pending = controller;
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const result = await this.probe(controller.signal);
      if (this.disposed || controller.signal.aborted || this.pending !== controller) return;
      if (result.ok) {
        // Host composition does not establish native preset availability.
        if (this.reason === 'host-unavailable') this.dismiss();
      } else if (MISSING_HOST_CODES.has(result.error?.code ?? '')) {
        this.show('host-unavailable');
      }
    } catch {
      // A transport failure does not establish that a restart is needed.
    } finally {
      clearTimeout(timer);
      if (this.pending === controller) this.pending = undefined;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.reason = undefined;
    this.pending?.abort();
    this.listeners.clear();
  }

  private show(reason: RestartNoticeReason): void {
    if (this.disposed || this.notified.has(reason)) return;
    this.notified.add(reason);
    this.setReason(reason);
  }

  private setReason(reason: RestartNoticeReason | undefined): void {
    if (this.reason === reason || this.disposed) return;
    this.reason = reason;
    for (const listener of this.listeners) listener();
  }
}
