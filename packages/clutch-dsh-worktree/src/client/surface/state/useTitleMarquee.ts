import { useEffect, useMemo, useRef, type RefObject } from 'react';

// Mirrors DSH ui-workspace rows/Rows.tsx: ignore tiny overflow, crawl at
// 30px/s, hold the tail, and restore the resting ellipsis on pointer leave.
const MIN_TITLE_REVEAL_PX = 8;
const TITLE_MARQUEE_PX_PER_MS = 0.03;

function placeTitle(title: HTMLSpanElement, left: number, range: number): void {
  if (typeof title.scrollTo === 'function') title.scrollTo({ left, behavior: 'instant' });
  else title.scrollLeft = left;
  if (left > 0) title.dataset.scrolled = '';
  else delete title.dataset.scrolled;
  if (left < range) title.dataset.clipped = '';
  else delete title.dataset.clipped;
}

function restTitle(title: HTMLSpanElement): void {
  placeTitle(title, 0, 0);
}

/** Native title reveal shared by Session and Worktree rows. */
export function useTitleMarquee(title: RefObject<HTMLSpanElement>) {
  const frame = useRef(0);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
    },
    [],
  );
  return useMemo(
    () => ({
      enter: () => {
        cancelAnimationFrame(frame.current);
        const element = title.current;
        if (element === null) return;
        const range = element.scrollWidth - element.clientWidth;
        if (range <= MIN_TITLE_REVEAL_PX) return;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          placeTitle(element, range, range);
          return;
        }
        let previous: number | undefined;
        let position = 0;
        const step = (now: DOMHighResTimeStamp) => {
          position += previous === undefined ? 0 : (now - previous) * TITLE_MARQUEE_PX_PER_MS;
          previous = now;
          placeTitle(element, Math.min(position, range), range);
          if (position < range) frame.current = requestAnimationFrame(step);
        };
        frame.current = requestAnimationFrame(step);
      },
      leave: () => {
        cancelAnimationFrame(frame.current);
        if (title.current !== null) restTitle(title.current);
      },
    }),
    [title],
  );
}
