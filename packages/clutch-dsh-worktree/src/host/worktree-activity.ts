import type { WorktreeActivity } from '../contract/index.js';

export interface WorktreeActivitySnapshot {
  readonly complete: boolean;
  readonly busySessionIds: readonly string[];
}

export interface WorktreeActivitySource {
  snapshot(sessionIds: readonly string[]): Promise<WorktreeActivitySnapshot>;
}

export interface WorktreeActivityReaderOptions {
  readonly isDisposed?: () => boolean;
}

export function createDshWorktreeActivityReader(
  source?: WorktreeActivitySource,
  options?: WorktreeActivityReaderOptions,
) {
  return async (sessionIds: readonly string[]): Promise<WorktreeActivity> => {
    if (options?.isDisposed?.()) return { state: 'unknown' };
    if (sessionIds.length === 0) return { state: 'idle' };
    if (source === undefined) return { state: 'unknown' };
    try {
      const value = await source.snapshot([...new Set(sessionIds)]);
      if (options?.isDisposed?.()) return { state: 'unknown' };
      if (value.busySessionIds.length > 0) {
        return { state: 'busy', sessionIds: [...new Set(value.busySessionIds)] };
      }
      return value.complete ? { state: 'idle' } : { state: 'unknown' };
    } catch {
      return { state: 'unknown' };
    }
  };
}
