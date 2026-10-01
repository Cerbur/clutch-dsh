import type { Context } from '@deepseek-ai/cordis';
import type { Domain } from '@deepseek-ai/dsh-storage-domain';
import { defineDomain } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import {
  DEFAULT_TITLE_DIAGNOSTICS,
  MAX_DIAGNOSTIC_ATTEMPTS,
  MAX_DIAGNOSTIC_OUTPUT_CHARS,
  MAX_DIAGNOSTIC_ERROR_CHARS,
  MAX_DIAGNOSTIC_ROUTE_CHARS,
  MAX_DIAGNOSTIC_MESSAGE_SEQS,
  MAX_RECENT_INCIDENTS,
  parseDiagnostics,
} from './types.js';
import type { TitleDiagnostics, TitleExtractionIncident } from './types.js';

export const titleDiagnosticsAttemptRecord = z.object({
  attempt: z.number().int().nonnegative(),
  error: z.string().max(MAX_DIAGNOSTIC_ERROR_CHARS),
  output: z.string().max(MAX_DIAGNOSTIC_OUTPUT_CHARS + 32),
});

export const titleDiagnosticsIncidentRecord = z.object({
  timestamp: z.number().int().nonnegative(),
  provider: z.string().max(MAX_DIAGNOSTIC_ROUTE_CHARS),
  model: z.string().max(MAX_DIAGNOSTIC_ROUTE_CHARS),
  messageSeqs: z.array(z.number().int().nonnegative()).max(MAX_DIAGNOSTIC_MESSAGE_SEQS),
  attempts: z.array(titleDiagnosticsAttemptRecord).max(MAX_DIAGNOSTIC_ATTEMPTS),
  recovered: z.boolean(),
  error: z.string().max(MAX_DIAGNOSTIC_ERROR_CHARS),
  repairAttempts: z
    .number()
    .int()
    .min(0)
    .max(MAX_DIAGNOSTIC_ATTEMPTS - 1)
    .optional(),
});

export const titleDiagnosticsRecord = z.object({
  totalIncidents: z.number().int().nonnegative(),
  totalRepairAttempts: z.number().int().nonnegative(),
  totalRecovered: z.number().int().nonnegative(),
  // Legacy v1 records did not bound route/error strings or message-seq arrays.
  // Keep them readable; normalization and the next write enforce the new bounds.
  lastIncident: titleDiagnosticsIncidentRecord
    .extend({
      provider: z.string(),
      model: z.string(),
      error: z.string(),
      messageSeqs: z.array(z.number().int().nonnegative()),
      attempts: z
        .array(titleDiagnosticsAttemptRecord.extend({ error: z.string() }))
        .max(MAX_DIAGNOSTIC_ATTEMPTS),
    })
    .optional(),
  recentIncidents: z.array(titleDiagnosticsIncidentRecord).max(MAX_RECENT_INCIDENTS).optional(),
  lastRepairAt: z.number().int().nonnegative().optional(),
});

export const titleDiagnosticsDomainSpec = defineDomain({
  name: 'clutch_title_diagnostics',
  version: 1,
  global: {
    schema: titleDiagnosticsRecord,
    initial: DEFAULT_TITLE_DIAGNOSTICS,
  },
  tables: {},
});

/** Incidents retained in memory while no storageDomain facility is available. */
export const MAX_PENDING_INCIDENTS = 64;

export interface TitleDiagnosticsStore {
  get(): Promise<TitleDiagnostics>;
  getSnapshot(): TitleDiagnostics;
  record(incident: TitleExtractionIncident): Promise<void>;
  reset(): Promise<TitleDiagnostics>;
  close(): Promise<void>;
  ensureDomain(targetCtx?: Context): Promise<Domain<typeof titleDiagnosticsDomainSpec> | undefined>;
}

type DiagnosticsDomain = Domain<typeof titleDiagnosticsDomainSpec>;
type StorageFacility = {
  open: (spec: typeof titleDiagnosticsDomainSpec) => Promise<DiagnosticsDomain>;
};

export const TITLE_DIAGNOSTICS_STORAGE_TIMEOUT_MS = 5_000;

