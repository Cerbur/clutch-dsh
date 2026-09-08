const PLUGIN_ID = '@cerbur/clutch-dsh-worktree';
const STYLE_ID = `${PLUGIN_ID}/permission-icon`;
const WORKTREE_PERMISSION_LABEL = 'Worktree Full Access';

/** DOM marker owned only by this plugin's permission icon decorator. */
export const WORKTREE_PERMISSION_ICON_ATTRIBUTE =
  'data-clutch-dsh-worktree-permission-icon';

// The native DSH menu has no icon extension point for host-configured values.
// A branch glyph keeps the custom option visually distinct while preserving
// the same 16px geometry as the built-in permission glyphs.
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M13.0762 1.37207C14.0846 1.37228 14.9021 2.19077 14.9023 3.19922C14.9022 4.20772 14.0847 5.02518 13.0762 5.02539C12.2967 5.02539 11.6325 4.53691 11.3701 3.84961H4.35547C4.79397 4.26458 5.15861 4.7644 5.41699 5.33496L7.10645 9.06738C7.88526 10.7875 9.55104 11.9228 11.4189 12.0371C11.7085 11.4109 12.3411 10.9756 13.0762 10.9756C14.0843 10.9759 14.9023 11.7936 14.9023 12.8018C14.9023 13.81 14.0843 14.6277 13.0762 14.6279C12.2534 14.6279 11.5574 14.0832 11.3291 13.335C8.9868 13.1879 6.89981 11.7612 5.92285 9.60352L4.23242 5.87109C3.67503 4.64033 2.44878 3.84961 1.09766 3.84961V2.54883C1.10665 2.54883 1.11601 2.54975 1.125 2.5498L11.3701 2.54883C11.6326 1.86151 12.2969 1.37207 13.0762 1.37207ZM13.0762 12.2764C12.7858 12.2764 12.5508 12.5114 12.5508 12.8018C12.5508 13.0921 12.7858 13.3281 13.0762 13.3281C13.3664 13.3279 13.6025 13.092 13.6025 12.8018C13.6025 12.5115 13.3664 12.2766 13.0762 12.2764ZM13.0762 2.67285C12.7855 2.67285 12.55 2.90861 12.5498 3.19922C12.5499 3.48987 12.7855 3.72559 13.0762 3.72559C13.3667 3.72538 13.6024 3.48975 13.6025 3.19922C13.6023 2.90874 13.3666 2.67306 13.0762 2.67285Z" fill="black"/></svg>';

function iconStyles(): string {
  const mask = `url("data:image/svg+xml,${encodeURIComponent(ICON_SVG)}")`;
  return `
[${WORKTREE_PERMISSION_ICON_ATTRIBUTE}]::before {
  content: "";
  display: inline-block;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  background-color: var(--dsw-alias-label-tertiary, currentColor);
  -webkit-mask-image: ${mask};
  mask-image: ${mask};
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-size: contain;
  mask-size: contain;
}
[${WORKTREE_PERMISSION_ICON_ATTRIBUTE}="trigger"]::before {
  width: 14px;
  height: 14px;
}
@container (max-width: 460px) {
  [${WORKTREE_PERMISSION_ICON_ATTRIBUTE}="trigger"] > span:first-of-type {
    display: none;
  }
}
`;
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isWorktreeMenuItem(element: Element): boolean {
  return element.matches('button[role="menuitem"]') &&
    normalizedText(element) === WORKTREE_PERMISSION_LABEL &&
    element.closest('[role="menu"]') !== null;
}

function isWorktreeTrigger(element: Element): boolean {
  if (!element.matches('button[aria-label]')) return false;
  const label = element.getAttribute('aria-label') ?? '';
  return /^(?:access mode,\s*current:\s*|访问模式，当前：\s*)worktree full access$/iu.test(label.trim());
}

/** Mark the native custom permission row and trigger for CSS decoration. */
export function decorateWorktreePermissionIcons(document: Document): void {
  for (const marked of document.querySelectorAll(`[${WORKTREE_PERMISSION_ICON_ATTRIBUTE}]`)) {
    const kind = marked.getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE);
    if ((kind === 'menu' && !isWorktreeMenuItem(marked)) ||
      (kind === 'trigger' && !isWorktreeTrigger(marked))) {
      marked.removeAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE);
    }
  }

  for (const item of document.querySelectorAll('button[role="menuitem"]')) {
    if (isWorktreeMenuItem(item)) {
      item.setAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE, 'menu');
    }
  }

  for (const button of document.querySelectorAll('button[aria-label]')) {
    if (isWorktreeTrigger(button)) {
      button.setAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE, 'trigger');
    }
  }
}

/** Install the Worktree permission icon and return a plugin-local disposer. */
export function installWorktreePermissionIcon(document: Document): () => void {
  for (const existing of document.querySelectorAll('style[data-plugin-css]')) {
    if (existing.getAttribute('data-plugin-css') === STYLE_ID) existing.remove();
  }

  const style = document.createElement('style');
  style.setAttribute('data-plugin', PLUGIN_ID);
  style.setAttribute('data-plugin-css', STYLE_ID);
  style.textContent = iconStyles();
  document.head.appendChild(style);

  let active = true;
  let queued = false;
  const scan = (): void => {
    if (!active || queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (active) decorateWorktreePermissionIcons(document);
    });
  };

  decorateWorktreePermissionIcons(document);

  const observer = typeof MutationObserver === 'function'
    ? new MutationObserver(scan)
    : undefined;
  observer?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['aria-label'],
    characterData: true,
    childList: true,
    subtree: true,
  });

  return () => {
    if (!active) return;
    active = false;
    observer?.disconnect();
    style.remove();
    for (const marked of document.querySelectorAll(`[${WORKTREE_PERMISSION_ICON_ATTRIBUTE}]`)) {
      marked.removeAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE);
    }
  };
}
