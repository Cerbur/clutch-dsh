import type { Context } from '@deepseek-ai/cordis';
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
  ctx.tools.register(happyFireworksTool);
}
