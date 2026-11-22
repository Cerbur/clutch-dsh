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
    if (hasSeenEntryGuide()) return;
    const doc = anchor.ownerDocument;
    let intersects = false;
    let retry: number | undefined;
    const sync = () => {
      window.clearTimeout(retry);
      const available = intersects && canShowEntryGuide(anchor);
      const clickable = available && entryReceivesPointer(anchor);
      // A floating panel can uncover the button without changing its intersection
      // or mounting a portal. Retry only while an unseen, on-screen entry is covered.
      if (available && !clickable && !hasSeenEntryGuide()) retry = window.setTimeout(sync, 250);
      setVisibleAnchor(current => {
        if (!clickable) return null;
        return current === anchor || !hasSeenEntryGuide() ? anchor : null;
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
  useEffect(() => {
    if (positioned && canShowEntryGuide(anchor) && entryReceivesPointer(anchor)) markEntryGuideSeen();
  }, [anchor, positioned]);

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
    // Retain the drawer's DOM/focus ownership while escaping its transformed,
    // clipped column. A manual popover leaves focus and dismissal to this guide.
    const element = bubble.current;
    if (drawer && element && typeof element.showPopover === 'function') {
      element.popover = 'manual';
      element.showPopover();
    }
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
      if (drawer && element?.popover === 'manual') {
        element.hidePopover();
        element.removeAttribute('popover');
      }
      doc.removeEventListener('transitionend', onTransition, true);
      doc.removeEventListener('transitioncancel', onTransition, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, drawer, place]);

  const dismissFromGuide = useCallback(() => {
    if (bubble.current?.contains(anchor.ownerDocument.activeElement)) anchor.focus({ preventScroll: true });
    onDismiss();
  }, [anchor, onDismiss]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !canShowEntryGuide(anchor)) return;
      if (drawer) {
        // The nested attribution card and native menus own their first Escape.
        const target = event.target;
        if (!(target instanceof window.Element) || !drawer.contains(target) ||
            target.closest('[role="menu"]') || bubble.current?.querySelector('[aria-expanded="true"]')) return;
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
    window.addEventListener('keydown', onKeyDown, drawer !== null);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, drawer !== null);
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
