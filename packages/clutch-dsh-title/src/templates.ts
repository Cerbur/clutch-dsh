import { parseDocument, stringify } from 'yaml';
import { resolveTitleConfig } from './config.js';
import { DEFAULT_PRESET } from './presets/default.js';
import type { ResolvedTitleConfig, TitleConfig } from './types.js';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';

export const TITLE_NAMESPACE = 'clutch-dsh-title';
export const DEFAULT_TEMPLATE = stringify({
  template: DEFAULT_PRESET.template,
  fields: DEFAULT_PRESET.fields,
});
const MAX_TEMPLATE_LENGTH = 65536;

export interface TemplateRow {
  id: string;
  source: string;
  error?: string;
}
export interface TemplateState {
  enabled: boolean;
  active: string;
  effective: string;
  rows: TemplateRow[];
  errors: string[];
  config: ResolvedTitleConfig;
  /** Original JSON entries, including invalid values, retained across edits. */
  sources: Readonly<Record<string, JsonValue>>;
}
export type TemplateAction =
  | { kind: 'save' | 'create'; id: string; source: string }
  | { kind: 'activate'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'enabled'; enabled: boolean };
export type TemplateOp =
  { op: 'set'; path: string[]; value: JsonValue } | { op: 'unset'; path: string[] };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
/** Template maps replace the inherited map, allowing legacy entries to be removed. */
export function settingsDocument(base: unknown, user: unknown): unknown {
  return { ...(record(base) ? base : {}), ...(record(user) ? user : {}) };
}
export function validateTemplate(source: string): ResolvedTitleConfig {
  if (typeof source !== 'string' || source.length > MAX_TEMPLATE_LENGTH) {
    throw new Error('Template must be YAML text of at most 65536 characters.');
  }
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(doc.errors.map((error) => error.message).join('\n'));
  const value: unknown = doc.toJS({ maxAliasCount: 20 });
  if (!record(value) || typeof value.template !== 'string')
    throw new Error('A template must contain template and optional fields.');
  if (Object.keys(value).some((key) => key !== 'template' && key !== 'fields'))
    throw new Error('Only template and fields are allowed.');
  return resolveTitleConfig(value as TitleConfig);
}
function validateId(id: string): void {
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N} _-]{0,63}$/u.test(id) ||
    ['default', 'constructor', 'prototype', '__proto__'].includes(id) ||
    id !== id.trim()
  ) {
    throw new Error(
      'Use a unique name of 1–64 letters, numbers, spaces, underscores or hyphens; default is reserved.',
    );
  }
}

/** Decode untrusted external settings without throwing or losing editable rows. */
export function decodeTemplates(raw: unknown = {}): TemplateState {
  const errors: string[] = [];
  if (!record(raw)) errors.push('Settings must be an object.');
  const data = record(raw) ? raw : {};
  if (data.enabled !== undefined && typeof data.enabled !== 'boolean')
    errors.push('enabled must be a boolean.');
  if (data.active !== undefined && typeof data.active !== 'string')
    errors.push('active must be a template name.');
  if (data.templates !== undefined && !record(data.templates))
    errors.push('templates must be a mapping.');
  const templates = record(data.templates) ? data.templates : {};
  const rows: TemplateRow[] = [{ id: 'default', source: DEFAULT_TEMPLATE }];
  const configs = new Map<string, ResolvedTitleConfig>([['default', resolveTitleConfig({})]]);
  for (const [id, source] of Object.entries(templates)) {
    if (id === 'default') {
      errors.push('External default override ignored; default is read-only.');
      continue;
    }
    const row: TemplateRow = {
      id,
      source: typeof source === 'string' ? source : stringify(source),
    };
    try {
      validateId(id);
      if (typeof source !== 'string') throw new Error('Template must be YAML text.');
      configs.set(id, validateTemplate(source));
    } catch (error) {
      row.error = message(error);
    }
    rows.push(row);
  }
  const active = typeof data.active === 'string' ? data.active : 'default';
  const effective = configs.has(active) ? active : 'default';
  if (active !== effective)
    errors.push(
      `Selected template ${JSON.stringify(active)} is invalid or missing; using default.`,
    );
  return {
    enabled: data.enabled !== false,
    active,
    effective,
    rows,
    errors,
    config: configs.get(effective)!,
    sources: templates as Record<string, JsonValue>,
  };
}

/** Build minimal native settings operations, leaving unrelated broken entries intact. */
export function templateMutation(state: TemplateState, action: TemplateAction): TemplateOp[] {
  if (action.kind === 'enabled') return [{ op: 'set', path: ['enabled'], value: action.enabled }];
  const row = state.rows.find((item) => item.id === action.id);
  if (action.kind === 'activate') {
    if (!row || row.error) throw new Error('Cannot activate an invalid or missing template.');
    return [{ op: 'set', path: ['active'], value: action.id }];
  }
  if (action.id === 'default') throw new Error('default is read-only.');
  const sources = { ...state.sources };
  if (action.kind === 'delete') {
    if (!row) throw new Error('Template no longer exists.');
    delete sources[action.id];
    return [
      { op: 'set', path: ['templates'], value: sources },
      ...(state.active === action.id
        ? [{ op: 'set' as const, path: ['active'], value: 'default' }]
        : []),
    ];
  }
  validateId(action.id);
  if (action.kind === 'create' && row) throw new Error('Template name already exists.');
  if (action.kind === 'save' && !row) throw new Error('Template no longer exists.');
  validateTemplate(action.source);
  sources[action.id] = action.source;
  return [{ op: 'set', path: ['templates'], value: sources }];
}