/** Repair calls a single incident proved were dispatched. */
export function repairCallsOf(incident: TitleExtractionIncident): number {
  if (incident.repairAttempts !== undefined) return incident.repairAttempts;
  // Legacy extraction records contain rejected responses only. Some callers include
  // the successful response (empty error), so avoid counting that twice.
  const last = incident.attempts.at(-1);
  return Math.max((last?.attempt ?? 0) - 1 + (incident.recovered && last?.error ? 1 : 0), 0);
}

function applyIncident(
  base: TitleDiagnostics,
  incident: TitleExtractionIncident,
): TitleDiagnostics {
  return {
    totalIncidents: base.totalIncidents + 1,
    totalRepairAttempts: base.totalRepairAttempts + repairCallsOf(incident),
    totalRecovered: base.totalRecovered + (incident.recovered ? 1 : 0),
    recentIncidents: [incident, ...base.recentIncidents].slice(0, MAX_RECENT_INCIDENTS),
    ...(incident.recovered
      ? { lastRepairAt: Math.max(base.lastRepairAt ?? 0, incident.timestamp) }
      : base.lastRepairAt === undefined
        ? {}
        : { lastRepairAt: base.lastRepairAt }),
  };
}

function foldIncidents(
  base: TitleDiagnostics,
  incidents: readonly TitleExtractionIncident[],
): TitleDiagnostics {
  return incidents.reduce(applyIncident, base);
}

function cloneIncident(incident: TitleExtractionIncident): TitleExtractionIncident {
  return {
    ...incident,
    messageSeqs: [...incident.messageSeqs],
    attempts: incident.attempts.map((attempt) => ({ ...attempt })),
  };
}

function cloneDiagnostics(value: TitleDiagnostics): TitleDiagnostics {
  return {
    ...value,
    recentIncidents: value.recentIncidents.map(cloneIncident),
  };
}

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

function closedError(): Error {
  return new Error('clutch-dsh-title: TitleDiagnosticsStore is closed');
}

