import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TitleConfigSchema, resolveTitleConfig } from './config.js';
import { createTitleProvider } from './provider.js';
import type { TitleConfig } from './types.js';

export const name = 'clutch-dsh-title';
export const inject = ['sessionTitle', 'llm', 'sessions'];

export type Config = TitleConfig;
export const Config: z<Config> = TitleConfigSchema;

export function apply(ctx: Context, config: Config): void {
  ctx.sessionTitle.register(createTitleProvider(ctx, resolveTitleConfig(config)));
}

export { compileTemplate, renderTemplate } from './renderer.js';
export {
  formatDateTime,
  normalizeFieldValue,
  resolveDeterministicFields,
  validateExtractedFields,
} from './fields.js';
export { createTitleProvider, hasLlmFields, mergeFieldValues } from './provider.js';
export { resolveTitleConfig, TitleConfigSchema } from './config.js';
export type {
  CompiledTemplate,
  DateTimeFieldConfig,
  ExtractedLlmFields,
  LiteralFieldConfig,
  LlmEnumFieldConfig,
  LlmTextFieldConfig,
  ResolvedTitleConfig,
  TemplateSegment,
  TitleConfig,
  TitleFieldConfig,
} from './types.js';
