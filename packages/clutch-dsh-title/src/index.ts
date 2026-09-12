import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TitleConfigSchema, resolveTitleConfig } from './config.js';
import { createTitleProvider } from './provider.js';
import type { TitleConfig } from './types.js';
import {
  generateSessionTitleWithLlm,
  resolveSessionTitleLlmConfig,
} from '@deepseek-ai/dsh-session-title-llm';
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import { registerTemplateSettings } from './settings.js';
import { createTitleStatsStore, installTitleTokenStatsRecorder } from './storage.js';
import { TitleRemoteService } from './host/remote.js';

export const name = 'clutch-dsh-title';
export const inject = ['sessionTitle', 'llm', 'sessions'];

export type Config = TitleConfig;
export const Config: z<Config> = TitleConfigSchema;

export function apply(ctx: Context, config: Config): void {
  const statsStore = createTitleStatsStore(ctx);
  installTitleTokenStatsRecorder(ctx, statsStore);
  new TitleRemoteService(ctx, statsStore);

  const initial = resolveTitleConfig(config);
  let read = () => ({ enabled: true, config: initial });
  let settingsContext: Context | undefined;
  // Retain the host-only composition path when no settings provider is composed.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsContext = settingsCtx;
    const next = registerTemplateSettings(settingsCtx, config);
    read = next;
    settingsCtx.effect(() => () => {
      settingsContext = undefined;
      read = () => ({ enabled: true, config: initial });
    });
  });
  const native = resolveSessionTitleLlmConfig({
    targetWords: 5,
    targetCjkCharacters: 10,
    maxInputBytes: initial.maxInputBytes,
    maxOutputTokens: 64,
    timeoutMs: initial.timeoutMs,
    ...(initial.provider === undefined ? {} : { provider: initial.provider, model: initial.model }),
  });
  ctx.sessionTitle.register({
    id: SessionTitleProviderId('clutch-dsh-title'),
    automatic: 'first-prompt',
    async generate(request) {
      const state = read();
      if (!state.enabled)
        return generateSessionTitleWithLlm(
          ctx,
          native,
          request,
          request.messages.slice(0, 1),
          SessionTitleProviderId('session-title-first-prompt-llm'),
        );
      const selected = {
        ...state.config,
        maxInputBytes: initial.maxInputBytes,
        maxOutputTokens: initial.maxOutputTokens,
        reasoningEffort: initial.reasoningEffort,
        timeoutMs: initial.timeoutMs,
        ...(initial.provider === undefined
          ? {}
          : { provider: initial.provider, model: initial.model }),
      };
      return createTitleProvider(settingsContext ?? ctx, selected).generate(request);
    },
  });
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
export { TitleRemoteService } from './host/remote.js';
export type {
  CompiledTemplate,
  DateTimeFieldConfig,
  ExtractedLlmFields,
  LiteralFieldConfig,
  LlmEnumFieldConfig,
  LlmEnumValueConfig,
  LlmTextFieldConfig,
  ResolvedTitleConfig,
  TemplateSegment,
  TitleConfig,
  TitleFieldConfig,
  TitleTokenUsage,
  TitleTokenStats,
  TitleTokenLastUsage,
} from './types.js';
