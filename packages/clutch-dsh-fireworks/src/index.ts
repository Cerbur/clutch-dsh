import type { Context } from '@deepseek-ai/cordis';
import {
  FIREWORKS_GUIDANCE_PROMPT,
  FIREWORKS_GUIDANCE_SECTION_NAME,
  FIREWORKS_GUIDANCE_SECTION_ORDER,
  FIREWORKS_EVENT_TTL_MS,
  FIREWORKS_LAUNCH_EVENT,
} from './contract/index.js';
import {
  applyFireworksProjection,
  createFireworksProjectionDefinition,
} from './fireworks-projection.js';
import { happyFireworksTool } from './fireworks-tool.js';
import { FireworksEventFeed, registerFireworksEvents } from './fireworks-events.js';

export * from './contract/index.js';
export { createFireworksProjectionDefinition } from './fireworks-projection.js';
export { happyFireworksTool } from './fireworks-tool.js';

export const name = 'clutch-dsh-fireworks';
export const inject = ['tools'];

export function apply(ctx: Context): void {
  ctx.inject(['connection'], (connectionContext) => {
    const feed = new FireworksEventFeed();
    connectionContext.on(FIREWORKS_LAUNCH_EVENT, (event) => feed.publish(event));
    connectionContext.on('session/event', (session, event) => {
      const signal = applyFireworksProjection(null, event);
      if (signal === null) return;
      const issuedAt = Date.now();
      connectionContext.emit(FIREWORKS_LAUNCH_EVENT, {
        ...signal,
        type: FIREWORKS_LAUNCH_EVENT,
        sessionId: String(session.id),
        issuedAt,
        expiresAt: issuedAt + FIREWORKS_EVENT_TTL_MS,
      });
    });
    connectionContext.effect(() => {
      const unregister = registerFireworksEvents(connectionContext.connection, feed);
      return async () => {
        feed.dispose();
        await unregister();
      };
    });
  });
  ctx.inject(['sessionProjections'], (projectionContext) => {
    projectionContext.sessionProjections.register(createFireworksProjectionDefinition());
  });
  ctx.inject(['systemPrompt'], (promptContext) => {
    promptContext.systemPrompt?.section({
      name: FIREWORKS_GUIDANCE_SECTION_NAME,
      order: FIREWORKS_GUIDANCE_SECTION_ORDER,
      text: FIREWORKS_GUIDANCE_PROMPT,
    });
  });
  ctx.tools.register(happyFireworksTool);
}
