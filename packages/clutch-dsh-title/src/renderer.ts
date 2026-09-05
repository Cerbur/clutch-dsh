import type { CompiledTemplate, TemplateSegment } from './types.js';

const FIELD_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_FIELD_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

function appendLiteral(segments: TemplateSegment[], text: string): void {
  if (text.length === 0) return;
  const previous = segments[segments.length - 1];
  if (previous?.kind === 'literal') {
    segments[segments.length - 1] = { kind: 'literal', text: previous.text + text };
    return;
  }
  segments.push({ kind: 'literal', text });
}

function templateError(source: string, message: string): Error {
  return new Error(`clutch-dsh-title: invalid template ${JSON.stringify(source)}: ${message}`);
}

export function compileTemplate(
  template: string,
  declaredFields: ReadonlySet<string>,
): CompiledTemplate {
  if (typeof template !== 'string' || template.length === 0) {
    throw new Error('clutch-dsh-title: template must be a non-empty string');
  }
  if (
    declaredFields === null ||
    typeof declaredFields !== 'object' ||
    typeof declaredFields.has !== 'function'
  ) {
    throw new TypeError('clutch-dsh-title: declaredFields must be a set-like object');
  }

  const segments: TemplateSegment[] = [];
  let cursor = 0;
  while (cursor < template.length) {
    const marker = template.indexOf('${', cursor);
    if (marker < 0) {
      appendLiteral(segments, template.slice(cursor));
      break;
    }
    appendLiteral(segments, template.slice(cursor, marker));

    const close = template.indexOf('}', marker + 2);
    if (close < 0) {
      throw templateError(template, `unclosed placeholder at offset ${marker}`);
    }
    const name = template.slice(marker + 2, close);
    if (!FIELD_IDENTIFIER_PATTERN.test(name) || RESERVED_FIELD_NAMES.has(name)) {
      throw templateError(
        template,
        `placeholder ${JSON.stringify(name)} is not a field identifier`,
      );
    }
    if (!declaredFields.has(name)) {
      throw templateError(template, `field ${JSON.stringify(name)} is not declared`);
    }
    segments.push({ kind: 'field', name });
    cursor = close + 1;
  }

  return Object.freeze({
    source: template,
    segments: Object.freeze(segments),
  });
}

export function renderTemplate(
  template: CompiledTemplate,
  values: Readonly<Record<string, string>>,
): string {
  if (template === null || typeof template !== 'object') {
    throw new TypeError('clutch-dsh-title: compiled template is required');
  }
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new TypeError('clutch-dsh-title: template values must be a plain object');
  }

  let output = '';
  for (const segment of template.segments) {
    if (segment.kind === 'literal') {
      output += segment.text;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(values, segment.name)) {
      throw new Error(
        `clutch-dsh-title: missing runtime value for field ${JSON.stringify(segment.name)}`,
      );
    }
    const value = values[segment.name];
    if (typeof value !== 'string') {
      throw new TypeError(
        `clutch-dsh-title: runtime value for field ${JSON.stringify(segment.name)} must be a string`,
      );
    }
    output += value;
  }
  return output;
}
