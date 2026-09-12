import type { Context } from '@deepseek-ai/cordis';
import type { Domain } from '@deepseek-ai/dsh-storage-domain';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import type { StreamChunk } from '@deepseek-ai/dsh-llm';
import { z } from 'zod';
import {
  aggregateInputTokens,
  DEFAULT_TITLE_STATS,
  normalizeTokenUsage,
  parseStats,
} from './types.js';
import type { TitleTokenStats, TitleTokenUsage } from './types.js';

export { DEFAULT_TITLE_STATS, parseStats };

export const titleTokenLastUsageRecord = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().optional(),
  cacheWriteTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  timestamp: z.number().int().nonnegative(),
});

export const titleStatsRecord = z.object({
  totalCalls: z.number().int().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  lastUsage: titleTokenLastUsageRecord.optional(),
});

export const titleStatsDomainSpec = defineDomain({
  name: 'clutch_title_stats',
  version: 1,
  global: {
    schema: titleStatsRecord,
    initial: DEFAULT_TITLE_STATS,
  },
  tables: {},
});

export interface TitleStatsStore {
  get(): Promise<TitleTokenStats>;
  getSnapshot(): TitleTokenStats;
  record(usage: TitleTokenUsage): Promise<void>;
  reset(): Promise<TitleTokenStats>;
  close(): Promise<void>;
  ensureDomain(targetCtx?: Context): Promise<Domain<typeof titleStatsDomainSpec> | undefined>;
}

type TitleDomain = Domain<typeof titleStatsDomainSpec>;
type StorageFacility = {
  open: (spec: typeof titleStatsDomainSpec) => Promise<TitleDomain>;
};

type StatsRecorder = Pick<TitleStatsStore, 'record'>;

export const TITLE_STATS_STORAGE_TIMEOUT_MS = 5_000;

function withStorageTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function cloneStats(stats: TitleTokenStats): TitleTokenStats {
  return {
    ...stats,
    ...(stats.lastUsage !== undefined ? { lastUsage: { ...stats.lastUsage } } : {}),
  };
}

function mergeStats(base: TitleTokenStats, addition: TitleTokenStats): TitleTokenStats {
  const baseLastUsage = base.lastUsage;
  const addedLastUsage = addition.lastUsage;
  const lastUsage =
    baseLastUsage === undefined
      ? addedLastUsage
      : addedLastUsage === undefined
        ? baseLastUsage
        : addedLastUsage.timestamp >= baseLastUsage.timestamp
          ? addedLastUsage
          : baseLastUsage;
  return {
    totalCalls: base.totalCalls + addition.totalCalls,
    totalInputTokens: base.totalInputTokens + addition.totalInputTokens,
    totalOutputTokens: base.totalOutputTokens + addition.totalOutputTokens,
    totalTokens: base.totalTokens + addition.totalTokens,
    ...(lastUsage !== undefined ? { lastUsage: { ...lastUsage } } : {}),
  };
}

function statsForUsage(usage: TitleTokenUsage): TitleTokenStats {
  const inputTokens = aggregateInputTokens(usage);
  return {
    totalCalls: 1,
    totalInputTokens: inputTokens,
    totalOutputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    lastUsage: {
      inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
      timestamp: Date.now(),
    },
  };
}

function closedError(): Error {
  return new Error('clutch-dsh-title: TitleStatsStore is closed');
}

async function closeDomain(
  domain: TitleDomain,
  timeoutMs = TITLE_STATS_STORAGE_TIMEOUT_MS,
): Promise<void> {
  try {
    await withStorageTimeout(
      () => Promise.resolve(domain.close()),
      timeoutMs,
      'clutch-dsh-title: storage close timed out',
    );
  } catch {
    // Teardown must not produce an unhandled rejection or block recovery.
  }
}

/** Record every session-title model call without delaying its consumer. */
export function installTitleTokenStatsRecorder(ctx: Context, store: StatsRecorder): void {
  ctx.on(
    'llm/stream',
    (options, next) => {
      if (options.purpose !== 'session-title') return next();
      return recordTitleStream(next(), store);
    },
    { global: true },
  );
}

