import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import { z } from 'zod';
import {
  FIREWORKS_META_KIND,
  FIREWORKS_PROJECTION_KEY,
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
  if (event.type !== 'tool/result' || event.data.error !== undefined) return state;
  const meta = parseFireworksMeta(event.data.meta);
  if (meta === undefined) return state;
  if (String(event.data.message.source.callId) !== meta.id) return state;
  return {
    id: meta.id,
    ...(meta.message === undefined ? {} : { message: meta.message }),
  };
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
