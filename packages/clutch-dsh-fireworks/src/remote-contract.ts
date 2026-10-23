import { z } from 'zod';
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry';
import { parseAnimationPreferences, type AnimationPreferences } from './animation.js';
import {
  FIREWORKS_EVENTS_ENDPOINT,
  parseFireworksEventBatch,
  type FireworksEventBatch,
} from './contract/index.js';

const resumeSchema = z
  .object({
    epoch: z.string().min(1).max(128).optional(),
    after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict()
  .refine(
    (value) => (value.epoch === undefined) === (value.after === undefined),
    'epoch and after must be provided together',
  );

const batchSchema = z.custom<FireworksEventBatch>((value) => {
  try {
    parseFireworksEventBatch(value);
    return true;
  } catch {
    return false;
  }
});

const preferencesSchema = z.custom<AnimationPreferences>((value) => {
  try {
    if (value === undefined) return false;
    parseAnimationPreferences(value);
    return true;
  } catch {
    return false;
  }
});
const animationSettingsSchema = z
  .object({
    preferences: preferencesSchema,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    writable: z.boolean(),
    error: z.string().optional(),
  })
  .strict();
const animationSaveSchema = z
  .object({
    preferences: preferencesSchema,
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

/** One explicit public descriptor shared by Host registration and Client mount. */
export const FIREWORKS_REMOTE: TypertRemoteContribution = {
  package: '@cerbur/clutch-dsh-fireworks',
  descriptors: [
    {
      id: '@cerbur/clutch-dsh-fireworks#' + FIREWORKS_EVENTS_ENDPOINT,
      service: 'clutch_fireworks',
      namespace: 'clutch_fireworks',
      method: 'events',
      mode: 'stream',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'query',
          wire: 'query',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@cerbur/clutch-dsh-fireworks#FireworksResumeCursor',
            create: () => resumeSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@cerbur/clutch-dsh-fireworks#FireworksEventBatch',
        create: () => batchSchema,
      },
    },
    ...(['loadAnimations', 'saveAnimations'] as const).map((method) => ({
      id: '@cerbur/clutch-dsh-fireworks#clutch_fireworks/' + method,
      service: 'clutch_fireworks',
      namespace: 'clutch_fireworks',
      method,
      invocation: { kind: 'direct' as const },
      parameters:
        method === 'loadAnimations'
          ? []
          : [
              {
                name: 'request',
                wire: 'request',
                source: 'json' as const,
                codec: {
                  mode: 'strict' as const,
                  typeSymbol: '@cerbur/clutch-dsh-fireworks#AnimationSaveRequest',
                  create: () => animationSaveSchema,
                },
              },
            ],
      cancellation: { parameter: 'signal' as const },
      result: {
        mode: 'strict' as const,
        typeSymbol: '@cerbur/clutch-dsh-fireworks#AnimationSettingsValue',
        create: () => animationSettingsSchema,
      },
    })),
  ],
};

/** Runtime registration avoids a second owner in the automatic ./typert loader. */
export const FIREWORKS_HOST: TypertContribution = {
  package: FIREWORKS_REMOTE.package,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: FIREWORKS_REMOTE.descriptors,
};
