import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type {} from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import {
  FIREWORKS_META_KIND,
  FIREWORKS_PROJECTION_KEY,
  FIREWORKS_TOOL_NAME,
  MAX_FIREWORKS_MESSAGE_CHARS,
  type FireworksProjection,
} from './contract/index.js';

export const fireworksProjectionSchema = z.union([
  z.object({ id: z.string(), message: z.string().optional() }),
  z.null(),
]);

export function normalizeFireworksMessage(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const message = input.trim();
  if (message.length === 0) return undefined;
  return message.slice(0, MAX_FIREWORKS_MESSAGE_CHARS);
}

interface FireworksMeta {
  readonly kind: typeof FIREWORKS_META_KIND;
  readonly id: string;
  readonly message?: string;
}

export function parseFireworksMeta(input: unknown): FireworksMeta | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (
    record.kind !== FIREWORKS_META_KIND ||
    typeof record.id !== 'string' ||
    record.id.length === 0
  ) {
    return undefined;
  }
  if (record.message !== undefined && typeof record.message !== 'string') return undefined;
  const message = normalizeFireworksMessage(record.message);
  return {
    kind: FIREWORKS_META_KIND,
    id: record.id,
    ...(message === undefined ? {} : { message }),
  };
}

export function applyFireworksProjection(
  state: FireworksProjection,
  event: SessionEvent,
): FireworksProjection {
  if (event.type === 'tool/result' && event.data.error === undefined) {
    const meta = parseFireworksMeta(event.data.meta);
    if (meta !== undefined && String(event.data.message.source.callId) === meta.id) {
      return {
        id: meta.id,
        ...(meta.message === undefined ? {} : { message: meta.message }),
      };
    }
  }

  if (
    (event.type as string) === 'tool/code-dispatch' &&
    !(event.data as { isError?: boolean })?.isError &&
    (event.data as { name?: string })?.name === FIREWORKS_TOOL_NAME
  ) {
    const rawArgs = (event.data as { arguments?: unknown })?.arguments;
    const record =
      rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : undefined;
    const message = normalizeFireworksMessage(record?.message);
    const subCallId = (event.data as { subCallId?: unknown })?.subCallId;
    if (typeof subCallId === 'string' && subCallId.length > 0) {
      return {
        id: subCallId,
        ...(message === undefined ? {} : { message }),
      };
    }
  }

  return state;
}

type FireworksProjectionDefinition = Omit<
  ProjectionDefinition<typeof FIREWORKS_PROJECTION_KEY, FireworksProjection>,
  'wire'
> & {
  wire: NonNullable<
    ProjectionDefinition<typeof FIREWORKS_PROJECTION_KEY, FireworksProjection>['wire']
  >;
};

export function createFireworksProjectionDefinition(): FireworksProjectionDefinition {
  return {
    key: FIREWORKS_PROJECTION_KEY,
    stateSchema: fireworksProjectionSchema,
    init: () => null,
    apply: applyFireworksProjection,
    wire: {
      viewSchema: fireworksProjectionSchema,
      view: (state) => state,
    },
    stateVersion: 1,
  };
}
