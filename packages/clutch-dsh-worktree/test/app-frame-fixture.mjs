// Minimal DOM with real ancestry and selector semantics, plus controlled layout metrics.
export class FrameElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.rect = { left: 0, right: 1200, top: 0, bottom: 800, width: 1200, height: 800 };
    const styles = new Map();
    this.style = {
      getPropertyValue: (key) => styles.get(key)?.[0] ?? '',
      getPropertyPriority: (key) => styles.get(key)?.[1] ?? '',
      setProperty: (key, value, priority = '') => styles.set(key, [value, priority]),
      removeProperty: (key) => styles.delete(key),
    };
  }
  append(...children) {
    for (const child of children) {
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get lastElementChild() {
    return this.children.at(-1) ?? null;
  }
  get nextElementSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] ?? null;
  }
  hasAttribute(key) {
    return this.attributes.has(key);
  }
  getAttribute(key) {
    return this.attributes.get(key) ?? null;
  }
  setAttribute(key, value) {
    this.attributes.set(key, value);
  }
  removeAttribute(key) {
    this.attributes.delete(key);
  }
  matches(selector) {
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    return attribute
      ? this.hasAttribute(attribute[1]) &&
          (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2])
      : this.tagName === selector;
  }
  closest(selector) {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  contains(element) {
    return this === element || this.children.some((child) => child.contains(element));
  }
  getBoundingClientRect() {
    return this.rect;
  }
}

export function appFrameFixture({ rightbar = true, titlebar = false, pane = false } = {}) {
  const frame = new FrameElement();
  const sidebar = new FrameElement();
  sidebar.rect = { ...sidebar.rect, right: 280, width: 280 };
  const root = new FrameElement();
  root.rect = { ...sidebar.rect };
  if (pane) root.setAttribute('data-pane', 'sidebar');
  const newSession = new FrameElement('button');
  newSession.textContent = 'New Session';
  newSession.rect = { ...root.rect, top: 100, bottom: 138, height: 38 };
  const footer = new FrameElement();
  footer.rect = { ...root.rect, top: 740, height: 60 };
  const action = new FrameElement('button');
  action.setAttribute('data-worktree-mode-action', '');
  footer.append(action);
  root.append(newSession, footer);
  sidebar.append(root);
  const center = new FrameElement();
  center.rect = {
    ...center.rect,
    left: 280,
    right: rightbar ? 960 : 1200,
    width: rightbar ? 680 : 920,
  };
  const right = new FrameElement();
  right.setAttribute('data-rightbar-col', '');
  right.rect = { ...right.rect, left: 960, width: 240 };
  const overlay = new FrameElement();
  overlay.setAttribute('data-shell-overlay', '');
  const surface = new FrameElement();
  overlay.append(surface);
  const chrome = new FrameElement();
  chrome.rect = { ...chrome.rect, bottom: 32, height: 32 };
  const handle = new FrameElement();
  handle.rect = { ...handle.rect, left: 276, right: 284, width: 8 };
  const leading = new FrameElement();
  leading.setAttribute('data-shell-leading', '');
  frame.append(
    ...(titlebar ? [chrome] : []),
    sidebar,
    handle,
    center,
    ...(rightbar ? [right] : []),
    ...(titlebar ? [new FrameElement('span')] : []),
    overlay,
    leading,
  );
  return {
    frame,
    sidebar,
    root,
    newSession,
    footer,
    action,
    center,
    right,
    overlay,
    surface,
    chrome,
  };
}
