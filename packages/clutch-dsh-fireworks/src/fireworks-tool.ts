import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  FIREWORKS_MESSAGE_DESCRIPTION,
  FIREWORKS_META_KIND,
  FIREWORKS_TOOL_DESCRIPTION,
  FIREWORKS_TOOL_NAME,
  type FireworksMode,
} from './contract/index.js';
import { normalizeFireworksMessage } from './fireworks-projection.js';

/** Live settings the tool consults at call time. */
export interface FireworksToolPreferences {
  readonly mode: FireworksMode;
  readonly splashChance: number;
}

/**
 * Decide whether one show carries a splash shell. Rolled once per show so a
 * show holds at most one; skipped entirely outside realistic rendering.
 */
export function rollSplash(prefs: FireworksToolPreferences, random: () => number): boolean {
  if (prefs.mode !== 'realistic') return false;
  return random() < prefs.splashChance;
}

export function splashAnnouncement(chance: number): string {
  const percent = chance >= 0.001 ? `${Math.round(chance * 10_000) / 100}%` : '<0.1%';
  return (
    `Happy fireworks launched! 🎉 A rare splash shell burst overhead — only a ${percent} chance per show. ` +
    'Tell the user they just triggered the rare big-fat-fish (大肥鱼) splash fireworks!'
  );
}

export function createHappyFireworksTool(
  readPreferences: () => FireworksToolPreferences,
  random: () => number = Math.random,
) {
  return defineTool({
    name: FIREWORKS_TOOL_NAME,
    description: FIREWORKS_TOOL_DESCRIPTION,
    parameters: {
      message: {
        type: 'string',
        description: FIREWORKS_MESSAGE_DESCRIPTION,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          message: { type: 'string' },
          splash: { type: 'boolean' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.splash
            ? splashAnnouncement(readPreferences().splashChance)
            : value.message === undefined
              ? 'Happy fireworks launched! 🎉'
              : `Happy fireworks launched: ${value.message} 🎉`,
        },
      ],
      presentationMeta: (_args, value) => ({
        kind: FIREWORKS_META_KIND,
        id: value.id,
        ...(value.message === undefined ? {} : { message: value.message }),
        ...(value.splash === true ? { splash: true } : {}),
      }),
    },
    presentCall: () => ({
      card: 'generic',
      title: 'Launch happy fireworks',
      kind: 'other',
    }),
    presentResult: (_args, result) => ({
      card: 'generic',
      title: result.isError ? 'Fireworks failed' : 'Happy fireworks 🎉',
      content: result.content,
    }),
    execute(args, exec) {
      const message = normalizeFireworksMessage(args.message);
      const splash = rollSplash(readPreferences(), random);
      return Promise.resolve({
        id: String(exec.callId),
        ...(message === undefined ? {} : { message }),
        ...(splash ? { splash: true } : {}),
      });
    },
  });
}
