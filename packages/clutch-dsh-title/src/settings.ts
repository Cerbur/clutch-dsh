import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { stringify } from 'yaml';
import { TITLE_NAMESPACE, EMOJI_TEMPLATE, decodeTemplates, settingsDocument } from './templates.js';
import type { TitleConfig } from './types.js';

/** Deliberately tolerant: external malformed rows must remain visible for repair. */
export const TemplateSettingsSchema = z.object({
  enabled: z.any().default(true),
  active: z.any().default('default'),
  templates: z.any().default({}),
});

export function templateSettingsBase(config: TitleConfig): Record<string, unknown> {
  // Schemastery materializes an omitted dictionary as {}; that is not a legacy override.
  if (config.template === undefined && Object.keys(config.fields ?? {}).length === 0)
    return { enabled: true, active: 'default', templates: { emoji: EMOJI_TEMPLATE } };
  return {
    enabled: true,
    active: 'legacy',
    templates: {
      legacy: stringify({
        template: config.template ?? '${daytime}|${type}|${desc}',
        ...(config.fields === undefined ? {} : { fields: config.fields }),
      }),
    },
  };
}

export function registerTemplateSettings(
  ctx: Context,
  config: TitleConfig,
): () => ReturnType<typeof decodeTemplates> {
  const base = templateSettingsBase(config);
  ctx.settings.register(TITLE_NAMESPACE, TemplateSettingsSchema, { base, applies: 'live' });
  return () => {
    const descriptor = ctx.settings.describe().find((item) => item.ns === TITLE_NAMESPACE);
    // Reading the raw layer avoids a stale last-good resolved value after an external edit.
    return decodeTemplates(settingsDocument(base, descriptor?.user));
  };
}
