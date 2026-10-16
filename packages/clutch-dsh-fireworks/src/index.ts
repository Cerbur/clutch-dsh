import { type Context, type Volatile } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import {
  FIREWORKS_DEFAULTS,
  FIREWORKS_GUIDANCE_PROMPT,
  FIREWORKS_GUIDANCE_SECTION_NAME,
  FIREWORKS_GUIDANCE_SECTION_ORDER,
  FIREWORKS_LIMITS,
  type FireworksMode,
} from './contract/index.js';
import { createFireworksProjectionDefinition } from './fireworks-projection.js';
import { createHappyFireworksTool } from './fireworks-tool.js';

export * from './contract/index.js';
export { createFireworksProjectionDefinition } from './fireworks-projection.js';
export {
  createHappyFireworksTool,
  rollSplash,
  splashAnnouncement,
  type FireworksToolPreferences,
} from './fireworks-tool.js';

/** Live plugin configuration surfaced on the plugin settings page. */
export interface Config {
  /** Celebration renderer used by the Web overlay. */
  mode: Volatile<FireworksMode>;
  /** Launch window of one show, in milliseconds. */
  showDurationMs: Volatile<number>;
  /** Average launches per second inside the launch window. */
  showRatePerSec: Volatile<number>;
  /** Chance for one show to carry a splash shell. */
  splashChance: number;
}

/** Schemastery validation for {@link Config}. */
export const Config = z.object({
  mode: z.union(['emoji', 'realistic']).default(FIREWORKS_DEFAULTS.mode).volatile(),
  showDurationMs: z
    .number()
    .min(FIREWORKS_LIMITS.minDurationMs)
    .max(FIREWORKS_LIMITS.maxDurationMs)
    .default(FIREWORKS_DEFAULTS.showDurationMs)
    .volatile(),
  showRatePerSec: z
    .number()
    .min(FIREWORKS_LIMITS.minRatePerSec)
    .max(FIREWORKS_LIMITS.maxRatePerSec)
    .default(FIREWORKS_DEFAULTS.showRatePerSec)
    .volatile(),
  splashChance: z.number().min(0).max(1).default(FIREWORKS_DEFAULTS.splashChance),
});

export const name = 'clutch-dsh-fireworks';
export const inject = ['tools'];

/** Standalone tool instance with splash disabled, kept for direct embedding. */
export const happyFireworksTool = createHappyFireworksTool(() => ({
  mode: FIREWORKS_DEFAULTS.mode,
  splashChance: 0,
}));

export function apply(ctx: Context, config?: Config): void {
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
  ctx.tools.register(
    createHappyFireworksTool(
      config === undefined
        ? () => ({ mode: FIREWORKS_DEFAULTS.mode, splashChance: FIREWORKS_DEFAULTS.splashChance })
        : () => ({ mode: config.mode.get(), splashChance: config.splashChance }),
    ),
  );
}
