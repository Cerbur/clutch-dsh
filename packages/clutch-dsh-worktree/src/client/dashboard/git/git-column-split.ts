/**
 * Geometry for the two draggable Git dividers. Each divider splits one grid axis
 * of the panel into a leading pane, the divider itself, and a trailing pane.
 * These helpers stay free of DOM and React APIs so the drag math is testable.
 */

/** Share of the stacked axis, in percent, given to the commits pane by default. */
export const GIT_SPLIT_DEFAULT_ROW_PERCENT = 45;

/** Share of the side-by-side axis, in percent, given to the left column by default. */
export const GIT_SPLIT_DEFAULT_COLUMN_PERCENT = 38;

/** Smallest rendered height, in CSS pixels, kept usable for a stacked pane. */
export const GIT_SPLIT_MIN_ROW_PX = 140;

/** Smallest rendered width, in CSS pixels, kept usable for a side-by-side pane. */
export const GIT_SPLIT_MIN_COLUMN_PX = 240;

/** Percentage points moved by one arrow-key press (Shift multiplies the step). */
export const GIT_SPLIT_KEY_STEP = 4;

/** Rendered box of the grid one divider splits, measured once per interaction. */
export interface GitSplitGeometry {
  /** Viewport-relative leading edge: the top for row splits, the left for column splits. */
  readonly start: number;
  /** Rendered container size along the split axis, in CSS pixels. */
  readonly size: number;
  /** Rendered divider thickness, in CSS pixels. */
  readonly divider: number;
  /** Smallest pane size along the split axis, in CSS pixels. */
  readonly minimum: number;
}

function roundPercent(percent: number): number {
  return Math.round(percent * 100) / 100;
}

/**
 * Clamp a leading-pane share to the range that keeps both panes usable, or
 * undefined when the measured geometry cannot express a usable split at all.
 */
export function clampGitSplitPercent(
  percent: number,
  geometry: GitSplitGeometry,
): number | undefined {
  if (!Number.isFinite(percent)) return undefined;
  const { size, divider, minimum } = geometry;
  if (!Number.isFinite(size) || size <= 0) return undefined;
  const lower = (minimum / size) * 100;
  const upper = 100 - ((minimum + Math.max(divider, 0)) / size) * 100;
  if (upper <= lower) return undefined;
  return roundPercent(Math.min(Math.max(percent, lower), upper));
}

/** Resolve the share that keeps the divider centered under a pointer. */
export function gitSplitPercentFromPointer(
  pointer: number,
  geometry: GitSplitGeometry,
): number | undefined {
  const halfDivider = Math.max(geometry.divider, 0) / 2;
  const leadingPx = pointer - geometry.start - halfDivider;
  return clampGitSplitPercent((leadingPx / geometry.size) * 100, geometry);
}
