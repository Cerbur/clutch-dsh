import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { FireworksEventBatch, FireworksResumeCursor } from './contract/index.js';
import { FireworksEventFeed } from './fireworks-events.js';

/** Plugin-owned endpoint; the native Gateway owns its physical carrier. */
export class FireworksRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly feed: FireworksEventFeed,
  ) {
    super(ctx, 'clutch_fireworks');
  }

  events(query: FireworksResumeCursor, signal: AbortSignal): AsyncIterable<FireworksEventBatch> {
    // A global feed includes multiple Sessions, even for broadly granted peers.
    if (this.ctx.invocation?.peer.principal.kind !== 'owner')
      throw new Error('clutch_fireworks: owner required');
    return this.feed.open(query, signal);
  }
}
