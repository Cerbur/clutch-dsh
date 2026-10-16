import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';

export const FIREWORKS_TOOL_NAME = 'happy_fireworks' as const;
export const FIREWORKS_PROJECTION_KEY = 'fireworks' as const;
export const FIREWORKS_META_KIND = 'clutch-dsh-fireworks' as const;
export const SETTINGS_NAMESPACE = 'clutch-dsh-fireworks' as const;
export const FIREWORKS_DURATION_MS = 3_200;
export const MAX_FIREWORKS_MESSAGE_CHARS = 120;
export const FIREWORKS_LAUNCH_EVENT = 'clutch_fireworks/launch' as const;
export const FIREWORKS_EVENTS_ENDPOINT = 'clutch_fireworks/events';
export const FIREWORKS_EVENT_TTL_MS = 30_000;
export const FIREWORKS_EVENT_LIMIT = 128;
export const FIREWORKS_TOAST_DURATION_MS = 8_000;
/** Fixed per-event deadline, including sandbox startup and both rendering branches. */
export const FIREWORKS_EVENT_TIMEOUT_MS = 12_000;

export const FIREWORKS_GUIDANCE_SECTION_NAME = 'tool:fireworks' as const;
export const FIREWORKS_GUIDANCE_SECTION_ORDER = 2950;
export const FIREWORKS_GUIDANCE_PROMPT =
  'When you reach a major milestone—such as finishing an architecture/design document or implementation plan, ' +
  'completing a feature implementation and verifying it, resolving a complex bug, or passing full verification—' +
  'invoke the `happy_fireworks` tool to celebrate the achievement with the user in your concluding turn. ' +
  'Do not invoke it for routine intermediate actions (such as reading a file or running git status).';

export const FIREWORKS_TOOL_DESCRIPTION =
  'Celebrate the completion of a significant work milestone by launching festive fireworks in the Web UI. ' +
  'You are explicitly expected and encouraged to invoke this tool upon reaching a major milestone, including: ' +
  '(1) finishing the design or specification of a document or plan, ' +
  '(2) completing the implementation and verification of a feature, ' +
  '(3) resolving and verifying a complex bug, or ' +
  '(4) passing the entire test suite after a refactor or migration. ' +
  'Do not call for trivial routine steps (e.g., reading a file, inspecting git status, running a single check). ' +
  'Provide an encouraging short message summarizing the achievement in the celebration banner.';

export const FIREWORKS_MESSAGE_DESCRIPTION =
  'Optional brief, congratulatory summary of what was accomplished to display in the celebration banner (e.g. "Worktree feature implemented & all tests passing!").';

export interface FireworksSignal {
  readonly id: string;
  readonly message?: string;
  readonly splash?: boolean;
}

export type FireworksProjection = FireworksSignal | null;

export interface FireworksLaunchEvent extends FireworksSignal {
  readonly type: typeof FIREWORKS_LAUNCH_EVENT;
  readonly sessionId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface FireworksEventBatch {
  readonly epoch: string;
  readonly cursor: number;
  readonly events: readonly FireworksLaunchEvent[];
}

export interface FireworksResumeCursor {
  readonly epoch?: string;
  readonly after?: number;
}

/** Validate the plugin wire boundary before handing notifications to the UI. */
export function parseFireworksEventBatch(input: unknown): FireworksEventBatch {
  const batch = input as Partial<FireworksEventBatch> | null;
  if (
    batch === null ||
    typeof batch !== 'object' ||
    typeof batch.epoch !== 'string' ||
    batch.epoch.length === 0 ||
    !Number.isSafeInteger(batch.cursor) ||
    (batch.cursor ?? -1) < 0 ||
    !Array.isArray(batch.events) ||
    batch.events.length > FIREWORKS_EVENT_LIMIT
  ) {
    throw new Error('clutch_fireworks: invalid event batch');
  }
  for (const event of batch.events) {
    if (
      event === null ||
      typeof event !== 'object' ||
      event.type !== FIREWORKS_LAUNCH_EVENT ||
      typeof event.id !== 'string' ||
      event.id.length === 0 ||
      typeof event.sessionId !== 'string' ||
      event.sessionId.length === 0 ||
      !Number.isFinite(event.issuedAt) ||
      !Number.isFinite(event.expiresAt) ||
      event.expiresAt <= event.issuedAt ||
      (event.message !== undefined &&
        (typeof event.message !== 'string' || event.message.length > MAX_FIREWORKS_MESSAGE_CHARS))
    ) {
      throw new Error('clutch_fireworks: invalid launch event');
    }
  }
  return batch as FireworksEventBatch;
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'clutch_fireworks/launch'(event: FireworksLaunchEvent): void;
  }
}

export type FireworksMode = 'emoji' | 'realistic';

export const FIREWORKS_DEFAULTS = {
  mode: 'realistic',
  showDurationMs: 3_200,
  showRatePerSec: 1.5,
  splashChance: 0.01,
} as const;

export const FIREWORKS_LIMITS = {
  minDurationMs: 1_500,
  maxDurationMs: 15_000,
  minRatePerSec: 0.3,
  maxRatePerSec: 4,
  maxLaunches: 16,
} as const;

/** Client-side view of the settings that steer rendering. */
export interface FireworksShowPreferences {
  readonly mode?: FireworksMode;
  readonly showDurationMs?: number;
  readonly showRatePerSec?: number;
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    fireworks: FireworksProjection;
  }

  interface SessionProjectionStateMap {
    fireworks: FireworksProjection;
  }
}

export type { SessionProjectionMap };
