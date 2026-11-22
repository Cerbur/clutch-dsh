import { isBehindModal } from '@deepseek-ai/dsh-client-ui-primitives';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PluginAttribution } from '../PluginAttribution.js';
import type { WorktreeTranslate } from '../surface/types.js';
import styles from '../worktree.css';
import {
  computeEntryGuidePosition,
  ENTRY_GUIDE_FALLBACK_SIZE,
  hasSeenEntryGuide,
  isEntryAvailable,
  markEntryGuideSeen,
  type EntryGuidePosition,
} from './entry-guide.js';

export interface EntryGuideProps {
  /** The mounted entry button; the bubble anchors to its viewport rect. */
  readonly anchor: HTMLElement;
  readonly t: WorktreeTranslate;
  readonly onDismiss: () => void;
}

// A document remembers an actual display even if its browser rejects storage writes.
const shownDocuments = new WeakSet<Document>();

function canShowEntryGuide(anchor: HTMLElement): boolean {
  return !anchor.ownerDocument.hidden && isEntryAvailable(anchor) && !isBehindModal(anchor);
}

function entryReceivesPointer(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  // In a short viewport, positioning the guide can put it over the button.
  // Check the shell layer immediately beneath our own guide in that case.
  const stack = anchor.ownerDocument.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  const target = stack.find(element => !element.closest('[data-worktree-entry-guide]'));
  return target !== undefined && anchor.contains(target);
}

/** Keep the button mounted even when its native scrollport clips it completely. */
export function EntryGuide(props: EntryGuideProps) {
  const { anchor } = props;
  const [visibleAnchor, setVisibleAnchor] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const doc = anchor.ownerDocument;
    const seen = () => shownDocuments.has(doc) || hasSeenEntryGuide();
    if (seen()) return;
    let intersects = false;
    let retry: number | undefined;
    const sync = () => {
      window.clearTimeout(retry);
      const available = intersects && canShowEntryGuide(anchor);
      const clickable = available && entryReceivesPointer(anchor);
      // A floating panel can uncover the button without changing its intersection
      // or mounting a portal. Retry only while an unseen, on-screen entry is covered.
      if (available && !clickable && !seen()) retry = window.setTimeout(sync, 250);
      setVisibleAnchor(current => {
        if (!clickable) return null;
        return current === anchor || !seen() ? anchor : null;
      });
    };
    const observer = new window.IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      intersects = !!entry && entry.intersectionRatio > 0;
      sync();
    }, { threshold: [0, 0.001] });
    observer.observe(anchor);
    // Settings mounts a portal beside the app root. Its mask changes modal
    // ownership without moving the entry or changing its intersection.
    const portals = new window.MutationObserver(sync);
    portals.observe(doc.body, { childList: true });
    // The right panel covers the entry in place when the shell switches to fullscreen.
    const frame = doc.querySelector('[data-shell-overlay]')?.parentElement;
    if (frame?.contains(anchor)) {
      portals.observe(frame, { attributes: true, attributeFilter: ['data-rightbar-fullscreen'] });
    }
    doc.addEventListener('visibilitychange', sync);
    return () => {
      window.clearTimeout(retry);
      observer.disconnect();
      portals.disconnect();
      doc.removeEventListener('visibilitychange', sync);
    };
  }, [anchor]);
  return visibleAnchor === anchor ? <VisibleEntryGuide {...props} /> : null;
}

function VisibleEntryGuide({ anchor, t, onDismiss }: EntryGuideProps) {
  const bubble = useRef<HTMLDivElement>(null);
  const drawer = anchor.closest<HTMLElement>('[role="dialog"][aria-modal="true"]');
  const [position, setPosition] = useState<EntryGuidePosition | null>(null);
  const titleId = useId();
  const positioned = position !== null;
  useLayoutEffect(() => {
    if (positioned && canShowEntryGuide(anchor) && entryReceivesPointer(anchor)) {
      shownDocuments.add(anchor.ownerDocument);
      markEntryGuideSeen();
    }
  }, [anchor, positioned]);

  useLayoutEffect(() => {
    // Retain the drawer's DOM/focus ownership while escaping its transformed,
    // clipped column. A manual popover leaves focus and dismissal to this guide.
    const element = bubble.current;
    if (!element) return;
    if (drawer && typeof element.showPopover === 'function') {
      element.popover = 'manual';
      element.showPopover();
    }
    // A sibling can move the button without a resize, scroll or intersection event.
    // Track geometry only during the visible hint and publish only changed positions.
    let previous: EntryGuidePosition | undefined;
    let frame: number;
    const place = () => {
      const size = element.getBoundingClientRect();
      const next = computeEntryGuidePosition(anchor.getBoundingClientRect(), {
        width: size.width || ENTRY_GUIDE_FALLBACK_SIZE.width,
        height: size.height || ENTRY_GUIDE_FALLBACK_SIZE.height,
      }, { width: window.innerWidth, height: window.innerHeight });
      if (!previous || next.top !== previous.top || next.left !== previous.left ||
          next.placement !== previous.placement || next.arrowLeft !== previous.arrowLeft) {
        previous = next;
        setPosition(next);
      }
      frame = window.requestAnimationFrame(place);
    };
    place();
    return () => {
      window.cancelAnimationFrame(frame);
      if (drawer && element.popover === 'manual') {
        element.hidePopover();
        element.removeAttribute('popover');
      }
    };
  }, [anchor, drawer]);

  const dismissFromGuide = useCallback(() => {
    if (bubble.current?.contains(anchor.ownerDocument.activeElement)) anchor.focus({ preventScroll: true });
    onDismiss();
  }, [anchor, onDismiss]);

  useEffect(() => {
    // DSH menus and the attribution card consume Escape in document capture.
    // Handle the remaining key inside the drawer before its document bubble listener.
    const keyboardTarget: GlobalEventHandlers = drawer ?? window;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !canShowEntryGuide(anchor)) return;
      if (drawer) {
        event.preventDefault();
        event.stopPropagation();
      }
      dismissFromGuide();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target === null || !canShowEntryGuide(anchor)) return;
      if (bubble.current?.contains(target) === true) return;
      // Clicking the entry itself opens the mode; let the button own that path.
      if (anchor.contains(target)) return;
      onDismiss();
    };
    keyboardTarget.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      keyboardTarget.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [anchor, drawer, dismissFromGuide, onDismiss]);

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
        {t('mode.guide.title')}
      </p>
      <p className={styles.entryGuideBody}>{t('mode.guide.body')}</p>
      <div className={styles.entryGuideActions}>
        <button type="button" className={styles.entryGuideDismiss} onClick={dismissFromGuide}>
          {t('mode.guide.dismiss')}
        </button>
        <PluginAttribution t={t} cardContainer={bubble} />
      </div>
    </div>,
    drawer ?? anchor.ownerDocument.body,
  );
}
