import { deepFreeze } from '@deepseek-ai/dsh-util-values';
import type { TitleFieldConfig } from './types.js';

const DATE_TOKENS = ['YYYY', 'DDD', 'MM', 'DD', 'HH', 'mm'] as const;

type DateParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

function assertPlainObject(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`clutch-dsh-title: ${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`clutch-dsh-title: ${label} must be a plain object`);
  }
}

function assertTimestamp(timestampMs: number): Date {
  if (!Number.isSafeInteger(timestampMs) || timestampMs < 0) {
    throw new Error(
      'clutch-dsh-title: session.createdAt must be a non-negative safe integer timestamp',
    );
  }
  const date = new Date(timestampMs);
  if (Number.isNaN(date.valueOf())) {
    throw new Error('clutch-dsh-title: session.createdAt must be a valid timestamp');
  }
  return date;
}

function createDateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  if (typeof timezone !== 'string' || timezone.trim().length === 0) {
    throw new Error('clutch-dsh-title: timezone must be a non-empty string');
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch (error) {
    throw new Error(`clutch-dsh-title: invalid timezone ${JSON.stringify(timezone)}`, {
      cause: error,
    });
  }
}

export function validateTimeZone(timezone: string): void {
  createDateTimeFormatter(timezone);
}

function parseDateParts(date: Date, timezone: string): DateParts {
  const formatter = createDateTimeFormatter(timezone);

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  const required = ['year', 'month', 'day', 'hour', 'minute'];
  if (required.some((name) => !Number.isInteger(parts[name]))) {
    throw new Error(
      `clutch-dsh-title: unable to resolve date parts in timezone ${JSON.stringify(timezone)}`,
    );
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
}

function utcCalendarDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dayOfYear(parts: DateParts): number {
  const current = utcCalendarDate(parts.year, parts.month, parts.day);
  const start = utcCalendarDate(parts.year, 1, 1);
  return Math.floor((current.valueOf() - start.valueOf()) / 86_400_000) + 1;
}

function dateTokenValue(token: (typeof DATE_TOKENS)[number], parts: DateParts): string {
  switch (token) {
    case 'YYYY':
      return String(parts.year).padStart(4, '0');
    case 'MM':
      return String(parts.month).padStart(2, '0');
    case 'DD':
      return String(parts.day).padStart(2, '0');
    case 'DDD':
      return String(dayOfYear(parts)).padStart(3, '0');
    case 'HH':
      return String(parts.hour).padStart(2, '0');
    case 'mm':
      return String(parts.minute).padStart(2, '0');
    default:
      throw new Error(`clutch-dsh-title: unsupported datetime token ${JSON.stringify(token)}`);
  }
}

export function validateDateTimeFormat(format: string): void {
  if (typeof format !== 'string' || format.length === 0) {
    throw new Error('clutch-dsh-title: datetime format must be a non-empty string');
  }
  let cursor = 0;
  while (cursor < format.length) {
    const token = DATE_TOKENS.find((candidate) => format.startsWith(candidate, cursor));
    if (token !== undefined) {
      cursor += token.length;
      continue;
    }
    const character = format[cursor];
    if (character !== undefined && /[A-Za-z]/.test(character)) {
      throw new Error(
        `clutch-dsh-title: unsupported datetime token near ${JSON.stringify(format.slice(cursor))}`,
      );
    }
    cursor += 1;
  }
}

export function formatDateTime(timestampMs: number, format: string, timezone: string): string {
  const date = assertTimestamp(timestampMs);
  validateDateTimeFormat(format);
  const parts = parseDateParts(date, timezone);
  let output = '';
  let cursor = 0;
  while (cursor < format.length) {
    const token = DATE_TOKENS.find((candidate) => format.startsWith(candidate, cursor));
    if (token !== undefined) {
      output += dateTokenValue(token, parts);
      cursor += token.length;
      continue;
    }
    output += format[cursor] ?? '';
    cursor += 1;
  }
  return output;
}

export function normalizeFieldValue(value: string): string {
  if (typeof value !== 'string') {
    throw new TypeError('clutch-dsh-title: field value must be a string');
  }
  return (
    value
      .replace(/\r\n|\r|\n/gu, ' ')
      // Control characters are intentionally matched so they cannot reach a title.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
  );
}

export function resolveDeterministicFields(
  fields: Readonly<Record<string, TitleFieldConfig>>,
  createdAt: number,
): Readonly<Record<string, string>> {
  assertPlainObject(fields, 'fields');
  const values: Record<string, string> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field === null || typeof field !== 'object' || Array.isArray(field)) {
      throw new Error(`clutch-dsh-title: field ${JSON.stringify(name)} must be an object`);
    }
    switch (field.kind) {
      case 'datetime':
        if (field.source !== 'session.createdAt') {
          throw new Error(
            `clutch-dsh-title: field ${JSON.stringify(name)} source must be session.createdAt`,
          );
        }
        values[name] = formatDateTime(createdAt, field.format, field.timezone);
        break;
      case 'literal': {
        const value = normalizeFieldValue(field.value);
        if (value.length === 0) {
          throw new Error(
            `clutch-dsh-title: literal field ${JSON.stringify(name)} resolved to an empty value`,
          );
        }
        values[name] = value;
        break;
      }
      case 'llm-enum':
      case 'llm-text':
        break;
      default:
        throw new Error(`clutch-dsh-title: field ${JSON.stringify(name)} has an unsupported kind`);
    }
  }
  return deepFreeze(values);
}

function assertDynamicFieldValue(
  name: string,
  field: Extract<TitleFieldConfig, { kind: 'llm-enum' | 'llm-text' }>,
  value: unknown,
): string {
  if (typeof value !== 'string') {
    throw new TypeError(
      `clutch-dsh-title: extracted field ${JSON.stringify(name)} must be a string`,
    );
  }
  const normalized = normalizeFieldValue(value);
  if (normalized.length === 0) {
    throw new Error(`clutch-dsh-title: extracted field ${JSON.stringify(name)} must not be empty`);
  }
  if (field.kind === 'llm-enum') {
    if (!field.values.includes(normalized)) {
      throw new Error(
        `clutch-dsh-title: extracted enum field ${JSON.stringify(name)} is not declared`,
      );
    }
  } else if (Array.from(normalized).length > field.maxCharacters) {
    throw new Error(
      `clutch-dsh-title: extracted field ${JSON.stringify(name)} exceeds maxCharacters`,
    );
  }
  return normalized;
}

export function validateExtractedFields(
  fields: Readonly<Record<string, TitleFieldConfig>>,
  candidate: unknown,
): Readonly<Record<string, string>> {
  assertPlainObject(fields, 'fields');
  assertPlainObject(candidate, 'extracted fields');

  const dynamicFields = Object.entries(fields).filter(
    ([, field]) => field.kind === 'llm-enum' || field.kind === 'llm-text',
  );
  const candidateKeys = Object.keys(candidate);
  if (candidateKeys.length !== dynamicFields.length) {
    throw new Error(
      'clutch-dsh-title: extracted fields must contain exactly the configured dynamic fields',
    );
  }

  const values: Record<string, string> = {};
  for (const [name, field] of dynamicFields) {
    if (!Object.prototype.hasOwnProperty.call(candidate, name)) {
      throw new Error(`clutch-dsh-title: extracted field ${JSON.stringify(name)} is missing`);
    }
    if (field.kind !== 'llm-enum' && field.kind !== 'llm-text') {
      throw new Error(`clutch-dsh-title: field ${JSON.stringify(name)} is not dynamic`);
    }
    values[name] = assertDynamicFieldValue(name, field, candidate[name]);
  }
  return deepFreeze(values);
}