async function* recordTitleStream(
  source: AsyncIterable<StreamChunk>,
  store: StatsRecorder,
): AsyncGenerator<StreamChunk> {
  let usage: TitleTokenUsage | undefined;
  try {
    for await (const chunk of source) {
      if (chunk.type === 'usage') {
        const normalized = normalizeTokenUsage(chunk.usage);
        if (normalized !== undefined) usage = normalized;
      }
      yield chunk;
    }
  } finally {
    if (usage !== undefined) {
      const recordedUsage = usage;
      void Promise.resolve()
        .then(() => store.record(recordedUsage))
        .catch(() => {
          // Statistics are ancillary and must never fail the model call.
        });
    }
  }
}

export class TitleStatsStoreImpl implements TitleStatsStore {
  private openDomain: TitleDomain | undefined;
  private openFacility: StorageFacility | undefined;
  private memoryStats: TitleTokenStats = { ...DEFAULT_TITLE_STATS };
  private resetPending = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private domainLock: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly ctx: Context,
    private readonly storageTimeoutMs = TITLE_STATS_STORAGE_TIMEOUT_MS,
  ) {
    if (this.ctx && typeof this.ctx.inject === 'function') {
      this.ctx.inject(['storageDomain'], (storageCtx) => {
        void this.ensureDomain(storageCtx).catch(() => {
          // Reads and writes retry through ensureDomain; initialization is best effort.
        });
      });
    } else if (this.ctx && typeof this.ctx.get === 'function' && this.ctx.get('storageDomain')) {
      void this.ensureDomain().catch(() => {
        // Reads and writes retry through ensureDomain; initialization is best effort.
      });
    }
  }

  async ensureDomain(targetCtx?: Context): Promise<TitleDomain | undefined> {
    this.assertActive();
    const ctx = targetCtx ?? this.ctx;
    const facility = this.storageFacility(ctx);
    if (facility === undefined) return undefined;

    return this.withDomainLock(async () => {
      this.assertActive();
      if (this.openDomain !== undefined) {
        if (this.openFacility === facility) {
          const domain = this.openDomain;
          try {
            await this.materializeMemory(domain);
            this.assertActive();
            return domain;
          } catch {
            // The facility may have closed this handle during replacement.
          }
        }
        await this.closeOpenDomain();
        this.assertActive();
      }

      return this.openDomainForFacility(facility);
    });
  }

  getSnapshot(): TitleTokenStats {
    if (this.openDomain !== undefined) {
      try {
        const current = parseStats(this.openDomain.global.get());
        return cloneStats(
          this.resetPending ? this.memoryStats : mergeStats(current, this.memoryStats),
        );
      } catch {
        // A replaced facility may close its handle before its injector callback runs.
      }
    }
    return cloneStats(this.memoryStats);
  }

  async get(): Promise<TitleTokenStats> {
    this.assertActive();
    await this.writeQueue;
    this.assertActive();
    const domain = await this.ensureDomain();
    if (domain !== undefined) return cloneStats(parseStats(domain.global.get()));
    return this.getSnapshot();
  }

  async record(usage: TitleTokenUsage): Promise<void> {
    const normalized = normalizeTokenUsage(usage);
    if (normalized === undefined) {
      throw new TypeError('clutch-dsh-title: invalid token usage');
    }
    const addition = statsForUsage(normalized);
    const run = async () => {
      this.assertActive();
      let domain: TitleDomain | undefined;
      try {
        domain = await this.ensureDomain();
        if (domain !== undefined) {
          const activeDomain = domain;
          const current = parseStats(activeDomain.global.get());
          await withStorageTimeout(
            () => Promise.resolve(activeDomain.global.set(mergeStats(current, addition))),
            this.storageTimeoutMs,
            'clutch-dsh-title: storage write timed out',
          );
        } else {
          this.memoryStats = mergeStats(this.memoryStats, addition);
        }
      } catch (error) {
        if (this.closed) throw error;
        await this.invalidateDomain(domain);
        this.memoryStats = mergeStats(this.memoryStats, addition);
      }
    };
    return this.enqueue(run);
  }

  async reset(): Promise<TitleTokenStats> {
    const run = async (): Promise<TitleTokenStats> => {
      this.assertActive();
      let domain: TitleDomain | undefined;
      try {
        domain = await this.ensureDomain();
        if (domain !== undefined) {
          const activeDomain = domain;
          await withStorageTimeout(
            () => Promise.resolve(activeDomain.global.set({ ...DEFAULT_TITLE_STATS })),
            this.storageTimeoutMs,
            'clutch-dsh-title: storage write timed out',
          );
          this.memoryStats = { ...DEFAULT_TITLE_STATS };
          this.resetPending = false;
        } else {
          this.memoryStats = { ...DEFAULT_TITLE_STATS };
          this.resetPending = true;
        }
      } catch (error) {
        if (this.closed) throw error;
        await this.invalidateDomain(domain);
        this.memoryStats = { ...DEFAULT_TITLE_STATS };
        this.resetPending = true;
      }
      return { ...DEFAULT_TITLE_STATS };
    };
    return this.enqueue(run);
  }

  async close(): Promise<void> {
    if (this.closePromise !== null) return this.closePromise;
    this.closed = true;
    this.closePromise = (async () => {
      await this.writeQueue;
      await this.withDomainLock(async () => {
        if (this.openDomain === undefined) return;
        const domain = this.openDomain;
        try {
          await closeDomain(domain, this.storageTimeoutMs);
        } finally {
          if (this.openDomain === domain) this.openDomain = undefined;
          if (this.openFacility !== undefined) this.openFacility = undefined;
        }
      });
    })();
    return this.closePromise;
  }

  private storageFacility(ctx: Context): StorageFacility | undefined {
    if (!ctx || typeof ctx.get !== 'function') return undefined;
    const facility = ctx.get('storageDomain') as StorageFacility | undefined;
    return facility !== undefined && typeof facility.open === 'function' ? facility : undefined;
  }

  private assertActive(): void {
    if (this.closed) throw closedError();
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const chained = this.writeQueue.then(run, run);
    this.writeQueue = chained.then(
      () => {},
      () => {},
    );
    return chained;
  }

  private withDomainLock<T>(run: () => Promise<T>): Promise<T> {
    const chained = this.domainLock.then(run, run);
    this.domainLock = chained.then(
      () => {},
      () => {},
    );
    return chained;
  }

  private async openDomainForFacility(facility: StorageFacility): Promise<TitleDomain> {
    let domain: TitleDomain | undefined;
    const opening = Promise.resolve().then(() => facility.open(titleStatsDomainSpec));
    try {
      domain = await withStorageTimeout(
        () => opening,
        this.storageTimeoutMs,
        'clutch-dsh-title: storage open timed out',
      );
      this.assertActive();
      this.openDomain = domain;
      this.openFacility = facility;

      await this.materializeMemory(domain);
      this.assertActive();
      return domain;
    } catch (error) {
      if (domain !== undefined) {
        if (this.openDomain === domain) this.openDomain = undefined;
        if (this.openFacility === facility) this.openFacility = undefined;
        await closeDomain(domain, this.storageTimeoutMs);
      } else {
        void opening.then(
          (lateDomain) => closeDomain(lateDomain, this.storageTimeoutMs),
          () => {},
        );
      }
      throw error;
    }
  }

  private async closeOpenDomain(): Promise<void> {
    const domain = this.openDomain;
    if (domain === undefined) return;
    await closeDomain(domain, this.storageTimeoutMs);
    if (this.openDomain === domain) this.openDomain = undefined;
    if (this.openFacility !== undefined) this.openFacility = undefined;
  }

  private async invalidateDomain(domain: TitleDomain | undefined): Promise<void> {
    if (domain === undefined) return;
    await this.withDomainLock(async () => {
      if (this.openDomain !== domain) return;
      await closeDomain(domain, this.storageTimeoutMs);
      if (this.openDomain === domain) this.openDomain = undefined;
      if (this.openFacility !== undefined) this.openFacility = undefined;
    });
  }

  private async materializeMemory(domain: TitleDomain): Promise<void> {
    const current = parseStats(domain.global.get());
    const memory = this.memoryStats;
    if (!this.resetPending && memory.totalCalls === 0) return;
    const base = this.resetPending ? DEFAULT_TITLE_STATS : current;
    await withStorageTimeout(
      () => Promise.resolve(domain.global.set(mergeStats(base, memory))),
      this.storageTimeoutMs,
      'clutch-dsh-title: storage write timed out',
    );
    this.memoryStats = { ...DEFAULT_TITLE_STATS };
    this.resetPending = false;
  }
}

export function createTitleStatsStore(ctx: Context): TitleStatsStore {
  const store = new TitleStatsStoreImpl(ctx);
  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(
      () => async () => {
        await store.close();
      },
      'clutch-dsh-title: TitleStatsStore cleanup',
    );
  }
  return store;
}
