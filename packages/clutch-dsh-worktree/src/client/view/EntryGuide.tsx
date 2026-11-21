import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from '../worktree.css';
import {
  computeEntryGuidePosition,
  ENTRY_GUIDE_FALLBACK_SIZE,
  isEntryAvailable,
  type EntryGuidePosition,
} from './entry-guide.js';

export interface EntryGuideProps {
  /** The mounted entry button; the bubble anchors to its viewport rect. */
  readonly anchor: HTMLElement;
  readonly title: string;
  readonly body: string;
  readonly dismissLabel: string;
  readonly onDismiss: () => void;
}

/**
 * One-time, non-modal coach mark for the relocated Worktree entry. It portals to
 * `document.body` so the native toolbar's overflow cannot clip it, follows the
 * anchor across resize and scroll, and never steals focus from the sidebar.
 */
export function EntryGuide({ anchor, title, body, dismissLabel, onDismiss }: EntryGuideProps) {
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<EntryGuidePosition | null>(null);
  const titleId = useId();

  const place = useCallback(() => {
    const rect = anchor.getBoundingClientRect();
    const measured = bubble.current?.getBoundingClientRect();
    const size = {
      width: measured !== undefined && measured.width > 0 ? measured.width : ENTRY_GUIDE_FALLBACK_SIZE.width,
      height:
        measured !== undefined && measured.height > 0 ? measured.height : ENTRY_GUIDE_FALLBACK_SIZE.height,
    };
    setPosition(
      computeEntryGuidePosition(rect, size, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
  }, [anchor]);

  useLayoutEffect(() => {
    place();
    // The native drawer slides an ancestor without resizing or scrolling the entry.
    const onTransition = (event: TransitionEvent) => {
      if (event.target instanceof window.Element && event.target.contains(anchor)) place();
    };
    const doc = anchor.ownerDocument;
    doc.addEventListener('transitionend', onTransition, true);
    doc.addEventListener('transitioncancel', onTransition, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      doc.removeEventListener('transitionend', onTransition, true);
      doc.removeEventListener('transitioncancel', onTransition, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, place]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isEntryAvailable(anchor)) onDismiss();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null || !isEntryAvailable(anchor)) return;
      if (bubble.current?.contains(target) === true) return;
      // Clicking the entry itself opens the mode; let the button own that path.
      if (anchor.contains(target)) return;
      onDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [anchor, onDismiss]);

  return createPortal(
    <div
      ref={bubble}
      className={styles.entryGuide}
      data-worktree-entry-guide
      data-placement={position?.placement ?? 'below'}
      role="dialog"
      aria-labelledby={titleId}
      style={position === null ? { visibility: 'hidden' } : { top: position.top, left: position.left }}
    >
      <span
        className={styles.entryGuideArrow}
        aria-hidden="true"
        style={position === null ? undefined : { left: position.arrowLeft }}
      />
      <p id={titleId} className={styles.entryGuideTitle}>
        {title}
      </p>
      <p className={styles.entryGuideBody}>{body}</p>
      <button type="button" className={styles.entryGuideDismiss} onClick={onDismiss}>
        {dismissLabel}
      </button>
    </div>,
    document.body,
  );
}
