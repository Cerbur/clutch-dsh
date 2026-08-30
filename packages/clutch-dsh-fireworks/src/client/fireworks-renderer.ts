import type { FireworksSignal } from '../contract/index.js';

export interface FireworksVisualPlacement {
  readonly left: number;
  readonly top: number;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly rotationDeg: number;
  readonly scale: number;
}

export interface FireworksEmojiVisual extends FireworksVisualPlacement {
  readonly kind: 'emoji';
  readonly glyph: string;
}

export interface FireworksSvgVisual extends FireworksVisualPlacement {
  readonly kind: 'svg';
  /** A future renderer supplies a trusted local or package asset URL. */
  readonly src: string;
  readonly alt?: string;
}

export type FireworksVisual = FireworksEmojiVisual | FireworksSvgVisual;

export interface FireworksRenderer {
  createVisuals(signal: FireworksSignal): readonly FireworksVisual[];
}

const EMOJI = [
  '🎉',
  '🌟',
  '✨',
  '🎊',
  '💫',
  '🎆',
  '🎇',
  '🥳',
  '👏',
  '🙌',
  '💖',
  '❤️',
  '🧡',
  '💛',
  '💚',
  '💙',
  '💜',
  '🎈',
  '🎁',
  '🏆',
  '🪅',
  '🍾',
  '🚀',
  '🎂',
] as const;

const FIREWORKS_VISUAL_COUNT = 40;
const REQUIRED_GLYPHS = ['🎉', '🌟', '✨'] as const;

function hashSignalId(id: string): number {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function nextSeed(seed: number): number {
  let next = (seed + 0x6d2b79f5) >>> 0;
  next = Math.imul(next ^ (next >>> 15), next | 1);
  next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
  return (next ^ (next >>> 14)) >>> 0;
}

function createBurstGlyphs(seed: number): readonly string[] {
  const glyphs: string[] = [
    ...Array.from({ length: 10 }, () => REQUIRED_GLYPHS[0]),
    ...Array.from({ length: 5 }, () => REQUIRED_GLYPHS[1]),
    ...Array.from({ length: 5 }, () => REQUIRED_GLYPHS[2]),
  ];
  let roll = seed;

  for (let index = glyphs.length; index < FIREWORKS_VISUAL_COUNT; index += 1) {
    roll = nextSeed(roll);
    glyphs.push(EMOJI[roll % EMOJI.length]);
  }

  for (let index = glyphs.length - 1; index > 0; index -= 1) {
    roll = nextSeed(roll);
    const swapIndex = roll % (index + 1);
    [glyphs[index], glyphs[swapIndex]] = [glyphs[swapIndex], glyphs[index]];
  }

  return glyphs;
}

export function createEmojiFireworksVisuals(
  signal: FireworksSignal,
): readonly FireworksEmojiVisual[] {
  const seed = hashSignalId(signal.id);
  const glyphs = createBurstGlyphs(seed);
  return glyphs.map((glyph, index) => ({
    kind: 'emoji' as const,
    glyph,
    left: 4 + ((seed + index * 37) % 93),
    top: -8 + ((seed + index * 53) % 117),
    delayMs: (seed + index * 41) % 721,
    durationMs: 2_300 + ((seed + index * 17) % 1_000),
    rotationDeg: -35 + ((seed + index * 29) % 71),
    scale: 1.15 + ((seed + index * 11) % 51) / 100,
  }));
}

export const emojiFireworksRenderer: FireworksRenderer = {
  createVisuals: createEmojiFireworksVisuals,
};
