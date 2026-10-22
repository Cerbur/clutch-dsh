import { randomUUID } from 'node:crypto';
import { clientRequestSchema, type HostConnectionHandle } from '@deepseek-ai/dsh-client-connection';
import {
  FIREWORKS_EVENT_LIMIT,
  FIREWORKS_CONNECTION_CHANNEL,
  FIREWORKS_EVENTS_ENDPOINT,
  FIREWORKS_POLL_TIMEOUT_MS,
  type FireworksEventBatch,
  type FireworksLaunchEvent,
  type FireworksPollRequest,
} from './contract/index.js';

interface FeedEntry {
  readonly cursor: number;
  readonly event: FireworksLaunchEvent;
}

/** Transient Host-wide event feed. Opening a new subscriber never replays history. */
export class FireworksEventFeed {
  readonly epoch = randomUUID();
  private cursor = 0;
  private entries: FeedEntry[] = [];
  private readonly waiters = new Set<() => void>();
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
    for (const wake of [...this.waiters]) wake();
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

  async poll(epoch?: string, cursor?: number, signal?: AbortSignal): Promise<FireworksEventBatch> {
    signal?.throwIfAborted();
    if (this.disposed) throw new Error('clutch_fireworks: feed disposed');
    if (epoch !== this.epoch || cursor !== this.cursor) return this.read(epoch, cursor);
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        signal?.removeEventListener('abort', finish);
        if (signal?.aborted) reject(signal.reason);
        else if (this.disposed) reject(new Error('clutch_fireworks: feed disposed'));
        else resolve(this.read(epoch, cursor));
      };
      const timer = setTimeout(finish, FIREWORKS_POLL_TIMEOUT_MS);
      timer.unref?.();
      this.waiters.add(finish);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.entries = [];
    for (const wake of [...this.waiters]) wake();
  }
}

/** Register on Connection's authenticated shared route; never mount a private WebServer. */
export function registerFireworksEvents(
  connection: Pick<HostConnectionHandle, 'fetch'>,
  feed: FireworksEventFeed,
): () => Promise<void> {
  return connection.fetch.register({
    path: FIREWORKS_CONNECTION_CHANNEL + '/' + FIREWORKS_EVENTS_ENDPOINT,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const failure = (code: string, message: string) => ({
        ok: false as const,
        error: { code: 'clutch_fireworks/' + code, message, details: {} },
      });
      let raw: unknown;
      try {
        raw = await request.json();
      } catch {
        return Response.json(failure('invalid-request', 'Expected a JSON RPC request'), {
          status: 400,
        });
      }
      const parsed = clientRequestSchema.safeParse(raw);
      if (!parsed.success)
        return Response.json(failure('invalid-request', 'Invalid RPC envelope'), { status: 400 });
      const message = parsed.data;
      const reply = (result: unknown) =>
        Response.json({
          type: 'server-response',
          rpcId: message.rpcId,
          result,
        });
      if (message.method !== FIREWORKS_EVENTS_ENDPOINT)
        return reply(failure('not-found', 'Unknown fireworks endpoint'));
      const query = message.payload as FireworksPollRequest | null;
      if (
        query === null ||
        typeof query !== 'object' ||
        Array.isArray(query) ||
        Object.keys(query).some((key) => key !== 'epoch' && key !== 'after') ||
        (query.epoch === undefined) !== (query.after === undefined) ||
        (query.epoch !== undefined &&
          (typeof query.epoch !== 'string' || query.epoch.length === 0)) ||
        (query.after !== undefined && (!Number.isSafeInteger(query.after) || query.after < 0))
      )
        return reply(failure('invalid-cursor', 'Invalid fireworks cursor'));
      try {
        return reply({
          ok: true,
          value: await feed.poll(query.epoch, query.after, request.signal),
        });
      } catch {
        return reply(failure('unavailable', 'Fireworks feed unavailable'));
      }
    },
  });
}
