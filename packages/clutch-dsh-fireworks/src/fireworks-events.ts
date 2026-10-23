import { randomUUID } from 'node:crypto';
import {
  FIREWORKS_EVENT_LIMIT,
  type FireworksEventBatch,
  type FireworksLaunchEvent,
  type FireworksResumeCursor,
} from './contract/index.js';

/** Bounded transient replay shared by all native Remote subscribers. No idle timers. */
export class FireworksEventFeed {
  readonly epoch = randomUUID();
  private cursor = 0;
  private entries: { cursor: number; event: FireworksLaunchEvent }[] = [];
  private readonly subscribers = new Set<() => void>();
  private disposed = false;

  constructor(private readonly now: () => number = Date.now) {}

  publish(event: FireworksLaunchEvent): void {
    if (this.disposed || event.expiresAt <= this.now()) return;
    this.entries = this.entries.filter((entry) => entry.event.expiresAt > this.now());
    if (
      this.entries.some(
        (entry) => entry.event.sessionId === event.sessionId && entry.event.id === event.id,
      )
    )
      return;
    this.entries.push({ cursor: ++this.cursor, event });
    this.entries = this.entries.slice(-FIREWORKS_EVENT_LIMIT);
    for (const wake of [...this.subscribers]) wake();
  }

  private read(epoch?: string, cursor?: number): FireworksEventBatch {
    const baseline = epoch !== this.epoch || cursor === undefined || cursor > this.cursor;
    return {
      epoch: this.epoch,
      cursor: this.cursor,
      events: baseline
        ? []
        : this.entries
            .filter((entry) => entry.cursor > cursor && entry.event.expiresAt > this.now())
            .map((entry) => entry.event),
    };
  }

  async *open(
    query: FireworksResumeCursor,
    signal: AbortSignal,
  ): AsyncGenerator<FireworksEventBatch> {
    signal.throwIfAborted();
    if (this.disposed) throw new Error('clutch_fireworks: feed disposed');
    let resume: (() => void) | undefined;
    const wake = () => {
      resume?.();
      resume = undefined;
    };
    this.subscribers.add(wake);
    signal.addEventListener('abort', wake, { once: true });
    let epoch = query.epoch;
    let cursor = query.after;
    try {
      // Capture before yielding: slow consumers coalesce from the shared feed.
      const baseline = this.read(epoch, cursor);
      epoch = baseline.epoch;
      cursor = baseline.cursor;
      yield baseline;
      while (!this.disposed && !signal.aborted) {
        const batch = this.read(epoch, cursor);
        if (batch.cursor !== cursor) {
          cursor = batch.cursor;
          yield batch;
        } else {
          await new Promise<void>((resolve) => {
            resume = resolve;
          });
        }
      }
    } finally {
      this.subscribers.delete(wake);
      signal.removeEventListener('abort', wake);
      wake();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.entries = [];
    for (const wake of [...this.subscribers]) wake();
    this.subscribers.clear();
  }
}
