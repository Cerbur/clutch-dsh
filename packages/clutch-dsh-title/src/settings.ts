import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { stringify } from 'yaml';
import { TITLE_NAMESPACE, EMOJI_TEMPLATE, decodeTemplates, settingsDocument } from './templates.js';
import type { TitleConfig } from './types.js';

/** Deliberately tolerant: external malformed rows must remain visible for repair. */
export const TemplateSettingsSchema: z = z.object({
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

interface SettingsDescriptorView {
  ns: string;
  base?: unknown;
  user?: unknown;
}

interface CompatibleSettingsService {
  register?: (namespace: string, schema: unknown, options: unknown) => void;
  configure?: (presentation: { auto?: boolean }, owner?: unknown) => () => void;
  describe?: () => SettingsDescriptorView[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function settingsBaseDocument(base: unknown, descriptorBase: unknown): Record<string, unknown> {
  const defaults = isRecord(base) ? base : {};
  const inherited = isRecord(descriptorBase) ? descriptorBase : {};
  const result = { ...defaults, ...inherited };

  // An empty projected volatile map does not erase the package's inherited defaults.
  // The user layer below remains a full replacement, so explicitly deleting a template
  // still persists as an empty map.
  if (isRecord(defaults.templates) && isRecord(inherited.templates)) {
    result.templates = { ...defaults.templates, ...inherited.templates };
  }

  return result;
}

function managedSettingsBase(config: TitleConfig): Record<string, unknown> {
  // DSH 0.1.7 passes volatile fields as stable-reference wrappers; its SettingsForms descriptor
  // below supplies the plain current values, so only derive the fallback from ordinary config.
  return templateSettingsBase(config);
}

export function registerTemplateSettings(
  ctx: Context,
  config: TitleConfig,
): () => ReturnType<typeof decodeTemplates> {
  const base = managedSettingsBase(config);
  const settings = (ctx as unknown as { settings?: CompatibleSettingsService }).settings;
  if (typeof settings?.register === 'function') {
    // DSH through 0.1.6 exposes a namespaced settings provider.
    settings.register(TITLE_NAMESPACE, TemplateSettingsSchema, { base, applies: 'live' });
  } else if (typeof settings?.configure === 'function') {
    // DSH 0.1.7 stores volatile settings on the profile's plugin Config entry.
    const dispose = settings.configure({ auto: false }, ctx.fiber);
    ctx.effect(() => dispose);
  }
  return () => {
    const descriptor = settings?.describe?.().find((item) => item.ns === TITLE_NAMESPACE);
    // Read current base/user layers so external profile edits are immediately repairable.
    const layeredBase = settingsBaseDocument(base, descriptor?.base);
    return decodeTemplates(settingsDocument(layeredBase, descriptor?.user));
  };
}
