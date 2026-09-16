import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { GIT_SPLIT_KEY_STEP, clampGitSplitPercent, gitSplitPercentFromPointer } from './git-column-split.js';
import type { GitSplitGeometry } from './git-column-split.js';

/**
 * Remembers every divider position for the rest of the browser session, so
 * closing and reopening the Git tab keeps the split the user dragged to.
 */
const rememberedPercents = new Map<string, number>();

export type GitSplitOrientation = 'horizontal' | 'vertical';

/** Arrow keys that move a leading pane forward or backward along one axis. */
const KEY_DIRECTIONS: Record<GitSplitOrientation, Record<string, number>> = {
  horizontal: { ArrowUp: -1, ArrowDown: 1 },
  vertical: { ArrowLeft: -1, ArrowRight: 1 },
};

export interface GitPaneSplitOptions {
  /** The grid that holds both panes and the divider. */
  readonly containerRef: MutableRefObject<HTMLDivElement | null>;
  /** `horizontal` splits rows by height, `vertical` splits columns by width. */
  readonly orientation: GitSplitOrientation;
  /** CSS custom property on the container that carries the leading-pane share. */
  readonly property: string;
  /** Smallest pane size along the axis, in CSS pixels. */
  readonly minimum: number;
  /** Default share used before the first drag. */
  readonly fallback: number;
}

export interface GitPaneSplit {
  /** Attach to the draggable divider between both panes. */
  readonly splitterRef: MutableRefObject<HTMLDivElement | null>;
  /** Leading-pane share along this axis, in percent. */
  readonly percent: number;
  readonly dragging: boolean;
  readonly startDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly drag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly endDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  readonly reset: () => void;
}

/**
 * Resize one grid axis with a pointer or the keyboard. The dragging frame writes
 * straight to the DOM custom property, so heavy commit and file lists never
 * re-render per pointer move; React state commits once per gesture.
 */
export function useGitPaneSplit(options: GitPaneSplitOptions): GitPaneSplit {
  const { containerRef, orientation, property, minimum, fallback } = options;
  const splitterRef = useRef<HTMLDivElement | null>(null);
  const [percent, setPercent] = useState(() => rememberedPercents.get(property) ?? fallback);
  const [dragging, setDragging] = useState(false);
  const percentRef = useRef(percent);
  const geometryRef = useRef<GitSplitGeometry | undefined>(undefined);
  const draggingRef = useRef(false);

  const applyPercent = useCallback(
    (next: number) => {
      percentRef.current = next;
      containerRef.current?.style.setProperty(property, next + '%');
      splitterRef.current?.setAttribute('aria-valuenow', String(Math.round(next)));
    },
    [containerRef, property],
  );

  const commitPercent = useCallback(
    (next: number) => {
      applyPercent(next);
      rememberedPercents.set(property, next);
      setPercent(next);
    },
    [applyPercent, property],
  );

  useEffect(() => {
    applyPercent(percent);
    rememberedPercents.set(property, percent);
  }, [applyPercent, percent, property]);

  useEffect(() => {
    if (!dragging) return undefined;
    // Keep the resize cursor and suppress selection while the pointer is captured.
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = orientation === 'horizontal' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging, orientation]);

  const measure = useCallback((): GitSplitGeometry | undefined => {
    const container = containerRef.current;
    const splitter = splitterRef.current;
    if (container === null || splitter === null) return undefined;
    const containerRect = container.getBoundingClientRect();
    const splitterRect = splitter.getBoundingClientRect();
    return orientation === 'horizontal'
      ? { start: containerRect.top, size: containerRect.height, divider: splitterRect.height, minimum }
      : { start: containerRect.left, size: containerRect.width, divider: splitterRect.width, minimum };
  }, [containerRef, minimum, orientation]);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const geometry = measure();
      if (geometry === undefined) return;
      geometryRef.current = geometry;
      draggingRef.current = true;
      setDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      // preventDefault suppresses the default focus; keep the divider keyboard-reachable.
      event.currentTarget.focus({ preventScroll: true });
    },
    [measure],
  );

  const drag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const geometry = geometryRef.current;
      if (!draggingRef.current || geometry === undefined) return;
      const pointer = orientation === 'horizontal' ? event.clientY : event.clientX;
      const next = gitSplitPercentFromPointer(pointer, geometry);
      if (next !== undefined) applyPercent(next);
    },
    [applyPercent, orientation],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      geometryRef.current = undefined;
      setDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      const geometry = measure();
      commitPercent(
        geometry === undefined
          ? percentRef.current
          : clampGitSplitPercent(percentRef.current, geometry) ?? percentRef.current,
      );
    },
    [commitPercent, measure],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const direction = KEY_DIRECTIONS[orientation][event.key];
      if (direction === undefined) return;
      const geometry = measure();
      if (geometry === undefined) return;
      event.preventDefault();
      const step = GIT_SPLIT_KEY_STEP * (event.shiftKey ? 4 : 1);
      const next = clampGitSplitPercent(percentRef.current + direction * step, geometry);
      if (next !== undefined) commitPercent(next);
    },
    [commitPercent, measure, orientation],
  );

  const reset = useCallback(() => {
    commitPercent(fallback);
  }, [commitPercent, fallback]);

  return { splitterRef, percent, dragging, startDrag, drag, endDrag, onKeyDown, reset };
}
