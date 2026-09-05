import z from '@deepseek-ai/schemastery';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import { deepFreeze } from '@deepseek-ai/dsh-util-values';
import { normalizeFieldValue, validateDateTimeFormat, validateTimeZone } from './fields.js';
import { compileTemplate } from './renderer.js';
import { DEFAULT_PRESET } from './presets/default.js';
import type {
  DateTimeFieldConfig,
  LiteralFieldConfig,
  LlmEnumFieldConfig,
  LlmTextFieldConfig,
  ResolvedTitleConfig,
  TitleConfig,
  TitleFieldConfig,
} from './types.js';

const DateTimeField: z<DateTimeFieldConfig> = z.object({
  kind: z.const('datetime').required(),
  source: z.const('session.createdAt').required(),
  format: z.string().required(),
  timezone: z.string().required(),
});

const LiteralField: z<LiteralFieldConfig> = z.object({
  kind: z.const('literal').required(),
  value: z.string().required(),
});

const LlmEnumField = z.object({
  kind: z.const('llm-enum').required(),
  instruction: z.string().required(),
  values: z.array(String).required(),
}) as unknown as z<LlmEnumFieldConfig>;

const LlmTextField: z<LlmTextFieldConfig> = z.object({
  kind: z.const('llm-text').required(),
  instruction: z.string().required(),
  maxCharacters: z.number().step(1).min(1).required(),
});

const FieldConfig: z<TitleFieldConfig> = z.union([
  DateTimeField,
  LiteralField,
  LlmEnumField,
  LlmTextField,
]) as unknown as z<TitleFieldConfig>;

export const TitleConfigSchema: z<TitleConfig> = z.object({
  preset: z.string().default('default'),
  template: z.string(),
  fields: z.dict(FieldConfig),
  maxInputBytes: z.number().step(1).min(1).default(4096),
  maxOutputTokens: z.number().step(1).min(1).default(512),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(60000),
  provider: z.string(),
  model: z.string(),
});

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'preset',
  'template',
  'fields',
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
  'provider',
  'model',
]);

const FIELD_KEY_SETS: Readonly<Record<TitleFieldConfig['kind'], ReadonlySet<string>>> = {
  datetime: new Set(['kind', 'source', 'format', 'timezone']),
  literal: new Set(['kind', 'value']),
  'llm-enum': new Set(['kind', 'instruction', 'values']),
  'llm-text': new Set(['kind', 'instruction', 'maxCharacters']),
};

const FIELD_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_FIELD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertKnownKeys(
  value: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!knownKeys.has(key))
      throw new Error(`clutch-dsh-title: unknown ${label} key ${JSON.stringify(key)}`);
  }
}

function assertNonEmptyString(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`clutch-dsh-title: ${name} must be a non-empty string`);
  }
}

function assertPositiveSafeInteger(name: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`clutch-dsh-title: ${name} must be a positive safe integer`);
  }
}

