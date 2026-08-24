import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { computeOverlayBounds } from './overlay-bounds.js';
import type { OverlayBounds, RectLike } from './overlay-bounds.js';

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
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button'));
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

export function useSidebarOverlayGeometry(active: boolean): {
  ref: RefObject<HTMLDivElement>;
  width: number;
  bounds: OverlayBounds;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  const [bounds, setBounds] = useState<OverlayBounds>(EMPTY_BOUNDS);

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
    function update(): void {
      const newSession = findNewSessionAnchor(nativeRootElement);
      const footer = nativeRootElement.lastElementChild;
      observedNewSession = syncObservedElement(resizeObserver, observedNewSession, newSession);
      observedFooter = syncObservedElement(resizeObserver, observedFooter, footer);
      const nextWidth = sidebarElement.getBoundingClientRect().width;
      if (nextWidth > 0) setWidth(nextWidth);
      setBounds(
        computeOverlayBounds(
          asRect(overlayElement),
          newSession === undefined ? undefined : asRect(newSession),
          footer === null ? undefined : asRect(footer),
        ),
      );
    }
    function scheduleUpdate(): void {
      if (frameHandle !== undefined) return;
      frameHandle = requestAnimationFrame(() => {
        frameHandle = undefined;
        update();
      });
    }

    const resizeObserver: ResizeObserver | undefined = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleUpdate)
      : undefined;

    for (const element of [overlayElement, sidebarElement, nativeRootElement]) {
      resizeObserver?.observe(element);
    }
    update();

    const mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(scheduleUpdate)
      : undefined;
    mutationObserver?.observe(nativeRootElement, { childList: true, subtree: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
    };
  }, [active]);

  return { ref, width, bounds };
}
