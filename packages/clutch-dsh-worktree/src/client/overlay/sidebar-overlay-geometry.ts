import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { computeOverlayBounds } from './overlay-bounds.js';
import type { OverlayBounds, RectLike } from './overlay-bounds.js';
import { concealDashboardBackground as concealNativeContent } from '../dashboard/dashboard-overlay.js';
import { directChildWithin, resolveAppFrame } from '../layout/app-frame.js';

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
  const newSession = findNewSessionAnchor(sidebar);
  const action = sidebar.querySelector('[data-worktree-mode-action]');
  if (!newSession || !action) return undefined;
  let candidate: Element | undefined;
  // The lowest measurable common ancestor separates the functional content and
  // footer slots, skipping display:contents wrappers without guessing child order.
  for (let root = newSession.parentElement; root; root = root.parentElement) {
    const content = directChildWithin(root, newSession);
    const footer = directChildWithin(root, action);
    const rect = root.getBoundingClientRect();
    if (content && footer && content !== footer) {
      candidate ??= root;
      if (rect.width > 0 && rect.height > 0) return root;
    }
    if (root === sidebar) break;
  }
  // Keep an unmeasurable common root observable so a resize can recover it.
  return candidate;
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
    if (!text) return false;
    return text.startsWith('新会话') || text.startsWith('New Session');
  });
  if (visibleLabel !== undefined) return visibleLabel;
  for (const label of labels) {
    const button = buttons.find((candidate) => candidate.getAttribute('aria-label') === label);
    if (button !== undefined) return button;
  }
  return undefined;
}

function sidebarFooterCandidate(root: Element): Element | undefined {
  // WorktreeModeAction owns this marker in sidebar.footer.action; no native classes or labels.
  const action = root.querySelector('[data-worktree-mode-action]');
  return directChildWithin(root, action);
}

/** Resolve the footer slot semantically, then validate its content boundary. */
export function resolveSidebarFooter(
  root: Element,
  newSession: Element | undefined,
): Element | undefined {
  if (!newSession) return undefined;
  const children = Array.from(root.children);
  const content = directChildWithin(root, newSession);
  const start = content === undefined ? -1 : children.indexOf(content);
  if (start < 0) return undefined;
  const anchorRect = asRect(newSession);
  const rootRect = asRect(root);
  const candidate = sidebarFooterCandidate(root);
  if (!candidate || children.indexOf(candidate) <= start) return undefined;
  const rect = asRect(candidate);
  const valid =
    [anchorRect.top, anchorRect.bottom, rootRect.top, rootRect.bottom, rect.top, rect.bottom].every(
      Number.isFinite,
    ) &&
    anchorRect.bottom > anchorRect.top &&
    rect.bottom > rect.top &&
    rect.top >= anchorRect.bottom &&
    rect.top >= rootRect.top &&
    rect.bottom <= rootRect.bottom;
  return valid ? candidate : undefined;
}

/** Hide only the native content covered by the plugin, keeping chrome and footer alive. */
export function coveredSidebarChildren(
  root: Element,
  newSession: Element | undefined,
  footer: Element | null | undefined,
): HTMLElement[] {
  if (!newSession || !footer) return [];
  const first = directChildWithin(root, newSession);
  const children = Array.from(root.children ?? []);
  const start = first === undefined ? -1 : children.indexOf(first);
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
      setNativeCovered(false);
      return;
    }

    const surface = ref.current;
    const overlay = surface?.closest('[data-shell-overlay]');
    const frame = overlay?.parentElement;
    if (!(overlay instanceof HTMLElement) || !frame || !surface) {
      setBounds(EMPTY_BOUNDS);
      return;
    }
    const overlayElement = overlay;

    let frameHandle: number | undefined;
    let disposed = false;
    let observedNewSession: Element | undefined;
    let observedFooter: Element | undefined;
    let observedRoot: Element | undefined;
    let observedSidebar: Element | undefined;
    const hidden = new Map<HTMLElement, () => void>();
    function restore(): void {
      for (const cleanup of hidden.values()) cleanup();
      hidden.clear();
    }
    function update(): void {
      if (disposed) return;
      const anchors = resolveAppFrame(surface!);
      const sidebarElement = anchors?.sidebar;
      const currentRoot = sidebarElement && resolveNativeSidebarRoot(sidebarElement);
      observedSidebar = syncObservedElement(resizeObserver, observedSidebar, sidebarElement);
      observedRoot = syncObservedElement(resizeObserver, observedRoot, currentRoot);
      const nextWidth = sidebarElement?.getBoundingClientRect().width;
      const nextCollapsed =
        frame?.hasAttribute('data-sidebar-collapsed') === true ||
        (nextWidth !== undefined && nextWidth <= 64);
      setCollapsed(nextCollapsed);
      // macOS has no collapsed rail; zero is a real width, never a missing measurement.
      if (nextWidth !== undefined && Number.isFinite(nextWidth)) setWidth(Math.max(0, nextWidth));
      if (
        anchors?.frame !== frame ||
        anchors?.overlay !== overlayElement ||
        !(currentRoot instanceof HTMLElement) ||
        !sidebarElement ||
        nextWidth === undefined ||
        !Number.isFinite(nextWidth)
      ) {
        observedNewSession = syncObservedElement(resizeObserver, observedNewSession, undefined);
        observedFooter = syncObservedElement(resizeObserver, observedFooter, undefined);
        restore();
        setNativeCovered(false);
        setBounds(EMPTY_BOUNDS);
        return;
      }
      const newSession = findNewSessionAnchor(currentRoot);
      const footer = resolveSidebarFooter(currentRoot, newSession);
      observedNewSession = syncObservedElement(resizeObserver, observedNewSession, newSession);
      // Keep watching a temporarily invalid/zero-height candidate so resize can recover it.
      observedFooter = syncObservedElement(
        resizeObserver,
        observedFooter,
        sidebarFooterCandidate(currentRoot),
      );
      const nextBounds = computeOverlayBounds(
        asRect(overlayElement),
        newSession === undefined ? undefined : asRect(newSession),
        footer === undefined ? undefined : asRect(footer),
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
      if (disposed || frameHandle !== undefined) return;
      frameHandle = requestAnimationFrame(() => {
        frameHandle = undefined;
        update();
      });
    }

    const resizeObserver: ResizeObserver | undefined =
      typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleUpdate) : undefined;

    for (const element of [overlayElement, frame]) {
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
      attributeFilter: [
        'data-sidebar-collapsed',
        'data-worktree-mode-action',
        'data-pane',
        'data-shell-overlay',
        'data-window-drag',
      ],
    });
    if (frame?.parentElement) mutationObserver?.observe(frame.parentElement, { childList: true });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
      restore();
    };
  }, [active]);

  return { ref, width, bounds, collapsed, nativeCovered };
}
