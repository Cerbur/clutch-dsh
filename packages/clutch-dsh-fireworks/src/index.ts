import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { DEFAULT_STORED_ANIMATION_PREFERENCES } from './animation.js';
import { AnimationFiles } from './animation-files.js';
import { AnimationLibrary, type AnimationSettingsPort } from './animation-library.js';
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
import { FireworksEventFeed } from './fireworks-events.js';
import { FireworksRemoteService } from './fireworks-remote.js';
import { FIREWORKS_HOST } from './remote-contract.js';
import type {} from '@deepseek-ai/dsh-typert-registry';

export * from './contract/index.js';
export { createFireworksProjectionDefinition } from './fireworks-projection.js';
export { happyFireworksTool } from './fireworks-tool.js';

export const name = 'clutch-dsh-fireworks';
export const inject = ['tools'];
export const Config = z.object({
  animation: z.any().default(DEFAULT_STORED_ANIMATION_PREFERENCES).volatile(),
});

export function apply(ctx: Context): void {
  ctx.inject(['settings'], (scope) => {
    const settings = (
      scope as unknown as {
        settings: { configure(presentation: { auto: boolean }, owner: unknown): () => void };
      }
    ).settings;
    scope.effect(() => settings.configure({ auto: false }, scope.fiber));
  });
  ctx.inject(['typert'], (connectionContext) => {
    const feed = new FireworksEventFeed();
    connectionContext.effect(() => () => feed.dispose());
    const service = new FireworksRemoteService(connectionContext, feed);
    connectionContext.inject(['settings', 'dshHomePath'], (scope) => {
      const ports = scope as unknown as { settings: AnimationSettingsPort; dshHomePath(): string };
      const library = new AnimationLibrary(new AnimationFiles(ports.dshHomePath()), ports.settings);
      scope.effect(() => service.setAnimationLibrary(library));
    });
    // Keep the public port local: this workspace also compiles plugins against
    // older DSH faces whose Context declaration merges have different brands.
    const registry = connectionContext.typert as unknown as {
      register(contribution: typeof FIREWORKS_HOST): () => Promise<void>;
    };
    connectionContext.effect(() => registry.register(FIREWORKS_HOST));
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
