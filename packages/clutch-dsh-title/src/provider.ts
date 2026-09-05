import type { Context } from '@deepseek-ai/cordis';
import { normalizeSessionTitle, SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import type {
  SessionTitleProvider,
  SessionTitleProviderRequest,
} from '@deepseek-ai/dsh-session-title';
import { extractLlmFields } from './extractor.js';
import { resolveDeterministicFields } from './fields.js';
import { renderTemplate } from './renderer.js';
import type { ResolvedTitleConfig, TitleFieldConfig } from './types.js';
import { deepFreeze } from '@deepseek-ai/dsh-util-values';

export function hasLlmFields(fields: Readonly<Record<string, TitleFieldConfig>>): boolean {
  return Object.values(fields).some(
    (field) => field.kind === 'llm-enum' || field.kind === 'llm-text',
  );
}

export function mergeFieldValues(
  deterministic: Readonly<Record<string, string>>,
  extracted: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  for (const [name, value] of Object.entries(deterministic)) {
    if (typeof value !== 'string') {
      throw new TypeError(
        `clutch-dsh-title: value for field ${JSON.stringify(name)} must be a string`,
      );
    }
  }
  const values: Record<string, string> = { ...deterministic };
  if (extracted === undefined) return deepFreeze(values);
  for (const [name, value] of Object.entries(extracted)) {
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      throw new Error(`clutch-dsh-title: field ${JSON.stringify(name)} was produced twice`);
    }
    if (typeof value !== 'string') {
      throw new TypeError(
        `clutch-dsh-title: value for field ${JSON.stringify(name)} must be a string`,
      );
    }
    values[name] = value;
  }
  return deepFreeze(values);
}

function assertTemplateValues(
  config: ResolvedTitleConfig,
  values: Readonly<Record<string, string>>,
): void {
  for (const segment of config.compiledTemplate.segments) {
    if (segment.kind !== 'field') continue;
    if (!Object.prototype.hasOwnProperty.call(values, segment.name)) {
      throw new Error(
        `clutch-dsh-title: no resolved value for template field ${JSON.stringify(segment.name)}`,
      );
    }
  }
}

export function createTitleProvider(
  ctx: Context,
  config: ResolvedTitleConfig,
): SessionTitleProvider {
  const titleProvider = SessionTitleProviderId('clutch-dsh-title');
  return {
    id: titleProvider,
    automatic: 'first-prompt',
    async generate(request: SessionTitleProviderRequest) {
      const first = request.messages[0];
      if (first === undefined) {
        throw new Error('clutch-dsh-title requires one human message');
      }
      const deterministic = resolveDeterministicFields(
        config.fields,
        request.session.header.createdAt,
      );
      const extracted = hasLlmFields(config.fields)
        ? await extractLlmFields(ctx, config, request, [first], titleProvider)
        : undefined;
      const values = mergeFieldValues(deterministic, extracted?.values);
      assertTemplateValues(config, values);
      const rendered = renderTemplate(config.compiledTemplate, values);
      const title = normalizeSessionTitle(rendered, Number.MAX_SAFE_INTEGER);
      if (title.length === 0) {
        throw new Error('clutch-dsh-title renderer produced an empty title');
      }
      return deepFreeze({
        title,
        messageSeqs: [first.seq],
        ...(extracted === undefined ? {} : { model: extracted.model }),
      });
    },
  };
}
