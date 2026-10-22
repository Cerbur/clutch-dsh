import {
  FIREWORKS_DURATION_MS,
  FIREWORKS_EVENT_LIMIT,
  FIREWORKS_TOAST_DURATION_MS,
  parseFireworksEventBatch,
  type FireworksLaunchEvent,
  type FireworksPollRequest,
} from '../contract/index.js';

export interface FireworksSnapshot {
  readonly burst?: FireworksLaunchEvent;
  readonly toast?: FireworksLaunchEvent;
}

export type FireworksPoll = (query: FireworksPollRequest, signal: AbortSignal) => Promise<unknown>;

/** Own transport and playback outside the selected Session and React render lifecycle. */
export class FireworksController {
  private snapshot: FireworksSnapshot = {};
  private readonly listeners = new Set<() => void>();
  private readonly seen = new Map<string, number>();
  private pending: FireworksLaunchEvent[] = [];
  private burstTimer?: ReturnType<typeof setTimeout>;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private connection?: AbortController;

  constructor(
    private readonly request: FireworksPoll,
    private readonly now: () => number = Date.now,
  ) {}

  readonly getSnapshot = (): FireworksSnapshot => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(snapshot: FireworksSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  accept(events: readonly FireworksLaunchEvent[]): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= this.now()) this.seen.delete(key);
    }
    for (const event of events) {
      const key = JSON.stringify([event.sessionId, event.id]);
      if (event.expiresAt <= this.now() || this.seen.has(key)) continue;
      this.seen.set(key, event.expiresAt);
      this.pending.push(event);
    }
    this.pending = this.pending.slice(-FIREWORKS_EVENT_LIMIT);
    while (this.seen.size > FIREWORKS_EVENT_LIMIT) {
      this.seen.delete(this.seen.keys().next().value!);
    }
    if (this.snapshot.burst === undefined) this.next();
  }

  private next(): void {
    let event: FireworksLaunchEvent | undefined;
    do {
      event = this.pending.shift();
    } while (event !== undefined && event.expiresAt <= this.now());
    if (event === undefined) {
      this.publish({ ...this.snapshot, burst: undefined });
      return;
    }
    clearTimeout(this.toastTimer);
    this.publish({ burst: event, toast: event });
    this.burstTimer = setTimeout(() => this.next(), FIREWORKS_DURATION_MS);
    this.toastTimer = setTimeout(() => this.dismissToast(), FIREWORKS_TOAST_DURATION_MS);
  }

  readonly dismissToast = (): void => {
    clearTimeout(this.toastTimer);
    this.publish({ ...this.snapshot, toast: undefined });
  };

  start(): () => void {
    this.stop();
    const connection = new AbortController();
    this.connection = connection;
    void this.poll(connection.signal);
    return () => {
      if (this.connection === connection) this.stop();
    };
  }

  private async poll(signal: AbortSignal): Promise<void> {
    let epoch: string | undefined;
    let cursor: number | undefined;
    while (!signal.aborted) {
      const request = new AbortController();
      const abort = () => request.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 35_000);
      let failed = false;
      try {
        const query = epoch === undefined ? {} : { epoch, after: cursor };
        const batch = parseFireworksEventBatch(await this.request(query, request.signal));
        if (signal.aborted) return;
        // Initial/restarted Host baselines are silent, even if a malformed peer includes events.
        if (epoch === batch.epoch && cursor !== undefined && batch.cursor >= cursor) {
          this.accept(batch.events);
        }
        epoch = batch.epoch;
        cursor = batch.cursor;
      } catch {
        failed = true;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
      }
      if (failed && !signal.aborted) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', finish);
            resolve();
          };
          const timer = setTimeout(finish, 1_000);
          signal.addEventListener('abort', finish, { once: true });
        });
      }
    }
  }

  stop(): void {
    this.connection?.abort();
    this.connection = undefined;
    clearTimeout(this.burstTimer);
    clearTimeout(this.toastTimer);
    this.pending = [];
    this.seen.clear();
    this.publish({});
  }
}
