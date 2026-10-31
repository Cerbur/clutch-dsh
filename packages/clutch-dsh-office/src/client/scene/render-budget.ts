/** Preserve Retina detail; never enlarge a sub-CSS-resolution render on large windows. */
export function kitchenPixelRatio(width: number, height: number, deviceRatio: number): number {
  const native = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  const pixels = Math.max(1, width) * Math.max(1, height);
  return Math.min(native, 2, Math.max(1, Math.sqrt(8_000_000 / pixels)));
}

/** Small prop atlases occupy tens of screen pixels; preserve larger hero surfaces. */
export function kitchenTextureSize(name: string): number {
  return [
    'deepseek',
    'floor',
    'refrigerator',
    'table',
    'sink-cabinet',
    'stove',
    'storage-cabinet',
    'wall-cabinet',
    'wall-shelf',
    'rug',
    'floor-mat',
  ].includes(name)
    ? 1024
    : 512;
}
