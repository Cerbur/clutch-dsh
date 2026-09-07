import { formatDateTime, normalizeFieldValue } from './fields.js';
import { renderTemplate } from './renderer.js';
import { validateTemplate } from './templates.js';

/** Illustrative field values only: no session access or model request. */
export function previewTemplate(
  source: string,
  text: string,
  timestamp = Date.now(),
): string | null {
  try {
    const config = validateTemplate(source);
    const values: Record<string, string> = {};
    for (const segment of config.compiledTemplate.segments) {
      if (segment.kind !== 'field') continue;
      const field = config.fields[segment.name]!;
      switch (field.kind) {
        case 'datetime':
          values[segment.name] = formatDateTime(timestamp, field.format, field.timezone);
          break;
        case 'literal':
          values[segment.name] = normalizeFieldValue(field.value);
          break;
        case 'llm-enum': {
          const choice = field.values[0]!;
          values[segment.name] = normalizeFieldValue(
            typeof choice === 'string' ? choice : choice.value,
          );
          break;
        }
        case 'llm-text':
          values[segment.name] = Array.from(normalizeFieldValue(text))
            .slice(0, field.maxCharacters)
            .join('');
          break;
      }
    }
    return renderTemplate(config.compiledTemplate, values);
  } catch {
    return null;
  }
}
