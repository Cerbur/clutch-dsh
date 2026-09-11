import { decodeTemplates, templateMutation } from '../templates.js';
import type { TemplateAction, TemplateOp, TemplateState } from '../templates.js';
import { DEFAULT_TITLE_STATS } from '../types.js';
import type { TitleTokenStats } from '../types.js';

export const TITLE_STATS_TIMEOUT_MS = 5_000;

export interface SettingsSnapshot {
  writable: boolean;
  revision: number;
  raw: unknown;
}
export interface TemplateOperations {
  read(): Promise<SettingsSnapshot>;
  write(ops: TemplateOp[], revision: number): Promise<void>;
  getStats?(): Promise<TitleTokenStats>;
  resetStats?(): Promise<TitleTokenStats>;
  /** Set false when reset availability still needs a remote capability check. */
  resetStatsAvailable?: boolean;
}
export interface PageState {
  status: 'idle' | 'ready' | 'error';
  busy: boolean;
  writable: boolean;
  revision: number;
  templates: TemplateState;
  stats: TitleTokenStats;
  error?: string;
}

function withTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

export class TemplateStore {
  private state: PageState = {
    status: 'idle',
    busy: false,
    writable: false,
    revision: 0,
    templates: decodeTemplates(),
    stats: DEFAULT_TITLE_STATS,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private readonly resetConfigured: boolean;
  private resetAvailable: boolean;
  constructor(
    private operations: TemplateOperations,
    private readonly statsTimeoutMs = TITLE_STATS_TIMEOUT_MS,
  ) {
    this.resetConfigured = operations.resetStats !== undefined;
    this.resetAvailable = this.resetConfigured && operations.resetStatsAvailable !== false;
  }
  getSnapshot = (): PageState => this.state;
  get canResetStats(): boolean {
    return this.resetConfigured && this.resetAvailable;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(next: Partial<PageState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private setResetAvailable(available: boolean): void {
    const next = this.resetConfigured && available;
    if (this.resetAvailable === next) return;
    this.resetAvailable = next;
    this.update({});
  }
  async load(): Promise<void> {
    const generation = ++this.generation;
    try {
      const [snapshot, stats] = await Promise.all([
        this.operations.read(),
        this.operations.getStats
          ? withTimeout(
              () => this.operations.getStats!(),
              this.statsTimeoutMs,
              'clutch-dsh-title: statistics read timed out',
            ).then(
              (value) => {
                if (generation === this.generation) this.setResetAvailable(true);
                return value;
              },
              () => {
                if (generation === this.generation) this.setResetAvailable(false);
                return this.state.stats;
              },
            )
          : Promise.resolve(this.state.stats),
      ]);
      if (generation !== this.generation) return;
      const templates = decodeTemplates(snapshot.raw);
      this.update({
        status: 'ready',
        writable: snapshot.writable,
        revision: snapshot.revision,
        templates,
        stats,
        error: undefined,
      });
    } catch (error) {
      if (generation === this.generation)
        this.update({
          status: 'error',
          writable: false,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }
  async resetStats(): Promise<TitleTokenStats> {
    if (this.state.busy) throw new Error('Settings are busy.');
    if (!this.canResetStats) {
      throw new Error('clutch-dsh-title: statistics reset is unavailable');
    }
    const generation = ++this.generation;
    this.update({ busy: true });
    try {
      const next = await withTimeout(
        () => this.operations.resetStats!(),
        this.statsTimeoutMs,
        'clutch-dsh-title: statistics reset timed out',
      );
      if (generation === this.generation) this.update({ stats: next });
      return next;
    } catch (error) {
      if (generation === this.generation) this.setResetAvailable(false);
      throw error;
    } finally {
      this.update({ busy: false });
    }
  }
  async write(action: TemplateAction, revision: number): Promise<void> {
    if (!this.state.writable || this.state.busy) throw new Error('Settings are read-only or busy.');
    const ops = templateMutation(this.state.templates, action);
    if (ops.length === 0) return;
    this.update({ busy: true });
    try {
      await this.operations.write(ops, revision);
      await this.load();
    } finally {
      this.update({ busy: false });
    }
  }
}
