import type { Context } from '@deepseek-ai/cordis';
import { normalizeSessionTitle, SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import type { SessionTitleProviderRequest } from '@deepseek-ai/dsh-session-title';
import {
  executeSessionTitleLlm,
  resolveSessionTitleLlmConfig,
} from '@deepseek-ai/dsh-session-title-llm';
import { frameBoundedInput } from './input.js';
import type { ResolvedTitleConfig } from './types.js';

/** Plain first-prompt policy using the same executor as DSH's native providers. */
export function createPlainTitleGenerator(ctx: Context, config: ResolvedTitleConfig) {
  const execution = resolveSessionTitleLlmConfig({
    maxInputBytes: config.maxInputBytes,
    maxOutputTokens: 64,
    timeoutMs: config.timeoutMs,
    ...(config.provider === undefined ? {} : { provider: config.provider, model: config.model }),
  });
  return async (request: SessionTitleProviderRequest) => {
    const first = request.messages[0];
    if (first === undefined) throw new Error('clutch-dsh-title requires one human message');
    const response = await executeSessionTitleLlm(
      ctx,
      execution,
      request,
      SessionTitleProviderId('clutch-dsh-title'),
      {
        system: [
          'Create a concise title for an AI coding-assistant session from the supplied human messages.',
          'Return only the title on one line, in plain text of natural language, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
          'Use the language of the messages.',
          'Aim for about 5 words in non-CJK languages or 10 CJK characters.',
          'If the messages give little to name, still return a short best-effort title, such as Greeting, instead of explaining.',
        ].join('\n'),
        input: frameBoundedInput(
          [first],
          config.maxInputBytes,
          'Generate the session title from this JSON array of human messages:\n',
        ),
        messageSeqs: [first.seq],
        selectReasoningEffort: (model) => model.reasoning?.efforts[0]?.id,
      },
    );
    if (response.finish.kind !== 'stop' || response.blocks.some((b) => b.type === 'tool-call')) {
      throw new Error('clutch-dsh-title: plain title output must finish with text only');
    }
    const text = response.blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ');
    const line =
      text
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .find(Boolean) ?? '';
    const emphasis = /^(?<marker>\*{1,3})(?<inner>\S(?:.*\S)?)\k<marker>$/u.exec(line)?.groups;
    const raw =
      emphasis?.inner !== undefined && !emphasis.inner.includes(emphasis.marker!)
        ? emphasis.inner
        : line;
    const title = normalizeSessionTitle(raw, Number.MAX_SAFE_INTEGER);
    if (title.length === 0) throw new Error('clutch-dsh-title: plain title model produced no text');
    return { title, messageSeqs: [first.seq], model: response.model };
  };
}
