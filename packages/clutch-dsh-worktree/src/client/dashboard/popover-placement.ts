import type { CSSProperties } from 'react';

/** The native conversation header spans the Session column, including its view tabs. */
export function observePopoverPlacement(
  trigger: HTMLElement,
  publish: (style: CSSProperties | undefined) => void,
): () => void {
  const header = trigger.closest('header');
  const window = trigger.ownerDocument.defaultView;
  if (!header?.querySelector('[data-conversation-header-leading]') || !window) {
    publish(undefined);
    return () => {};
  }
  const update = () => {
    const box = header.getBoundingClientRect();
    const left = Math.max(0, box.left) + 12;
    const right = Math.min(window.innerWidth, box.right) - 12;
    const top = Math.max(0, box.bottom) + 12;
    const width = Math.min(256, right - left);
    const maxHeight = window.innerHeight - top - 12;
    if (!header.isConnected || ![left, right, top, width, maxHeight].every(Number.isFinite) ||
      box.height <= 0 || width <= 0 || maxHeight <= 0) {
      publish(undefined);
      return;
    }
    publish({ top, left: right - width, width, maxHeight });
  };
  const observer = new window.ResizeObserver(update);
  observer.observe(header);
  window.addEventListener('resize', update);
  window.addEventListener('scroll', update, true);
  update();
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', update);
    window.removeEventListener('scroll', update, true);
  };
}
