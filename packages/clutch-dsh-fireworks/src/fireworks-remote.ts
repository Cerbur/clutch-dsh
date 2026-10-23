import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { FireworksEventBatch, FireworksResumeCursor } from './contract/index.js';
import { FireworksEventFeed } from './fireworks-events.js';
import type { AnimationSaveRequest } from './animation.js';
import type { AnimationLibrary } from './animation-library.js';

/** Plugin-owned endpoint; the native Gateway owns its physical carrier. */
export class FireworksRemoteService extends TypertRemoteService {
  private library?: AnimationLibrary;
  setAnimationLibrary(library: AnimationLibrary): () => void {
    this.library = library;
    return () => {
      if (this.library === library) this.library = undefined;
    };
  }
  private animationLibrary(): AnimationLibrary {
    if (this.ctx.invocation?.peer.principal.kind !== 'owner')
      throw new Error('clutch_fireworks: owner required');
    if (!this.library)
      throw new Error('动画设置不可用，请重启 DSH / Restart DSH to load animation settings');
    return this.library;
  }
  loadAnimations(signal: AbortSignal) {
    return this.animationLibrary().load(signal);
  }
  saveAnimations(request: AnimationSaveRequest, signal: AbortSignal) {
    return this.animationLibrary().save(request, signal);
  }
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
