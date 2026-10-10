import assert from 'node:assert/strict';
import test from 'node:test';

import { computeOverlayBounds } from '../lib/client/overlay/overlay-bounds.js';
import {
  computeSidebarOverlayBounds,
  findNewSessionAnchor,
  resolveNativeSidebarRoot,
  resolveSidebarFooter,
  syncObservedElement,
} from '../lib/client/overlay/sidebar-overlay-geometry.js';

test('unwraps the display-contents sidebar slot before measuring the native root', () => {
  const nativeRoot = {
    firstElementChild: null,
    getBoundingClientRect: () => ({ width: 280, height: 813 }),
  };
  const slotWrapper = {
    firstElementChild: nativeRoot,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  };
  const sidebar = {
    firstElementChild: slotWrapper,
    getBoundingClientRect: () => ({ width: 280, height: 813 }),
  };

  assert.equal(resolveNativeSidebarRoot(sidebar), nativeRoot);
});

test('prefers the visible New Session button when the logo shortcut shares its label', () => {
  const logoShortcut = {
    textContent: 'DSH Local Build',
    getAttribute: () => '新建会话',
  };
  const newSession = {
    textContent: '新会话',
    getAttribute: () => '新建会话',
  };
  const root = {
    querySelectorAll: () => [logoShortcut, newSession],
  };

  assert.equal(findNewSessionAnchor(root), newSession);
});

test('never uses a marked native chrome row as the overlay anchor when its dedicated action is missing', () => {
  const root = { querySelectorAll: () => [brand] };
  const chrome = {
    parentElement: root,
    hasAttribute: (name) => name === 'data-window-drag',
  };
  const brand = {
    textContent: 'DSH Local Build',
    parentElement: chrome,
    getAttribute: () => 'New session',
  };
  assert.equal(findNewSessionAnchor(root), undefined);
});

test('computes coverage from New Session top to footer top', () => {
  assert.deepEqual(
    computeOverlayBounds(
      { top: 100, bottom: 900 },
      { top: 260, bottom: 298 },
      { top: 820, bottom: 900 },
    ),
    { ready: true, top: 160, height: 560 },
  );
});

test('clamps a footer that is above the New Session anchor to zero height', () => {
  assert.deepEqual(
    computeOverlayBounds(
      { top: 100, bottom: 900 },
      { top: 700, bottom: 738 },
      { top: 650, bottom: 730 },
    ),
    { ready: true, top: 600, height: 0 },
  );
});

test('returns zero coverage when either anchor is unavailable', () => {
  assert.deepEqual(
    computeOverlayBounds({ top: 100, bottom: 900 }, undefined, { top: 820, bottom: 900 }),
    { ready: false, top: 0, height: 0 },
  );
  assert.deepEqual(
    computeOverlayBounds({ top: 100, bottom: 900 }, { top: 260, bottom: 298 }, undefined),
    { ready: false, top: 0, height: 0 },
  );
});

test('tracks replacement geometry anchors with the ResizeObserver', () => {
  const first = {};
  const second = {};
  const observer = {
    observed: [],
    unobserved: [],
    observe(element) {
      this.observed.push(element);
    },
    unobserve(element) {
      this.unobserved.push(element);
    },
  };

  let current = syncObservedElement(observer, undefined, first);
  current = syncObservedElement(observer, current, second);
  current = syncObservedElement(observer, current, undefined);

  assert.deepEqual(observer.observed, [first, second]);
  assert.deepEqual(observer.unobserved, [first, second]);
  assert.equal(current, undefined);
});

test('resolves the direct child containing the worktree mode action as the footer', () => {
  const root = {
    firstElementChild: null,
    lastElementChild: null,
    querySelector: (selector) => (selector === '[data-worktree-mode-action]' ? actionButton : null),
  };
  const header = { parentElement: root };
  const directChildFooter = { parentElement: root };
  const actionWrapper = { parentElement: directChildFooter };
  const actionButton = { parentElement: actionWrapper };

  root.firstElementChild = header;
  root.lastElementChild = directChildFooter;

  assert.equal(resolveSidebarFooter(root), directChildFooter);
});

