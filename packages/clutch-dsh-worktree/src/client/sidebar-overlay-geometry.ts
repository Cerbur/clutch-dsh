import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { computeOverlayBounds } from './overlay-bounds.js';
import type { OverlayBounds, RectLike } from './overlay-bounds.js';

const EMPTY_BOUNDS: OverlayBounds = { ready: false, top: 0, height: 0 };

function asRect(element: Element): RectLike {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
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
  const buttons = [...root.querySelectorAll<HTMLElement>('button')];
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

    let frameHandle: number | undefined;
    const update = (): void => {
      const newSession = findNewSessionAnchor(nativeRoot);
      const footer = nativeRoot.lastElementChild;
      const nextWidth = sidebar.getBoundingClientRect().width;
      if (nextWidth > 0) setWidth(nextWidth);
      setBounds(
        computeOverlayBounds(
          asRect(overlay),
          newSession === undefined ? undefined : asRect(newSession),
          footer === null ? undefined : asRect(footer),
        ),
      );
    };
    const scheduleUpdate = (): void => {
      if (frameHandle !== undefined) return;
      frameHandle = requestAnimationFrame(() => {
        frameHandle = undefined;
        update();
      });
    };

    update();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleUpdate)
      : undefined;
    for (const element of [overlay, sidebar, nativeRoot]) {
      resizeObserver?.observe(element);
    }
    const newSession = findNewSessionAnchor(nativeRoot);
    const footer = nativeRoot.lastElementChild;
    if (newSession !== undefined) resizeObserver?.observe(newSession);
    if (footer !== null) resizeObserver?.observe(footer);

    const mutationObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(scheduleUpdate)
      : undefined;
    mutationObserver?.observe(nativeRoot, { childList: true, subtree: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
    };
  }, [active]);

  return { ref, width, bounds };
}
