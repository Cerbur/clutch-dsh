import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKTREE_PERMISSION_ICON_ATTRIBUTE,
  decorateWorktreePermissionIcons,
  installWorktreePermissionIcon,
} from '../lib/client/worktree-permission-icon.js';

class FakeElement {
  constructor(tagName = 'div', { text = '', role, ariaLabel } = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this._text = text;
    if (role !== undefined) this.setAttribute('role', role);
    if (ariaLabel !== undefined) this.setAttribute('aria-label', ariaLabel);
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this._text = value;
    this.children = [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  matches(selector) {
    const roleMatch = selector.match(/^button\[role="([^"]+)"\]$/);
    if (roleMatch !== null) {
      return this.tagName === 'BUTTON' && this.getAttribute('role') === roleMatch[1];
    }
    if (selector === 'button[aria-label]') {
      return this.tagName === 'BUTTON' && this.getAttribute('aria-label') !== null;
    }
    if (selector === '[role="menu"]') return this.getAttribute('role') === 'menu';
    if (selector === '[data-clutch-dsh-worktree-permission-icon]') {
      return this.getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE) !== null;
    }
    if (selector === 'style[data-plugin]') {
      return this.tagName === 'STYLE' && this.getAttribute('data-plugin') !== null;
    }
    if (selector === 'style[data-plugin-css]') {
      return this.tagName === 'STYLE' && this.getAttribute('data-plugin-css') !== null;
    }
    throw new Error(`unsupported selector: ${selector}`);
  }

  closest(selector) {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  querySelectorAll(selector) {
    const result = [];
    const visit = (element) => {
      for (const child of element.children) {
        if (child.matches(selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentElement === null) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement('html');
    this.head = new FakeElement('head');
    this.documentElement.appendChild(this.head);
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  }
}

function permissionMenu(label = 'Worktree Full Access') {
  const menu = new FakeElement('div', { role: 'menu' });
  menu.appendChild(new FakeElement('button', { role: 'menuitem', text: label }));
  return menu;
}

function trigger(label = 'Access mode, current: Worktree Full Access') {
  return new FakeElement('button', { ariaLabel: label });
}

test('decorates only the Worktree Full Access row and current trigger', () => {
  const document = new FakeDocument();
  const menu = permissionMenu();
  const auto = new FakeElement('button', { role: 'menuitem', text: 'Auto' });
  auto.setAttribute('data-dsh-auto-mode-icon', 'menu');
  menu.appendChild(auto);
  document.documentElement.append(menu, trigger());

  const unrelated = new FakeElement('button', { text: 'Worktree Full Access' });
  document.documentElement.appendChild(unrelated);
  const otherTrigger = trigger('Open Worktree Full Access settings');
  document.documentElement.appendChild(otherTrigger);

  decorateWorktreePermissionIcons(document);

  assert.equal(menu.children[0].getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), 'menu');
  assert.equal(document.documentElement.children.at(-2), unrelated);
  assert.equal(unrelated.getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), null);
  assert.equal(document.documentElement.children[2].getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), 'trigger');
  assert.equal(otherTrigger.getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), null);
  assert.equal(auto.getAttribute('data-dsh-auto-mode-icon'), 'menu');
});

test('supports the Chinese trigger label without depending on other permission options', () => {
  const document = new FakeDocument();
  const menu = permissionMenu();
  const chineseTrigger = trigger('访问模式，当前：Worktree Full Access');
  document.documentElement.append(menu, chineseTrigger);

  decorateWorktreePermissionIcons(document);

  assert.equal(menu.children[0].getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), 'menu');
  assert.equal(chineseTrigger.getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), 'trigger');
});

test('observes rerenders and disposes only the plugin-owned decoration', async () => {
  const originalMutationObserver = globalThis.MutationObserver;
  let triggerObserver;
  let observerDisconnected = false;
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      triggerObserver = () => callback([]);
    }

    observe() {}

    disconnect() {
      observerDisconnected = true;
    }

    trigger() {
      this.callback([]);
    }
  }
  globalThis.MutationObserver = FakeMutationObserver;

  try {
    const document = new FakeDocument();
    const autoStyle = document.createElement('style');
    autoStyle.setAttribute('data-plugin', '@nanmicoder/dsh-auto-mode');
    autoStyle.setAttribute('data-plugin-css', '@nanmicoder/dsh-auto-mode/permission-icon');
    document.head.appendChild(autoStyle);
    const autoMarker = new FakeElement('button', { role: 'menuitem', text: 'Auto' });
    autoMarker.setAttribute('data-dsh-auto-mode-icon', 'menu');
    document.documentElement.appendChild(autoMarker);

    const dispose = installWorktreePermissionIcon(document);
    const menu = permissionMenu();
    document.documentElement.appendChild(menu);
    triggerObserver();
    await new Promise((resolve) => globalThis.queueMicrotask(resolve));

    assert.equal(menu.children[0].getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), 'menu');
    assert.equal(document.head.querySelectorAll('style[data-plugin-css]').length, 2);

    dispose();

    assert.equal(observerDisconnected, true);
    assert.equal(menu.children[0].getAttribute(WORKTREE_PERMISSION_ICON_ATTRIBUTE), null);
    assert.equal(autoMarker.getAttribute('data-dsh-auto-mode-icon'), 'menu');
    assert.equal(document.head.querySelectorAll('style[data-plugin-css]').length, 1);
    assert.equal(document.head.querySelectorAll('style[data-plugin]')[0], autoStyle);
  } finally {
    if (originalMutationObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = originalMutationObserver;
  }
});
