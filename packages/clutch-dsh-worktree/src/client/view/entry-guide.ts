/** Browser-local marker for the first visible display of the relocated entry guide. */
export const ENTRY_GUIDE_STORAGE_KEY = 'clutch-dsh-worktree.entry-guide-seen';
const SHOWN = 'shown';

/** DSH keeps the native browser mounted in closed drawers and fully collapsed desktop columns. */
export function isEntryAvailable(element: HTMLElement): boolean {
  return element.isConnected && element.closest([
    '[inert]',
    '[hidden]',
    '[data-sidebar-drawer][data-sidebar-collapsed]',
    '[data-platform="darwin"] [data-sidebar-collapsed]',
    '[data-windows-titlebar] [data-sidebar-collapsed]',
  ].join(',')) === null;
}

/** Anchor geometry in viewport coordinates; structural so jsdom can supply zeroes. */
export interface EntryGuideRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface EntryGuideSize {
  readonly width: number;
  readonly height: number;
}

export interface EntryGuideViewport {
  readonly width: number;
  readonly height: number;
}

export interface EntryGuidePosition {
  readonly top: number;
  readonly left: number;
  /** Offset of the arrow inside the bubble, clamped away from the rounded corners. */
  readonly arrowLeft: number;
  readonly placement: 'above' | 'below';
}

/** Viewport padding kept around the bubble. */
export const ENTRY_GUIDE_MARGIN = 8;
/** Distance between the anchor and the bubble. */
export const ENTRY_GUIDE_GAP = 10;
/** Size used until the bubble has been measured; also the jsdom default. */
export const ENTRY_GUIDE_FALLBACK_SIZE: EntryGuideSize = { width: 264, height: 104 };

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum < minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

/** Resolve `window` without breaking non-DOM loads such as SSR or bundler probes. */
function localWindow(): (Window & typeof globalThis) | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window;
  } catch {
    return undefined;
  }
}

function resolveStorage(storage?: Storage): Storage | undefined {
  if (storage !== undefined) return storage;
  try {
    const fromWindow = localWindow()?.localStorage;
    if (fromWindow !== undefined) return fromWindow;
  } catch {
    // Access can throw when the browser blocks storage; the guide then repeats once.
  }
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Earlier marker values recorded actions that could occur before the guide appeared. */
export function hasSeenEntryGuide(storage?: Storage): boolean {
  try {
    return resolveStorage(storage)?.getItem(ENTRY_GUIDE_STORAGE_KEY) === SHOWN;
  } catch {
    return false;
  }
}

/** Record the guide as seen; a blocked or full storage only costs one repeat. */
export function markEntryGuideSeen(storage?: Storage): void {
  try {
    const target = resolveStorage(storage);
    if (target && target.getItem(ENTRY_GUIDE_STORAGE_KEY) !== SHOWN) {
      target.setItem(ENTRY_GUIDE_STORAGE_KEY, SHOWN);
    }
  } catch {
    // Persistence is best effort; the guide must never break navigation.
  }
}

/**
 * Place the bubble below the entry, flipping above when the viewport runs out of
 * room and clamping both axes so the bubble and its arrow stay visible.
 */
export function computeEntryGuidePosition(
  anchor: EntryGuideRect,
  size: EntryGuideSize = ENTRY_GUIDE_FALLBACK_SIZE,
  viewport: EntryGuideViewport,
): EntryGuidePosition {
  const width = Math.max(size.width, 0);
  const height = Math.max(size.height, 0);
  const below = anchor.top + anchor.height + ENTRY_GUIDE_GAP;
  const above = anchor.top - height - ENTRY_GUIDE_GAP;
  const fitsBelow = below + height <= viewport.height - ENTRY_GUIDE_MARGIN;
  const fitsAbove = above >= ENTRY_GUIDE_MARGIN;
  const placement: EntryGuidePosition['placement'] = fitsBelow || !fitsAbove ? 'below' : 'above';
  const desiredTop = placement === 'below' ? below : above;
  const top = clamp(
    desiredTop,
    ENTRY_GUIDE_MARGIN,
    Math.max(viewport.height - height - ENTRY_GUIDE_MARGIN, ENTRY_GUIDE_MARGIN),
  );
  const centered = anchor.left + anchor.width / 2 - width / 2;
  const left = clamp(
    centered,
    ENTRY_GUIDE_MARGIN,
    Math.max(viewport.width - width - ENTRY_GUIDE_MARGIN, ENTRY_GUIDE_MARGIN),
  );
  const arrowLeft = clamp(
    anchor.left + anchor.width / 2 - left,
    16,
    Math.max(width - 16, 16),
  );
  return { top, left, arrowLeft, placement };
}