async function closeDomain(
  domain: DiagnosticsDomain,
  timeoutMs = TITLE_DIAGNOSTICS_STORAGE_TIMEOUT_MS,
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

export class TitleDiagnosticsStoreImpl implements TitleDiagnosticsStore {
  private openDomain: DiagnosticsDomain | undefined;
  private openFacility: StorageFacility | undefined;
  private pending: TitleExtractionIncident[] = [];
  private resetPending = false;
  private resetRevision = 0;
  private flushPromise: Promise<void> | undefined;
  private pendingWrite: Promise<void> | undefined;
  private writeQueue: Promise<void> = Promise.resolve();
  private domainLock: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly ctx: Context,
    private readonly storageTimeoutMs = TITLE_DIAGNOSTICS_STORAGE_TIMEOUT_MS,
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

  async ensureDomain(targetCtx?: Context): Promise<DiagnosticsDomain | undefined> {
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
            await this.materializePending(domain);
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

  getSnapshot(): TitleDiagnostics {
    const pending = foldIncidents({ ...DEFAULT_TITLE_DIAGNOSTICS }, this.pending);
    if (this.openDomain !== undefined) {
      try {
        const current = this.resetPending
          ? { ...DEFAULT_TITLE_DIAGNOSTICS }
          : parseDiagnostics(this.openDomain.global.get());
        return cloneDiagnostics(foldIncidents(current, this.pending));
      } catch {
        // A replaced facility may close its handle before its injector callback runs.
      }
    }
    return cloneDiagnostics(pending);
  }

  async get(): Promise<TitleDiagnostics> {
    this.assertActive();
    await this.writeQueue;
    this.assertActive();
    await this.ensureDomain();
    return this.getSnapshot();
  }

  async record(incident: TitleExtractionIncident): Promise<void> {
    this.assertActive();
    // Enforce bounds at the storage boundary, including callers other than the extractor.
    const normalized = parseDiagnostics({ recentIncidents: [incident] }).recentIncidents[0];
    if (normalized === undefined) throw new Error('clutch-dsh-title: invalid diagnostic incident');
    // Bound records before any asynchronous storage work. Reuse one flush task;
    // never capture an incident in one queued closure per generation.
    this.pushPending(normalized);
    return this.scheduleFlush();
  }

  async reset(): Promise<TitleDiagnostics> {
    this.assertActive();
    // Establish the reset boundary now so later records survive a queued reset.
    this.pending = [];
    this.resetPending = true;
    this.resetRevision += 1;
    const run = async (): Promise<TitleDiagnostics> => {
      await this.flushPending();
      return { ...DEFAULT_TITLE_DIAGNOSTICS };
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

  private pushPending(incident: TitleExtractionIncident): void {
    this.pending.push(incident);
    if (this.pending.length > MAX_PENDING_INCIDENTS) {
      this.pending.splice(0, this.pending.length - MAX_PENDING_INCIDENTS);
    }
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

  private async openDomainForFacility(facility: StorageFacility): Promise<DiagnosticsDomain> {
    // A replacement caches its snapshot on open. Wait before loading it so a
    // late successful write through the old handle is included in that snapshot.
    await this.settlePendingWrite();
    this.assertActive();
    let domain: DiagnosticsDomain | undefined;
    const opening = Promise.resolve().then(() => facility.open(titleDiagnosticsDomainSpec));
    try {
      domain = await withStorageTimeout(
        () => opening,
        this.storageTimeoutMs,
        'clutch-dsh-title: storage open timed out',
      );
      this.assertActive();
      this.openDomain = domain;
      this.openFacility = facility;

      await this.materializePending(domain);
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

  private scheduleFlush(): Promise<void> {
    if (this.flushPromise === undefined) {
      this.flushPromise = this.enqueue(() => this.flushPending()).then(
        (flushed) => {
          this.flushPromise = undefined;
          if (flushed && !this.closed && (this.pending.length > 0 || this.resetPending))
            return this.scheduleFlush();
        },
        (error: unknown) => {
          this.flushPromise = undefined;
          throw error;
        },
      );
    }
    return this.flushPromise;
  }

  private async flushPending(): Promise<boolean> {
    this.assertActive();
    try {
      // Yield the write queue between batches so a reset is not starved by
      // continuously arriving incidents. scheduleFlush handles the next batch.
      return (await this.ensureDomain()) !== undefined;
    } catch (error) {
      if (this.closed) throw error;
      // The bounded buffer and reset marker survive storage failures. A later
      // read, record or facility injection retries the flush.
      return false;
    }
  }

  private async settlePendingWrite(): Promise<void> {
    // A timeout does not cancel the backend write or its acknowledgement.
    const previousWrite = this.pendingWrite;
    if (previousWrite !== undefined) {
      await withStorageTimeout(
        () => previousWrite,
        this.storageTimeoutMs,
        'clutch-dsh-title: storage write timed out',
      );
    }
  }

  private async materializePending(domain: DiagnosticsDomain): Promise<void> {
    await this.settlePendingWrite();
    if (this.pending.length === 0 && !this.resetPending) return;
    const current = parseDiagnostics(domain.global.get());
    const base = this.resetPending ? { ...DEFAULT_TITLE_DIAGNOSTICS } : current;
    const revision = this.resetRevision;
    const last = this.pending.at(-1);
    const next = foldIncidents(base, this.pending);
    const writing = Promise.resolve()
      .then(() => domain.global.set(next))
      .then(() => {
        if (revision === this.resetRevision) {
          // Acknowledge successful writes even when the caller already timed out.
          // New arrivals, evictions and resets must keep their own pending records.
          const index = last === undefined ? -1 : this.pending.indexOf(last);
          if (index >= 0) this.pending.splice(0, index + 1);
          this.resetPending = false;
        }
      });
    this.pendingWrite = writing;
    const settled = () => {
      if (this.pendingWrite === writing) this.pendingWrite = undefined;
    };
    void writing.then(settled, settled);
    await withStorageTimeout(
      () => writing,
      this.storageTimeoutMs,
      'clutch-dsh-title: storage write timed out',
    );
  }
}

export function createTitleDiagnosticsStore(ctx: Context): TitleDiagnosticsStore {
  const store = new TitleDiagnosticsStoreImpl(ctx);
  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(
      () => async () => {
        await store.close();
      },
      'clutch-dsh-title: TitleDiagnosticsStore cleanup',
    );
  }
  return store;
}
