import type { SessionTitleModelProvenance } from '@deepseek-ai/dsh-session-title';

export type DateTimeFieldConfig = {
  readonly kind: 'datetime';
  readonly source: 'session.createdAt';
  readonly format: string;
  readonly timezone: string;
};

export type LiteralFieldConfig = {
  readonly kind: 'literal';
  readonly value: string;
};

export type LlmEnumValueConfig =
  | string
  | {
      readonly value: string;
      readonly description: string;
    };

export type LlmEnumFieldConfig = {
  readonly kind: 'llm-enum';
  readonly instruction: string;
  readonly values: readonly LlmEnumValueConfig[];
};

export type LlmTextFieldConfig = {
  readonly kind: 'llm-text';
  readonly instruction: string;
  readonly maxCharacters: number;
};

export type TitleFieldConfig =
  DateTimeFieldConfig | LiteralFieldConfig | LlmEnumFieldConfig | LlmTextFieldConfig;

export interface CompiledTemplate {
  readonly source: string;
  readonly segments: readonly TemplateSegment[];
}

export type TemplateSegment =
  | { readonly kind: 'literal'; readonly text: string }
  | { readonly kind: 'field'; readonly name: string };

export interface TitleConfig {
  readonly preset?: string;
  readonly template?: string;
  readonly fields?: Readonly<Record<string, TitleFieldConfig>>;
  readonly maxInputBytes?: number;
  readonly maxOutputTokens?: number;
  readonly reasoningEffort?: string | null;
  readonly timeoutMs?: number;
  readonly provider?: string;
  readonly model?: string;
}

export interface ResolvedTitleConfig {
  readonly preset: 'default';
  readonly template: string;
  readonly fields: Readonly<Record<string, TitleFieldConfig>>;
  readonly compiledTemplate: CompiledTemplate;
  readonly maxInputBytes: number;
  readonly maxOutputTokens: number;
  readonly reasoningEffort?: string | null;
  readonly timeoutMs: number;
  readonly provider?: string;
  readonly model?: string;
}

export interface TitleTokenUsage {
  /** Uncached input tokens reported by the DSH adapter. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Full-call total, including cached input when supplied by the adapter. */
  readonly totalTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
}

export interface TitleTokenLastUsage {
  /** Aggregate input tokens, including cache read/write tokens. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly timestamp: number;
}

export interface TitleTokenStats {
  /** Total number of title model calls that reported valid token usage. */
  readonly totalCalls: number;
  /** Aggregate billed input: uncached input plus cache read/write tokens. */
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly lastUsage?: TitleTokenLastUsage;
}

export interface ExtractedLlmFields {
  readonly values: Readonly<Record<string, string>>;
  readonly model: SessionTitleModelProvenance;
  readonly usage?: TitleTokenUsage;
}
export const DEFAULT_TITLE_STATS: TitleTokenStats = Object.freeze({
  totalCalls: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Normalize one DSH usage chunk; required counters must be present and valid. */
export function normalizeTokenUsage(value: unknown): TitleTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = readTokenCount(value.inputTokens);
  const outputTokens = readTokenCount(value.outputTokens);
  if (inputTokens === undefined || outputTokens === undefined) return undefined;

  const cacheReadTokens = readTokenCount(value.cacheReadTokens);
  const cacheWriteTokens = readTokenCount(value.cacheWriteTokens);
  const minimumTotal =
    inputTokens + outputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
  if (!Number.isSafeInteger(minimumTotal)) return undefined;

  const reportedTotal = readTokenCount(value.totalTokens);
  const totalTokens = Math.max(reportedTotal ?? minimumTotal, minimumTotal);
  if (!Number.isSafeInteger(totalTokens)) return undefined;

  const reasoningTokens = readTokenCount(value.reasoningTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

/** Input total used by the dashboard, including both cache buckets. */
export function aggregateInputTokens(usage: TitleTokenUsage): number {
  return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

export function parseStats(value: unknown): TitleTokenStats {
  if (!isRecord(value)) {
    return { ...DEFAULT_TITLE_STATS };
  }
  const toNonNegativeInt = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
  const optionalNonNegativeInt = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;

  const totalCalls = toNonNegativeInt(value.totalCalls);
  const totalInputTokens = toNonNegativeInt(value.totalInputTokens);
  const totalOutputTokens = toNonNegativeInt(value.totalOutputTokens);
  const totalTokens = Math.max(
    toNonNegativeInt(value.totalTokens),
    totalInputTokens + totalOutputTokens,
  );

  let lastUsage: TitleTokenLastUsage | undefined = undefined;
  if (isRecord(value.lastUsage)) {
    const inTok = toNonNegativeInt(value.lastUsage.inputTokens);
    const outTok = toNonNegativeInt(value.lastUsage.outputTokens);
    const cacheReadTokens = optionalNonNegativeInt(value.lastUsage.cacheReadTokens);
    const cacheWriteTokens = optionalNonNegativeInt(value.lastUsage.cacheWriteTokens);
    const totTok = Math.max(
      toNonNegativeInt(value.lastUsage.totalTokens),
      inTok + outTok + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
    );
    const reasoningTokens =
      typeof value.lastUsage.reasoningTokens === 'number' &&
      Number.isFinite(value.lastUsage.reasoningTokens) &&
      value.lastUsage.reasoningTokens >= 0
        ? Math.floor(value.lastUsage.reasoningTokens)
        : undefined;
    const timestamp =
      typeof value.lastUsage.timestamp === 'number' &&
      Number.isFinite(value.lastUsage.timestamp) &&
      value.lastUsage.timestamp >= 0
        ? value.lastUsage.timestamp
        : 0;
    lastUsage = {
      inputTokens: inTok,
      outputTokens: outTok,
      totalTokens: totTok,
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
      timestamp,
    };
  }

  return {
    totalCalls,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    ...(lastUsage !== undefined ? { lastUsage } : {}),
  };
}
