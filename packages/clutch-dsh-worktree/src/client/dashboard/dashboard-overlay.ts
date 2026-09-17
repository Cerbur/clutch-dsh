export interface DashboardPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

// Upstream AppFrame's 8px Sidebar handle is centered on the track boundary.
// Keep its 4px right half outside this higher stacking-context overlay.
const SIDEBAR_RESIZE_HANDLE_HALF_WIDTH = 4;

/** Reversible presentation only: leave the native React tree and Session alive. */
export function concealDashboardBackground(element: HTMLElement): () => void {
  const visibility = element.style.getPropertyValue('visibility');
  const priority = element.style.getPropertyPriority('visibility');
  const inert = element.getAttribute('inert');
  const hidden = element.getAttribute('aria-hidden');
  element.style.setProperty('visibility', 'hidden');
  element.setAttribute('inert', '');
  element.setAttribute('aria-hidden', 'true');
  return () => {
    if (element.style.getPropertyValue('visibility') === 'hidden') {
      if (visibility) element.style.setProperty('visibility', visibility, priority);
      else element.style.removeProperty('visibility');
    }
    for (const [name, value] of [
      ['inert', inert],
      ['aria-hidden', hidden],
    ] as const) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
}

export interface MountDashboardOverlayOptions {
  readonly onRightSidebarChange?: (open: boolean) => void;
  readonly isRightSidebarExpanded?: () => boolean;
}

export function isRightSidebarOpenFromDom(
  frame: HTMLElement,
  rightbar: HTMLElement | undefined,
): boolean {
  if (typeof frame.querySelector === 'function') {
    if (frame.querySelector('[data-sidebar-right-open]') !== null) {
      return true;
    }
    if (frame.hasAttribute('data-rightbar-collapsed')) {
      return false;
    }
  }
  if (frame.getAttribute?.('data-rightbar-collapsed') !== null) {
    return false;
  }
  if (rightbar instanceof HTMLElement) {
    if (rightbar.getAttribute?.('data-sidebar-right-open') !== null) {
      return true;
    }
  }
  return false;
}

/** Layout seam shared with the existing Sidebar overlay; fail closed on frame/center loss. */
export function mountDashboardOverlay(
  surface: HTMLElement,
  onPlacement: (placement: DashboardPlacement | undefined) => void,
  options?: MountDashboardOverlayOptions,
): () => void {
  const overlay = surface.closest<HTMLElement>('[data-shell-overlay]');
  const frame = overlay?.parentElement;
  if (!overlay || !frame) {
    onPlacement(undefined);
    options?.onRightSidebarChange?.(false);
    return () => {};
  }
  const hidden = new Map<HTMLElement, () => void>();
  let observed: Element[] = [];
  let scheduled: number | undefined;
  let disposed = false;
  let lastRightSidebarOpen: boolean | undefined;
  const restore = () => {
    for (const cleanup of hidden.values()) cleanup();
    hidden.clear();
  };
  const schedule = () => {
    if (disposed || scheduled !== undefined) return;
    scheduled = requestAnimationFrame(() => {
      scheduled = undefined;
      update();
    });
  };
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  const update = () => {
    if (disposed) return;
    // AppFrame owns Sidebar | CenterColumn | [RightbarColumn] | shell.overlay.
    // The native rightbar is absent on a page with no current Session, but the
    // Dashboard still needs the same center-to-frame placement in that layout.
    // Do not depend on generated CSS class names or mutate slot registrations.
    const sidebar = frame.firstElementChild;
    const center = sidebar?.nextElementSibling;
    const rightbar = center?.nextElementSibling;
    const hasRightbar =
      rightbar instanceof HTMLElement &&
      rightbar !== overlay &&
      rightbar.nextElementSibling === overlay;
    const hasNoRightbar = rightbar === overlay;
    const valid =
      overlay.isConnected &&
      overlay.parentElement === frame &&
      sidebar instanceof HTMLElement &&
      center instanceof HTMLElement &&
      (hasRightbar || hasNoRightbar);
    const nextObserved: Element[] = valid
      ? hasRightbar
        ? [overlay, sidebar, center, rightbar]
        : [overlay, sidebar, center]
      : [frame];
    for (const old of observed) if (!nextObserved.includes(old)) resize?.unobserve(old);
    for (const next of nextObserved) if (!observed.includes(next)) resize?.observe(next);
    observed = nextObserved;
    if (!valid) {
      restore();
      onPlacement(undefined);
      if (lastRightSidebarOpen) {
        lastRightSidebarOpen = false;
        options?.onRightSidebarChange?.(false);
      }
      return;
    }
    const box = overlay.getBoundingClientRect();
    const boundary = sidebar.getBoundingClientRect();
    const rightBoundary =
      hasRightbar && rightbar instanceof HTMLElement ? rightbar.getBoundingClientRect().left : box.right;
    const left = Math.max(0, boundary.right - box.left + SIDEBAR_RESIZE_HANDLE_HALF_WIDTH);
    const rightEdge = Math.min(box.right, rightBoundary);
    const width = rightEdge - box.left - left;
    if (width <= 0 || box.height <= 0) {
      restore();
      onPlacement(undefined);
      return;
    }
    for (const [element, cleanup] of hidden) {
      if (element !== center) {
        cleanup();
        hidden.delete(element);
      }
    }
    if (!hidden.has(center)) hidden.set(center, concealDashboardBackground(center));
    onPlacement({ left, top: 0, width, height: box.height });
    const isRightSidebarOpen =
      options?.isRightSidebarExpanded !== undefined
        ? options.isRightSidebarExpanded()
        : isRightSidebarOpenFromDom(frame, hasRightbar ? rightbar : undefined);
    if (lastRightSidebarOpen !== isRightSidebarOpen) {
      lastRightSidebarOpen = isRightSidebarOpen;
      options?.onRightSidebarChange?.(isRightSidebarOpen);
    }
  };
  const mutation =
    typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(schedule);
  try {
    mutation?.observe(frame, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: [
        'data-rightbar-collapsed',
        'data-sidebar-right-open',
        'data-sidebar-right-panel',
      ],
    });
  } catch {
    mutation?.observe(frame, { childList: true });
  }
  // Frame replacement may detach all original anchors at once.
  if (frame.parentElement) {
    try {
      mutation?.observe(frame.parentElement, { childList: true });
    } catch {
      // ignore
    }
  }
  update();
  return () => {
    disposed = true;
    resize?.disconnect();
    mutation?.disconnect();
    if (scheduled !== undefined) cancelAnimationFrame(scheduled);
    restore();
    if (lastRightSidebarOpen) {
      lastRightSidebarOpen = false;
      options?.onRightSidebarChange?.(false);
    }
  };
}

