export interface DashboardPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

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

/** Layout seam shared with the existing Sidebar overlay; fail closed on anchor loss. */
export function mountDashboardOverlay(
  surface: HTMLElement,
  onPlacement: (placement: DashboardPlacement | undefined) => void,
): () => void {
  const overlay = surface.closest<HTMLElement>('[data-shell-overlay]');
  const frame = overlay?.parentElement;
  if (!overlay || !frame) {
    onPlacement(undefined);
    return () => {};
  }
  const hidden = new Map<HTMLElement, () => void>();
  let observed: Element[] = [];
  let scheduled: number | undefined;
  let disposed = false;
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
    // AppFrame owns Sidebar | CenterColumn | RightbarColumn | shell.overlay.
    // Do not depend on generated CSS class names or mutate slot registrations.
    const sidebar = frame.firstElementChild;
    const center = sidebar?.nextElementSibling;
    const right = center?.nextElementSibling;
    const valid =
      overlay.isConnected &&
      overlay.parentElement === frame &&
      sidebar instanceof HTMLElement &&
      center instanceof HTMLElement &&
      right instanceof HTMLElement &&
      right.nextElementSibling === overlay;
    const nextObserved: Element[] = valid ? [overlay, sidebar, center, right] : [frame];
    for (const old of observed) if (!nextObserved.includes(old)) resize?.unobserve(old);
    for (const next of nextObserved) if (!observed.includes(next)) resize?.observe(next);
    observed = nextObserved;
    if (!valid) {
      restore();
      onPlacement(undefined);
      return;
    }
    const box = overlay.getBoundingClientRect();
    const boundary = sidebar.getBoundingClientRect();
    const left = Math.max(0, boundary.right - box.left);
    const width = box.width - left;
    if (width <= 0 || box.height <= 0) {
      restore();
      onPlacement(undefined);
      return;
    }
    for (const [element, cleanup] of hidden) {
      if (element !== center && element !== right) {
        cleanup();
        hidden.delete(element);
      }
    }
    for (const element of [center, right]) {
      if (!hidden.has(element)) hidden.set(element, concealDashboardBackground(element));
    }
    onPlacement({ left, top: 0, width, height: box.height });
  };
  const mutation =
    typeof MutationObserver === 'undefined' ? undefined : new MutationObserver(schedule);
  mutation?.observe(frame, { childList: true });
  // Frame replacement may detach all original anchors at once.
  if (frame.parentElement) mutation?.observe(frame.parentElement, { childList: true });
  update();
  return () => {
    disposed = true;
    resize?.disconnect();
    mutation?.disconnect();
    if (scheduled !== undefined) cancelAnimationFrame(scheduled);
    restore();
  };
}

