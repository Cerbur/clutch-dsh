import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';

export const FIREWORKS_TOOL_NAME = 'happy_fireworks' as const;
export const FIREWORKS_PROJECTION_KEY = 'fireworks' as const;
export const FIREWORKS_META_KIND = 'clutch-dsh-fireworks' as const;
export const FIREWORKS_DURATION_MS = 3_200;
export const MAX_FIREWORKS_MESSAGE_CHARS = 120;

export interface FireworksSignal {
  readonly id: string;
  readonly message?: string;
}

export type FireworksProjection = FireworksSignal | null;

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    fireworks: FireworksProjection;
  }

  interface SessionProjectionStateMap {
    fireworks: FireworksProjection;
  }
}

export type { SessionProjectionMap };
