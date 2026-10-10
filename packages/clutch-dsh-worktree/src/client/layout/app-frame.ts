/** Public AppFrame anchors; never infer a column from sibling order or private classes. */
export function directChildWithin(
  parent: Element,
  anchor: Element | null | undefined,
): Element | undefined {
  let child = anchor;
  while (child && child.parentElement !== parent) child = child.parentElement;
  return child ?? undefined;
}

export function resolveAppFrame(
  surface: Element,
): { overlay: HTMLElement; frame: HTMLElement; sidebar: HTMLElement } | undefined {
  const overlay = surface.closest('[data-shell-overlay]');
  const frame = overlay?.parentElement;
  if (!(overlay instanceof HTMLElement) || !frame || !overlay.isConnected) return undefined;
  // The plugin footer survives the collapsed rail; the public pane is an alternate anchor.
  for (const selector of ['[data-worktree-mode-action]', '[data-pane="sidebar"]']) {
    const columns = new Set(
      Array.from(frame.querySelectorAll(selector))
        .map((anchor) => directChildWithin(frame, anchor))
        .filter(
          (column): column is HTMLElement =>
            column instanceof HTMLElement &&
            column !== overlay &&
            !column.hasAttribute('data-shell-overlay') &&
            !column.hasAttribute('data-rightbar-col') &&
            !column.hasAttribute('data-shell-leading'),
        ),
    );
    if (columns.size > 1) return undefined;
    const sidebar = columns.values().next().value;
    if (sidebar) return { overlay, frame, sidebar };
  }
  return undefined;
}

function finiteRect(rect: DOMRect): boolean {
  return [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(
    Number.isFinite,
  );
}

export function resolveFrameContent(
  frame: HTMLElement,
  overlay: HTMLElement,
  sidebar: HTMLElement,
): { center: HTMLElement; rightbar: HTMLElement | undefined } | undefined {
  const rightbars = Array.from(frame.querySelectorAll<HTMLElement>('[data-rightbar-col]')).filter(
    (column) => directChildWithin(frame, column) !== overlay,
  );
  if (rightbars.length > 1) return undefined;
  const column = rightbars[0];
  const rightbar = frame.hasAttribute('data-rightbar-collapsed') ? undefined : column;
  const box = overlay.getBoundingClientRect();
  const boundary = sidebar.getBoundingClientRect();
  const columnRect = column?.getBoundingClientRect();
  if (
    !finiteRect(box) ||
    !finiteRect(boundary) ||
    (rightbar && columnRect && !finiteRect(columnRect))
  ) {
    return undefined;
  }
  const right = rightbar && columnRect ? columnRect.left : box.right;
  // Collapse state changes before the grid animation settles. The center can still
  // end at the shrinking column; keep recognizing it without reserving that rightbar.
  const centerEdges = [right];
  if (!rightbar && columnRect && finiteRect(columnRect)) centerEdges.push(columnRect.left);
  const excluded = column ? directChildWithin(frame, column) : undefined;
  // CenterColumn has no public marker. Resolve the remaining full content track by
  // geometry, excluding known slots, caption bands, resize handles and zero-size wrappers.
  const centers = Array.from(frame.children).filter((child): child is HTMLElement => {
    if (
      !(child instanceof HTMLElement) ||
      child === sidebar ||
      child === overlay ||
      child === excluded ||
      child.hasAttribute('data-shell-overlay') ||
      child.hasAttribute('data-shell-leading') ||
      child.hasAttribute('data-window-drag')
    )
      return false;
    const rect = child.getBoundingClientRect();
    return (
      finiteRect(rect) &&
      rect.width > 0 &&
      rect.height > 0 &&
      Math.abs(rect.left - boundary.right) <= 1 &&
      centerEdges.some((edge) => Math.abs(rect.right - edge) <= 1) &&
      rect.top >= box.top - 1 &&
      rect.top < box.bottom &&
      Math.abs(rect.bottom - box.bottom) <= 1
    );
  });
  if (centers.length !== 1) return undefined;
  return {
    center: centers[0]!,
    rightbar,
  };
}
