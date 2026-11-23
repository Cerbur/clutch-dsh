import type { CSSProperties } from 'react';

/** Resolve the owning DSH AppFrame containing the trigger, if present. */
function findAppFrame(element: HTMLElement): HTMLElement | null {
  for (let frame = element.parentElement; frame; frame = frame.parentElement) {
    if (frame.querySelector(':scope > [data-shell-overlay]')) return frame;
  }
  return null;
}

function frameIsFullscreen(frame: HTMLElement): boolean {
  const flag = frame.getAttribute('data-rightbar-fullscreen');
  if (flag !== null && flag !== 'false') return true;
  // DSH reports fullscreen on AppFrame after the slide. The visible Session's
  // panel already has its open/mode attributes when the slide starts.
  const panels = frame.querySelectorAll(
    ':scope > [data-rightbar-col] [data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]',
  );
  return Array.from(panels).some((panel) => !panel.closest('[hidden]'));
}

/** Input can arrive before a pending MutationObserver update commits to React. */
export function isRightbarFullscreen(trigger: HTMLElement): boolean {
  const frame = findAppFrame(trigger);
  return frame !== null && frameIsFullscreen(frame);
}

/** Observe DSH AppFrame's rightbar fullscreen state when the trigger lives inside it. */
export function observeRightbarFullscreen(
  trigger: HTMLElement,
  publish: (fullscreen: boolean) => void,
): () => void {
  const frame = findAppFrame(trigger);
  const view = trigger.ownerDocument.defaultView;
  if (!frame) {
    publish(false);
    return () => {};
  }
  const update = () => publish(frameIsFullscreen(frame));
  update();
  if (!view?.MutationObserver) return () => {};
  const observer = new view.MutationObserver((records) => {
    // Changes to terminal output or file content inside a mounted panel cannot
    // change its presentation. Recheck when the panel or its host changes.
    if (records.some(({ target }) => !target.parentElement?.closest('[data-sidebar-right-panel]'))) update();
  });
  observer.observe(frame, { attributes: true, attributeFilter: ['data-rightbar-fullscreen'] });
  const rightbar = frame.querySelector(':scope > [data-rightbar-col]');
  if (rightbar) observer.observe(rightbar, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-sidebar-right-open', 'data-sidebar-right-panel', 'hidden'],
  });
  return () => observer.disconnect();
}

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
