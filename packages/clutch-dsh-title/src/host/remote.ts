import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { TitleStatsStore } from '../storage.js';
import type { TitleTokenStats } from '../types.js';

/**
 * Host Remote service providing session title token usage statistics over Typert Gateway.
 */
export class TitleRemoteService extends TypertRemoteService {
  static inject = ['storageDomain'];

  constructor(
    ctx: Context,
    private readonly statsStore: TitleStatsStore,
  ) {
    super(ctx, 'titleRemote', { namespace: 'titleStats' });
  }

  @Remote
  getStats(): Promise<TitleTokenStats> {
    return this.statsStore.get();
  }

  @Remote
  resetStats(): Promise<TitleTokenStats> {
    return this.statsStore.reset();
  }
}