function validateFieldDefinition(name: string, candidate: unknown): TitleFieldConfig {
  if (!isRecord(candidate)) {
    throw new Error(`clutch-dsh-title: field ${JSON.stringify(name)} must be an object`);
  }
  const kind = candidate.kind;
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(FIELD_KEY_SETS, kind)) {
    throw new Error(`clutch-dsh-title: field ${JSON.stringify(name)} has an unsupported kind`);
  }
  assertKnownKeys(
    candidate,
    FIELD_KEY_SETS[kind as TitleFieldConfig['kind']],
    `field ${JSON.stringify(name)}`,
  );

  switch (kind) {
    case 'datetime':
      if (candidate.source !== 'session.createdAt') {
        throw new Error(
          `clutch-dsh-title: field ${JSON.stringify(name)} source must be session.createdAt`,
        );
      }
      assertNonEmptyString(`${name}.format`, candidate.format);
      assertNonEmptyString(`${name}.timezone`, candidate.timezone);
      validateDateTimeFormat(candidate.format);
      validateTimeZone(candidate.timezone);
      return {
        kind,
        source: 'session.createdAt',
        format: candidate.format,
        timezone: candidate.timezone,
      };
    case 'literal':
      assertNonEmptyString(`${name}.value`, candidate.value);
      return { kind, value: candidate.value };
    case 'llm-enum': {
      assertNonEmptyString(`${name}.instruction`, candidate.instruction);
      if (!Array.isArray(candidate.values) || candidate.values.length === 0) {
        throw new Error(`clutch-dsh-title: field ${JSON.stringify(name)} values must not be empty`);
      }
      const rawValues = candidate.values as unknown[];
      const values = rawValues.map((value, index) => {
        assertNonEmptyString(`${name}.values[${index}]`, value);
        const normalized = normalizeFieldValue(value);
        if (normalized.length === 0) {
          throw new Error(`clutch-dsh-title: ${name}.values[${index}] must not be empty`);
        }
        return normalized;
      });
      if (new Set(values).size !== values.length) {
        throw new Error(
          `clutch-dsh-title: field ${JSON.stringify(name)} values must not contain duplicates`,
        );
      }
      return { kind, instruction: candidate.instruction, values };
    }
    case 'llm-text':
      assertNonEmptyString(`${name}.instruction`, candidate.instruction);
      assertPositiveSafeInteger(`${name}.maxCharacters`, candidate.maxCharacters);
      return { kind, instruction: candidate.instruction, maxCharacters: candidate.maxCharacters };
    default:
      throw new Error(`clutch-dsh-title: unsupported field kind ${JSON.stringify(kind)}`);
  }
}

export function resolveTitleConfig(config: TitleConfig): ResolvedTitleConfig {
  if (!isRecord(config)) throw new Error('clutch-dsh-title: configuration must be an object');
  assertKnownKeys(config, CONFIG_KEYS, 'config');
  const input = config as TitleConfig;

  const preset = input.preset === undefined ? DEFAULT_PRESET.preset : input.preset;
  if (preset !== 'default')
    throw new Error(`clutch-dsh-title: unknown preset ${JSON.stringify(preset)}`);

  const rawFields = input.fields === undefined ? {} : input.fields;
  if (!isRecord(rawFields)) throw new Error('clutch-dsh-title: fields must be an object');

  const fields: Record<string, TitleFieldConfig> = Object.fromEntries(
    Object.entries(DEFAULT_PRESET.fields).map(([name, field]) => [name, field]),
  );
  for (const [name, field] of Object.entries(rawFields)) {
    if (!FIELD_IDENTIFIER_PATTERN.test(name) || RESERVED_FIELD_NAMES.has(name)) {
      throw new Error(`clutch-dsh-title: invalid field identifier ${JSON.stringify(name)}`);
    }
    fields[name] = validateFieldDefinition(name, field);
  }
  for (const [name, field] of Object.entries(fields)) {
    fields[name] = validateFieldDefinition(name, field);
  }

  const template = input.template === undefined ? DEFAULT_PRESET.template : input.template;
  assertNonEmptyString('template', template);
  const compiledTemplate = compileTemplate(template, new Set(Object.keys(fields)));

  const maxInputBytes = input.maxInputBytes === undefined ? 4096 : input.maxInputBytes;
  const maxOutputTokens = input.maxOutputTokens === undefined ? 512 : input.maxOutputTokens;
  const timeoutMs = input.timeoutMs === undefined ? 60000 : input.timeoutMs;
  assertPositiveSafeInteger('maxInputBytes', maxInputBytes);
  assertPositiveSafeInteger('maxOutputTokens', maxOutputTokens);
  assertPositiveSafeInteger('timeoutMs', timeoutMs);
  if (timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`clutch-dsh-title: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`);
  }

  const hasProvider = input.provider !== undefined;
  const hasModel = input.model !== undefined;
  if (hasProvider !== hasModel) {
    throw new Error('clutch-dsh-title: provider and model must be supplied together');
  }
  if (hasProvider) {
    assertNonEmptyString('provider', input.provider);
    assertNonEmptyString('model', input.model);
  }

  return deepFreeze({
    preset: 'default',
    template,
    fields,
    compiledTemplate,
    maxInputBytes,
    maxOutputTokens,
    timeoutMs,
    ...(hasProvider ? { provider: input.provider, model: input.model } : {}),
  });
}
