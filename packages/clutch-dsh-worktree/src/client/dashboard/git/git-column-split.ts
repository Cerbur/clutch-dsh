/**
 * Geometry for the stacked Git column: the commits pane, a draggable divider, and
 * the changed-files pane share one bounded column. These helpers stay free of DOM
 * and React APIs so the drag math is unit-testable and the panel only wires events.
 */

/** Share of the stacked column, in percent, given to the commits pane by default. */
export const GIT_COLUMN_SPLIT_DEFAULT_PERCENT = 45;

/** Smallest rendered height, in CSS pixels, kept usable for either stacked pane. */
export const GIT_COLUMN_SPLIT_MIN_PANE_PX = 140;

/** Percentage points moved by one arrow-key press (Shift multiplies the step). */
export const GIT_COLUMN_SPLIT_KEY_STEP = 4;

/** Rendered box of the stacked column, measured once per interaction. */
export interface GitColumnStackGeometry {
  /** Viewport-relative top edge of the stacked column. */
  readonly top: number;
  /** Rendered height of the stacked column, in CSS pixels. */
  readonly height: number;
  /** Rendered height of the draggable divider, in CSS pixels. */
  readonly divider: number;
}

function roundPercent(percent: number): number {
  return Math.round(percent * 100) / 100;
}

/**
 * Keep the divider inside the range that leaves both stacked panes usable.
 * Degenerate geometry (unmounted or zero-height layouts) falls back to the default.
 */
export function clampGitColumnSplitPercent(
  percent: number,
  geometry: GitColumnStackGeometry,
): number {
  if (!Number.isFinite(percent)) return GIT_COLUMN_SPLIT_DEFAULT_PERCENT;
  const { height, divider } = geometry;
  if (!Number.isFinite(height) || height <= 0) return GIT_COLUMN_SPLIT_DEFAULT_PERCENT;
  const minimum = (GIT_COLUMN_SPLIT_MIN_PANE_PX / height) * 100;
  const maximum =
    100 - ((GIT_COLUMN_SPLIT_MIN_PANE_PX + Math.max(divider, 0)) / height) * 100;
  if (maximum <= minimum) return GIT_COLUMN_SPLIT_DEFAULT_PERCENT;
  return roundPercent(Math.min(Math.max(percent, minimum), maximum));
}

/** Resolve the commits-pane share that keeps the divider centered under a pointer. */
export function gitColumnSplitPercentFromPointer(
  pointerY: number,
  geometry: GitColumnStackGeometry,
): number {
  const halfDivider = Math.max(geometry.divider, 0) / 2;
  const topPanePx = pointerY - geometry.top - halfDivider;
  return clampGitColumnSplitPercent((topPanePx / geometry.height) * 100, geometry);
}
