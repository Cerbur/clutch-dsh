import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { computeOverlayBounds } from './overlay-bounds.js';
import type { OverlayBounds, RectLike } from './overlay-bounds.js';
import { concealDashboardBackground as concealNativeContent } from '../dashboard/dashboard-overlay.js';

const EMPTY_BOUNDS: OverlayBounds = { ready: false, top: 0, height: 0 };

function asRect(element: Element): RectLike {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}

export function syncObservedElement(
  observer: Pick<ResizeObserver, 'observe' | 'unobserve'> | undefined,
  previous: Element | undefined,
  next: Element | null | undefined,
): Element | undefined {
  const nextElement = next ?? undefined;
  if (previous === nextElement) return previous;
  if (previous !== undefined) observer?.unobserve(previous);
  if (nextElement !== undefined) observer?.observe(nextElement);
  return nextElement;
}

export function resolveNativeSidebarRoot(sidebar: Element): Element | undefined {
  const directChild = sidebar.firstElementChild;
  if (directChild === null) return undefined;

  const directRect = directChild.getBoundingClientRect();
  if (directRect.width > 0 || directRect.height > 0) return directChild;
  return directChild.firstElementChild ?? directChild;
}

export function findNewSessionAnchor(root: Element): HTMLElement | undefined {
  const labels = ['新建会话', 'New session', '新会话', 'New Session'];
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter((button) => {
    // On Web the brand also starts a Session and shares the action's aria-label.
    // Its marked chrome row contains the Sidebar toggle and must remain uncovered.
    // The dedicated action's text may include shortcut glyphs, so text alone
    // cannot distinguish it from that brand shortcut.
    let parent = button.parentElement;
    while (parent && parent !== root) {
      if (parent.hasAttribute('data-window-drag')) return false;
      parent = parent.parentElement;
    }
    return true;
  });
  const visibleLabel = buttons.find((button) => {
    const text = button.textContent?.trim();
    return text === '新会话' || text === 'New Session';
  });
  if (visibleLabel !== undefined) return visibleLabel;
  for (const label of labels) {
    const button = buttons.find((candidate) => candidate.getAttribute('aria-label') === label);
    if (button !== undefined) return button;
  }
  return undefined;
}

/** Hide only the native content covered by the plugin, keeping chrome and footer alive. */
export function coveredSidebarChildren(
  root: Element,
  newSession: Element | undefined,
  footer: Element | null,
): HTMLElement[] {
  if (!newSession || !footer) return [];
  let first = newSession;
  while (first.parentElement && first.parentElement !== root) first = first.parentElement;
  const children = Array.from(root.children ?? []);
  const start = children.indexOf(first);
  const end = children.indexOf(footer);
  if (start < 0 || end <= start) return [];
  return children
    .slice(start, end)
    .filter((element): element is HTMLElement => element instanceof HTMLElement);
}

function concealSidebarContent(element: HTMLElement): () => void {
  const restore = concealNativeContent(element);
  const opacity = element.style.getPropertyValue('opacity');
  const priority = element.style.getPropertyPriority('opacity');
  // Native disclosure/header descendants can explicitly set visibility: visible.
  // Opacity suppresses the entire composited subtree, including those descendants.
  element.style.setProperty('opacity', '0');
  return () => {
    restore();
    if (element.style.getPropertyValue('opacity') !== '0') return;
    if (opacity) element.style.setProperty('opacity', opacity, priority);
    else element.style.removeProperty('opacity');
  };
}

