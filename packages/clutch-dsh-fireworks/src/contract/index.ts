import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection/types';

export const FIREWORKS_TOOL_NAME = 'happy_fireworks' as const;
export const FIREWORKS_PROJECTION_KEY = 'fireworks' as const;
export const FIREWORKS_META_KIND = 'clutch-dsh-fireworks' as const;
export const SETTINGS_NAMESPACE = 'clutch-dsh-fireworks' as const;
export const FIREWORKS_DURATION_MS = 3_200;
export const MAX_FIREWORKS_MESSAGE_CHARS = 120;

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
