import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { TitleStatsStore } from '../storage.js';
import type { TitleDiagnosticsStore } from '../diagnostics.js';
import type { TitleDiagnostics, TitleTokenStats } from '../types.js';

/**
 * Host Remote service providing session title token usage statistics over Typert Gateway.
 */
export class TitleRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly statsStore: TitleStatsStore,
    private readonly diagnosticsStore?: TitleDiagnosticsStore,
  ) {
    super(ctx, 'titleRemote', { namespace: 'titleStats' });
  }

  @Remote
  getStats(signal: AbortSignal): Promise<TitleTokenStats> {
    signal.throwIfAborted();
    return this.statsStore.get();
  }

  @Remote
  resetStats(signal: AbortSignal): Promise<TitleTokenStats> {
    signal.throwIfAborted();
    return this.statsStore.reset();
  }

  @Remote
  getDiagnostics(signal: AbortSignal): Promise<TitleDiagnostics> {
    signal.throwIfAborted();
    if (this.diagnosticsStore === undefined) {
      throw new Error('clutch-dsh-title: diagnostics storage is not composed');
    }
    return this.diagnosticsStore.get();
  }

  @Remote
  resetDiagnostics(signal: AbortSignal): Promise<TitleDiagnostics> {
    signal.throwIfAborted();
    if (this.diagnosticsStore === undefined) {
      throw new Error('clutch-dsh-title: diagnostics storage is not composed');
    }
    return this.diagnosticsStore.reset();
  }
}
