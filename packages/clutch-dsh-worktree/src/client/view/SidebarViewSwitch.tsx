import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconBranchOutline16 } from '../dsh-icons.js';
import styles from '../worktree.css';
import { EntryGuide } from './EntryGuide.js';
import { hasSeenEntryGuide, isEntryAvailable, markEntryGuideSeen } from './entry-guide.js';

/** Localized one-time guidance for the relocated entry. */
export interface SidebarEntryGuideCopy {
  readonly title: string;
  readonly body: string;
  readonly dismissLabel: string;
}

/** Props owned by the Browser Consumer; placement comes from DSH's public markers. */
export interface SidebarViewSwitchProps {
  /** Render only while the native Workspace browser owns the sidebar region. */
  readonly visible: boolean;
  /** Localized entry label used for the accessible name and tooltip. */
  readonly label: string;
  /** One-time coach mark shown next to the entry until this browser dismisses it. */
  readonly guide?: SidebarEntryGuideCopy;
  readonly onOpen: () => void;
}

interface SidebarTargets {
  readonly wide?: HTMLElement;
  readonly rail?: HTMLElement;
}

// DSH documents these toolbar/list markers as stable integration seams.
const HEADER_SELECTOR = '[data-sidebar-workspace-header]';
const LIST_SELECTOR = '[data-sidebar-list-area]';
const COLLAPSED_SELECTOR = '[data-sidebar-collapsed]';

/**
 * Resolve DSH's documented workspace-browser markers. The header is the wide
 * toolbar; the list area is the collapsed rail seat. The frame attribute owns
 * fold state, so neither path measures native geometry.
 */
function resolveTargets(): SidebarTargets {
  const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
  const list = document.querySelector<HTMLElement>(LIST_SELECTOR);
  const anchor = header ?? list;
  if (anchor === null) return {};
  if (anchor.closest(COLLAPSED_SELECTOR) !== null) {
    return list === null ? {} : { rail: list };
  }
  return header === null ? {} : { wide: header };
}

/** The shell frame owns collapse state; its overlay layer identifies the frame. */
function resolveFrame(anchor: HTMLElement): HTMLElement | undefined {
  const overlay = document.querySelector<HTMLElement>('[data-shell-overlay]');
  const parent = overlay?.parentElement;
  if (parent != null && parent.contains(anchor)) return parent;
  return anchor.closest<HTMLElement>(COLLAPSED_SELECTOR) ?? anchor.parentElement ?? undefined;
}

/** The sidebar column is the frame child that owns the browser anchor. */
function resolveColumn(anchor: HTMLElement, frame: HTMLElement): HTMLElement {
  let node = anchor;
  while (node.parentElement !== null && node.parentElement !== frame) node = node.parentElement;
  return node;
}

/** Follow the native browser across mount and fold changes with scoped observers. */
function useSidebarTargets(visible: boolean): SidebarTargets {
  const [targets, setTargets] = useState<SidebarTargets>({});
  useEffect(() => {
    if (!visible) {
      setTargets({});
      return;
    }
    let frameHandle: number | undefined;
    let columnObserver: MutationObserver | undefined;
    let frameObserver: MutationObserver | undefined;
    let pendingObserver: MutationObserver | undefined;
    let observedColumn: HTMLElement | undefined;
    let observedFrame: HTMLElement | undefined;
    const schedule = () => {
      if (frameHandle !== undefined) return;
      frameHandle = requestAnimationFrame(() => {
        frameHandle = undefined;
        sync();
      });
    };
    const sync = () => {
      const next = resolveTargets();
      const anchor = next.wide ?? next.rail;
      if (anchor === undefined) {
        // The overlay can commit before the lazy native browser: wait for its marker.
        if (pendingObserver === undefined) {
          pendingObserver = new MutationObserver(schedule);
          pendingObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        observedColumn = undefined;
        observedFrame = undefined;
        columnObserver?.disconnect();
        columnObserver = undefined;
        frameObserver?.disconnect();
        frameObserver = undefined;
        setTargets((previous) =>
          previous.wide === undefined && previous.rail === undefined ? previous : {},
        );
        return;
      }
      if (pendingObserver !== undefined) {
        pendingObserver.disconnect();
        pendingObserver = undefined;
      }
      const frame = resolveFrame(anchor);
      const column = frame === undefined ? anchor.parentElement ?? anchor : resolveColumn(anchor, frame);
      if (column !== observedColumn) {
        columnObserver?.disconnect();
        observedColumn = column;
        columnObserver = new MutationObserver(schedule);
        columnObserver.observe(column, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['inert', 'hidden'],
        });
      }
      if (frame !== observedFrame) {
        frameObserver?.disconnect();
        observedFrame = frame;
        if (frame !== undefined) {
          frameObserver = new MutationObserver(schedule);
          frameObserver.observe(frame, {
            childList: true,
            attributes: true,
            attributeFilter: ['data-sidebar-collapsed', 'data-sidebar-drawer', 'inert', 'hidden'],
          });
        }
      }
      // Keep observing the native markers while their column is hidden.
      const available = isEntryAvailable(anchor) ? next : {};
      setTargets((previous) =>
        previous.wide === available.wide && previous.rail === available.rail ? previous : available,
      );
    };
    schedule();
    return () => {
      columnObserver?.disconnect();
      frameObserver?.disconnect();
      pendingObserver?.disconnect();
      if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
    };
  }, [visible]);
  return targets;
}

/** The Worktree mode entry, mounted inside DSH's native Workspace toolbar or rail. */
export function SidebarViewSwitch({ visible, label, guide, onOpen }: SidebarViewSwitchProps) {
  const targets = useSidebarTargets(visible);
  const [guideSeen, setGuideSeen] = useState(() => hasSeenEntryGuide());
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const dismissGuide = useCallback(() => {
    markEntryGuideSeen();
    setGuideSeen(true);
  }, []);
  const open = useCallback(() => {
    // Opening the mode proves the entry was found; never guide this browser again.
    markEntryGuideSeen();
    setGuideSeen(true);
    onOpen();
  }, [onOpen]);
  if (!visible) return null;
  const showGuide = guide !== undefined && !guideSeen;
  return (
    <>
      {targets.wide !== undefined &&
        createPortal(
          <Tooltip label={label} side="bottom" delayMs={500} portal>
            <button
              ref={setAnchor}
              type="button"
              className={styles.headerSwitch}
              data-worktree-mode-action
              data-worktree-view-switch="header"
              aria-label={label}
              onClick={open}
            >
              <IconBranchOutline16 size={16} />
            </button>
          </Tooltip>,
          targets.wide,
        )}
      {targets.rail !== undefined &&
        createPortal(
          <Tooltip label={label} side="right" delayMs={500} portal>
            <button
              ref={setAnchor}
              type="button"
              className={styles.railSwitch}
              data-worktree-mode-action
              data-worktree-view-switch="rail"
              aria-label={label}
              onClick={open}
            >
              <IconBranchOutline16 size={18} />
            </button>
          </Tooltip>,
          targets.rail,
        )}
      {showGuide && anchor !== null && (
        <EntryGuide
          anchor={anchor}
          title={guide.title}
          body={guide.body}
          dismissLabel={guide.dismissLabel}
          onDismiss={dismissGuide}
        />
      )}
    </>
  );
}
