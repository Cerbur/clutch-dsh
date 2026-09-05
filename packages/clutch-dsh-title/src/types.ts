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

export type LlmEnumFieldConfig = {
  readonly kind: 'llm-enum';
  readonly instruction: string;
  readonly values: readonly string[];
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
  readonly timeoutMs: number;
  readonly provider?: string;
  readonly model?: string;
}

export interface ExtractedLlmFields {
  readonly values: Readonly<Record<string, string>>;
  readonly model: SessionTitleModelProvenance;
}