export function useSidebarOverlayGeometry(active: boolean): {
  ref: RefObject<HTMLDivElement>;
  width: number;
  bounds: OverlayBounds;
  collapsed: boolean;
  nativeCovered: boolean;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  const [bounds, setBounds] = useState<OverlayBounds>(EMPTY_BOUNDS);
  const [collapsed, setCollapsed] = useState(false);
  const [nativeCovered, setNativeCovered] = useState(false);

  useLayoutEffect(() => {
    if (!active) {
      setBounds(EMPTY_BOUNDS);
      return;
    }

    const surface = ref.current;
    const overlay = surface?.closest('[data-shell-overlay]');
    const frame = overlay?.parentElement;
    const sidebar = frame?.firstElementChild;
    const nativeRoot =
      sidebar === null || sidebar === undefined ? undefined : resolveNativeSidebarRoot(sidebar);
    if (
      !(overlay instanceof HTMLElement) ||
      !(sidebar instanceof HTMLElement) ||
      !(nativeRoot instanceof HTMLElement)
    ) {
      setBounds(EMPTY_BOUNDS);
      return;
    }
    const overlayElement = overlay;
    const sidebarElement = sidebar;
    const nativeRootElement = nativeRoot;

    let frameHandle: number | undefined;
    let observedNewSession: Element | undefined;
    let observedFooter: Element | undefined;
    let observedRoot: Element | undefined;
    const hidden = new Map<HTMLElement, () => void>();
    function restore(): void {
      for (const cleanup of hidden.values()) cleanup();
      hidden.clear();
    }
    function update(): void {
      const currentRoot = resolveNativeSidebarRoot(sidebarElement);
      if (
        !(currentRoot instanceof HTMLElement) ||
        overlayElement.isConnected === false ||
        frame?.firstElementChild !== sidebarElement
      ) {
        restore();
        setNativeCovered(false);
        setBounds(EMPTY_BOUNDS);
        return;
      }
      observedRoot = syncObservedElement(resizeObserver, observedRoot, currentRoot);
      const newSession = findNewSessionAnchor(currentRoot);
      const footer = currentRoot.lastElementChild;
      observedNewSession = syncObservedElement(resizeObserver, observedNewSession, newSession);
      observedFooter = syncObservedElement(resizeObserver, observedFooter, footer);
      const nextWidth = sidebarElement.getBoundingClientRect().width;
      // macOS has no collapsed rail; zero is a real width, never a missing measurement.
      setWidth(Math.max(0, nextWidth));
      const nextCollapsed =
        frame?.hasAttribute('data-sidebar-collapsed') === true || nextWidth <= 64;
      setCollapsed(nextCollapsed);
      const nextBounds = computeOverlayBounds(
        asRect(overlayElement),
        newSession === undefined ? undefined : asRect(newSession),
        footer === null ? undefined : asRect(footer),
      );
      setBounds(nextCollapsed ? EMPTY_BOUNDS : nextBounds);
      const covered =
        !nextCollapsed && nextBounds.ready && nextBounds.height > 0
          ? coveredSidebarChildren(currentRoot, newSession, footer)
          : [];
      for (const [element, cleanup] of hidden) {
        if (!covered.includes(element)) {
          cleanup();
          hidden.delete(element);
        }
      }
      for (const element of covered) {
        if (!hidden.has(element)) hidden.set(element, concealSidebarContent(element));
      }
      setNativeCovered(covered.length > 0);
    }
    function scheduleUpdate(): void {
      if (frameHandle !== undefined) return;
      frameHandle = requestAnimationFrame(() => {
        frameHandle = undefined;
        update();
      });
    }

    const resizeObserver: ResizeObserver | undefined =
      typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleUpdate) : undefined;

    for (const element of [overlayElement, sidebarElement, nativeRootElement]) {
      resizeObserver?.observe(element);
    }
    update();

    const mutationObserver =
      typeof MutationObserver === 'function' ? new MutationObserver(scheduleUpdate) : undefined;
    // Observe semantic state as well as width: the native column animates to zero,
    // and its root may be replaced during the wide-to-rail crossfade.
    mutationObserver?.observe(frame!, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-sidebar-collapsed'],
    });
    if (frame?.parentElement) mutationObserver?.observe(frame.parentElement, { childList: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
      restore();
    };
  }, [active]);

  return { ref, width, bounds, collapsed, nativeCovered };
}
