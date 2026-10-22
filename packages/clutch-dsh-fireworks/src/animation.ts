/** Shared, versioned animation-file contract. Parsing never executes imported code. */
export const ANIMATION_NAMESPACE = 'clutch-dsh-fireworks';
export const MAX_SCRIPT_BYTES = 65_536;
export const MAX_CUSTOM_ANIMATIONS = 8;
export const MAX_ANIMATION_DURATION_MS = 8_000;

export interface AnimationTemplate {
  readonly id: string;
  readonly name: string;
  readonly durationMs: number;
  readonly source: string;
}

/** The complete drawing surface available to a v1 render(frame, fx) script. */
export interface AnimationFrame {
  readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly time: number;
  readonly delta: number;
  readonly progress: number;
  readonly durationMs: number;
  readonly seed: number;
  readonly message: string;
}
export interface AnimationHelpers {
  random(): number;
  clamp(value: number): number;
  easeOut(value: number): number;
  circle(x: number, y: number, radius: number, color: string, alpha?: number, glow?: number): void;
  ring(
    x: number,
    y: number,
    radius: number,
    color: string,
    lineWidth?: number,
    alpha?: number,
  ): void;
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    lineWidth?: number,
    alpha?: number,
  ): void;
  star(
    x: number,
    y: number,
    radius: number,
    color: string,
    alpha?: number,
    rotation?: number,
  ): void;
  emoji(text: string, x: number, y: number, size?: number, alpha?: number, rotation?: number): void;
}
export type AnimationRender = (frame: AnimationFrame, fx: AnimationHelpers) => void;

export interface AnimationPreferences {
  readonly active: string;
  readonly scripts: Readonly<Record<string, string>>;
}

export const DEFAULT_ANIMATION_PREFERENCES: AnimationPreferences = { active: 'emoji', scripts: {} };

export function parseAnimation(source: string, id: string): AnimationTemplate {
  if (new TextEncoder().encode(source).length > MAX_SCRIPT_BYTES)
    throw new Error('动画脚本不能超过 64 KiB / Animation exceeds 64 KiB');
  const header = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  const match = /^\/\/ clutch_fireworks: (.+)$/.exec(header);
  if (!match) throw new Error('缺少 clutch_fireworks 脚本头 / Missing animation header');
  const metadata = JSON.parse(match[1]);
  if (
    metadata?.version !== 1 ||
    typeof metadata.name !== 'string' ||
    metadata.name.trim().length === 0 ||
    metadata.name.length > 60 ||
    !Number.isInteger(metadata.durationMs) ||
    metadata.durationMs < 500 ||
    metadata.durationMs > MAX_ANIMATION_DURATION_MS
  )
    throw new Error('脚本头需要 version: 1、名称和 500–8000 ms 时长 / Invalid animation header');
  return { id, name: metadata.name.trim(), durationMs: metadata.durationMs, source };
}

export function parseAnimationPreferences(raw: unknown): AnimationPreferences {
  if (raw === undefined) return DEFAULT_ANIMATION_PREFERENCES;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('无效动画配置 / Invalid animation settings');
  const value = raw as Record<string, unknown>;
  if (
    typeof value.active !== 'string' ||
    value.scripts === null ||
    typeof value.scripts !== 'object' ||
    Array.isArray(value.scripts)
  )
    throw new Error('无效动画配置 / Invalid animation settings');
  const entries = Object.entries(value.scripts);
  if (entries.length > MAX_CUSTOM_ANIMATIONS)
    throw new Error('最多导入 8 个动画 / At most 8 animations');
  for (const [id, source] of entries) {
    if (!/^custom-[a-zA-Z0-9-]{1,64}$/.test(id) || typeof source !== 'string')
      throw new Error('无效自定义动画 / Invalid custom animation');
    parseAnimation(source, id);
  }
  if (
    !['emoji', 'classic', 'rings'].includes(value.active) &&
    !Object.hasOwn(value.scripts, value.active)
  )
    throw new Error('所选动画不存在 / Selected animation missing');
  return { active: value.active, scripts: Object.fromEntries(entries) };
}
