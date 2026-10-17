import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TitleConfigSchema, resolveTitleConfig } from './config.js';
import { createTitleProvider } from './provider.js';
import type { TitleConfig } from './types.js';
import { createPlainTitleGenerator } from './plain-title.js';
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import { registerTemplateSettings } from './settings.js';
import { createTitleStatsStore, installTitleTokenStatsRecorder } from './storage.js';
import { createTitleDiagnosticsStore } from './diagnostics.js';
import { TitleRemoteService } from './host/remote.js';

export const name = 'clutch-dsh-title';
export const inject = ['sessionTitle', 'llm', 'sessions'];

export type Config = TitleConfig;
export const Config: z<Config> = TitleConfigSchema;

export function apply(ctx: Context, config: Config): void {
  const statsStore = createTitleStatsStore(ctx);
  const recordGeneration = installTitleTokenStatsRecorder(ctx, statsStore);
  const diagnosticsStore = createTitleDiagnosticsStore(ctx);
  new TitleRemoteService(ctx, statsStore, diagnosticsStore);

  const initial = resolveTitleConfig(config);
  const unmanaged = () => ({ enabled: true, config: resolveTitleConfig(config) });
  let read = unmanaged;
  // Retain the host-only composition path when no settings provider is composed.
  ctx.inject(['settings'], (settingsCtx) => {
    const next = registerTemplateSettings(settingsCtx, config, ctx.fiber);
    read = next;
    settingsCtx.effect(() => () => {
      read = unmanaged;
    });
  });
  const native = createPlainTitleGenerator(ctx, initial);
  ctx.sessionTitle.register({
    id: SessionTitleProviderId('clutch-dsh-title'),
    automatic: 'first-prompt',
    generate(request) {
      return recordGeneration(async () => {
        const state = read();
        if (!state.enabled) {
          return native(request);
        }
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
        return createTitleProvider(ctx, selected, diagnosticsStore).generate(request);
      }, request.signal);
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
export { MAX_REPAIR_ATTEMPTS, resolveTitleConfig, TitleConfigSchema } from './config.js';
export {
  createTitleDiagnosticsStore,
  MAX_PENDING_INCIDENTS,
  TitleDiagnosticsStoreImpl,
} from './diagnostics.js';
export { TitleRemoteService } from './host/remote.js';
export type {
  CompiledTemplate,
  TitleDiagnostics,
  TitleDiagnosticsRecorder,
  TitleExtractionAttemptRecord,
  TitleExtractionIncident,
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
