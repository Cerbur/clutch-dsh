import type { WorktreeHostProbeResult } from './worktree-connection.js';

const MISSING_HOST_CODES = new Set([
  'gateway/service-unavailable',
  'gateway/definition-unavailable',
  'gateway/invocation-unavailable',
]);

/** A transient reminder owned by one Client fiber, independent of ready view content. */
export class RestartNotice {
  private visible = false;
  private notified = false;
  private disposed = false;
  private pending?: AbortController;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly probe: (signal: AbortSignal) => Promise<WorktreeHostProbeResult>) {}

  getSnapshot = (): boolean => this.visible;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  dismiss = (): void => this.setVisible(false);

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
        this.dismiss();
      } else if (!this.notified && MISSING_HOST_CODES.has(result.error?.code ?? '')) {
        this.notified = true;
        this.setVisible(true);
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
    this.pending?.abort();
    this.listeners.clear();
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible || this.disposed) return;
    this.visible = visible;
    for (const listener of this.listeners) listener();
  }
}