test('resolves real footer and computes positive bounds when desktop shell appends a pseudo-element at root end', () => {
  const overlay = { top: 100, bottom: 900 };
  const newSessionRect = { top: 120, bottom: 156 };
  const realFooterRect = { top: 800, bottom: 840 };
  const pseudoChildRect = { top: 120, bottom: 120 };

  const actionButton = { parentElement: null };
  const realFooter = {
    parentElement: null,
    getBoundingClientRect: () => realFooterRect,
  };
  const pseudoChild = {
    parentElement: null,
    getBoundingClientRect: () => pseudoChildRect,
  };
  const root = {
    firstElementChild: null,
    lastElementChild: pseudoChild,
    querySelector: (selector) => (selector === '[data-worktree-mode-action]' ? actionButton : null),
  };
  const header = { parentElement: root };
  root.firstElementChild = header;
  realFooter.parentElement = root;
  actionButton.parentElement = realFooter;
  pseudoChild.parentElement = root;

  // Root.lastElementChild would erroneously collapse overlay height to 0
  const legacyBounds = computeOverlayBounds(overlay, newSessionRect, pseudoChildRect);
  assert.equal(legacyBounds.height, 0);

  // ResolveSidebarFooter identifies the real footer over the pseudo last element
  const resolvedFooter = resolveSidebarFooter(root);
  assert.equal(resolvedFooter, realFooter);

  // Bounds with the resolved footer compute a correct positive height
  const bounds = computeOverlayBounds(overlay, newSessionRect, realFooterRect);
  assert.deepEqual(bounds, {
    ready: true,
    top: 20,
    height: 680,
  });
});

test('safely falls back to lastElementChild when the worktree mode action is absent', () => {
  const fallbackFooter = {};
  const root = {
    firstElementChild: {},
    lastElementChild: fallbackFooter,
    querySelector: () => null,
  };
  assert.equal(resolveSidebarFooter(root), fallbackFooter);
});

test('safely falls back to lastElementChild when the action is inside the firstElementChild', () => {
  const fallbackFooter = {};
  const actionButton = { parentElement: null };
  const firstChild = { parentElement: null };
  const root = {
    firstElementChild: firstChild,
    lastElementChild: fallbackFooter,
    querySelector: () => actionButton,
  };
  firstChild.parentElement = root;
  actionButton.parentElement = firstChild;
  assert.equal(resolveSidebarFooter(root), fallbackFooter);
});

test('matches New Session button when textContent includes keyboard shortcut prefix', () => {
  const buttonWithShortcutZh = {
    textContent: '新会话Ctrl+Alt+N',
    parentElement: null,
    getAttribute: () => null,
  };
  const rootZh = {
    querySelectorAll: () => [buttonWithShortcutZh],
  };
  buttonWithShortcutZh.parentElement = rootZh;
  assert.equal(findNewSessionAnchor(rootZh), buttonWithShortcutZh);

  const buttonWithShortcutEn = {
    textContent: 'New Session (Ctrl+N)',
    parentElement: null,
    getAttribute: () => null,
  };
  const rootEn = {
    querySelectorAll: () => [buttonWithShortcutEn],
  };
  buttonWithShortcutEn.parentElement = rootEn;
  assert.equal(findNewSessionAnchor(rootEn), buttonWithShortcutEn);
});

test('falls back to root bottom when computed footer bounds collapse to zero height', () => {
  const overlay = { top: 100, bottom: 900 };
  const newSession = { top: 120, bottom: 156 };
  const abnormalFooter = { top: 120, bottom: 120 };
  const root = { top: 100, bottom: 900 };

  const bounds = computeSidebarOverlayBounds(overlay, newSession, abnormalFooter, root);
  assert.deepEqual(bounds, {
    ready: true,
    top: 20,
    height: 780,
  });
});
