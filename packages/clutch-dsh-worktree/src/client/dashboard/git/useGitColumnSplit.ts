import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from 'react';
import {
  GIT_COLUMN_SPLIT_DEFAULT_PERCENT,
  GIT_COLUMN_SPLIT_KEY_STEP,
  clampGitColumnSplitPercent,
  gitColumnSplitPercentFromPointer,
} from './git-column-split.js';
import type { GitColumnStackGeometry } from './git-column-split.js';

/**
 * Remembers the last divider position for the rest of the browser session, so
 * closing and reopening the Git tab keeps the height the user dragged to.
 */
let rememberedSplitPercent: number | undefined;

export interface GitColumnSplit {
  /** Attach to the stacked column that owns the commits and changed-files panes. */
  readonly stackRef: MutableRefObject<HTMLDivElement | null>;
  /** Attach to the draggable divider between both panes. */
  readonly splitterRef: MutableRefObject<HTMLDivElement | null>;
  /** Commits-pane share of the stacked column, in percent. */
  readonly percent: number;
  readonly dragging: boolean;
  readonly startDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly drag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly endDrag: (event: ReactPointerEvent<HTMLDivElement>) => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  readonly reset: () => void;
}

/**
 * Resize the stacked Git column with a pointer or the keyboard. The dragging
 * frame writes straight to the DOM custom property so heavy commit and file
 * lists never re-render per pointer move; React state commits once per gesture.
 */
export function useGitColumnSplit(): GitColumnSplit {
  const stackRef = useRef<HTMLDivElement | null>(null);
  const splitterRef = useRef<HTMLDivElement | null>(null);
  const [percent, setPercent] = useState(
    rememberedSplitPercent ?? GIT_COLUMN_SPLIT_DEFAULT_PERCENT,
  );
  const [dragging, setDragging] = useState(false);
  const percentRef = useRef(percent);
  const geometryRef = useRef<GitColumnStackGeometry | undefined>(undefined);
  const draggingRef = useRef(false);

  const applyPercent = useCallback((next: number) => {
    percentRef.current = next;
    stackRef.current?.style.setProperty('--git-stack-top', next + '%');
    splitterRef.current?.setAttribute('aria-valuenow', String(Math.round(next)));
  }, []);

  const commitPercent = useCallback(
    (next: number) => {
      applyPercent(next);
      rememberedSplitPercent = next;
      setPercent(next);
    },
    [applyPercent],
  );

  useEffect(() => {
    applyPercent(percent);
    rememberedSplitPercent = percent;
  }, [applyPercent, percent]);

  useEffect(() => {
    if (!dragging) return undefined;
    // Keep the resize cursor and suppress selection while the pointer is captured.
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  const measure = useCallback((): GitColumnStackGeometry | undefined => {
    const stack = stackRef.current;
    const splitter = splitterRef.current;
    if (stack === null || splitter === null) return undefined;
    const stackRect = stack.getBoundingClientRect();
    return {
      top: stackRect.top,
      height: stackRect.height,
      divider: splitter.getBoundingClientRect().height,
    };
  }, []);

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

  const drag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const geometry = geometryRef.current;
    if (!draggingRef.current || geometry === undefined) return;
    applyPercent(gitColumnSplitPercentFromPointer(event.clientY, geometry));
  }, [applyPercent]);

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
          : clampGitColumnSplitPercent(percentRef.current, geometry),
      );
    },
    [commitPercent, measure],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
      if (direction === 0) return;
      const geometry = measure();
      if (geometry === undefined) return;
      event.preventDefault();
      const step = GIT_COLUMN_SPLIT_KEY_STEP * (event.shiftKey ? 4 : 1);
      commitPercent(
        clampGitColumnSplitPercent(percentRef.current + direction * step, geometry),
      );
    },
    [commitPercent, measure],
  );

  const reset = useCallback(() => {
    commitPercent(GIT_COLUMN_SPLIT_DEFAULT_PERCENT);
  }, [commitPercent]);

  return { stackRef, splitterRef, percent, dragging, startDrag, drag, endDrag, onKeyDown, reset };
}
