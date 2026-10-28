type RGB = readonly [number, number, number];
export interface IndirectEnvironment {
  base: RGB;
  lobes: readonly { direction: RGB; radiance: RGB; exponent: number }[];
}

/** Linear incoming radiance of passive room bounce, not another set of direct lights. */
export function sampleIndirectEnvironment(direction: RGB, profile: IndirectEnvironment): RGB {
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length) || length === 0) throw new Error('Invalid environment direction');
  const rgb: [number, number, number] = [...profile.base];
  for (const lobe of profile.lobes) {
    const norm = Math.hypot(...lobe.direction);
    const cosine = Math.max(
      0,
      direction.reduce((sum, value, i) => sum + value * lobe.direction[i], 0) / (length * norm),
    );
    const weight = Math.pow(Math.min(1, cosine), lobe.exponent);
    for (let i = 0; i < 3; i++) rgb[i] += lobe.radiance[i] * weight;
  }
  return rgb;
}
