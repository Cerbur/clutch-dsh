import type { Context } from '@deepseek-ai/cordis';
import {
  FIREWORKS_GUIDANCE_PROMPT,
  FIREWORKS_GUIDANCE_SECTION_NAME,
  FIREWORKS_GUIDANCE_SECTION_ORDER,
} from './contract/index.js';
import { createFireworksProjectionDefinition } from './fireworks-projection.js';
import { happyFireworksTool } from './fireworks-tool.js';

export * from './contract/index.js';
export { createFireworksProjectionDefinition } from './fireworks-projection.js';
export { happyFireworksTool } from './fireworks-tool.js';

export const name = 'clutch-dsh-fireworks';
export const inject = ['tools'];

export function apply(ctx: Context): void {
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
