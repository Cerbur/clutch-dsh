import assert from 'node:assert/strict';
import test from 'node:test';

import { computeOverlayBounds } from '../lib/client/overlay/overlay-bounds.js';
import {
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

function sidebarFixture() {
  const element = (top, bottom) => ({
    parentElement: null,
    getBoundingClientRect: () => ({ top, bottom }),
  });
  const root = element(100, 900);
  const header = element(100, 120);
  const content = element(120, 800);
  const newSession = element(120, 156);
  const footer = element(800, 840);
  const wrapper = element(800, 840);
  const action = element(800, 840);
  root.children = [header, content, footer];
  root.firstElementChild = header;
  root.lastElementChild = footer;
  root.querySelector = (selector) => {
    assert.equal(selector, '[data-worktree-mode-action]');
    return root.action ?? null;
  };
  for (const child of root.children) child.parentElement = root;
  newSession.parentElement = content;
  wrapper.parentElement = footer;
  action.parentElement = wrapper;
  root.action = action;
  return { root, content, newSession, footer, action, element };
}

test('resolves nested footer-slot action without assuming it is the last child', () => {
  const { root, newSession, footer, element } = sidebarFixture();
  // A real trailing DOM node, not a CSS pseudo-element (which is not in children).
  const decoration = element(120, 120);
  decoration.parentElement = root;
  root.children.push(decoration);
  root.lastElementChild = decoration;
  const resolved = resolveSidebarFooter(root, newSession);
  assert.equal(resolved, footer);
  assert.deepEqual(
    computeOverlayBounds(
      { top: 100, bottom: 900 },
      newSession.getBoundingClientRect(),
      resolved.getBoundingClientRect(),
    ),
    { ready: true, top: 20, height: 680 },
  );
});

test('uses a validated last child when the plugin marker is absent', () => {
  const { root, newSession, footer } = sidebarFixture();
  root.action = null;
  assert.equal(resolveSidebarFooter(root, newSession), footer);
});

test('does not guess a footer when the marker is inside the content subtree', () => {
  const { root, content, newSession, action } = sidebarFixture();
  action.parentElement = content;
  assert.equal(resolveSidebarFooter(root, newSession), undefined);
});

for (const [name, rect] of [
  ['zero-height decoration', { top: 120, bottom: 120 }],
  ['overlapping anchor', { top: 140, bottom: 840 }],
  ['outside root', { top: 800, bottom: 950 }],
  ['non-finite geometry', { top: NaN, bottom: 840 }],
]) {
  for (const marked of [true, false]) {
    test('rejects ' + name + ' as ' + (marked ? 'marked' : 'legacy') + ' footer', () => {
      const { root, newSession, footer } = sidebarFixture();
      if (!marked) root.action = null;
      footer.getBoundingClientRect = () => rect;
      const resolved = resolveSidebarFooter(root, newSession);
      assert.equal(resolved, undefined);
      assert.deepEqual(
        computeOverlayBounds({ top: 100, bottom: 900 }, newSession.getBoundingClientRect(), resolved),
        { ready: false, top: 0, height: 0 },
      );
    });
  }
}

test('rejects a footer before the content in DOM order even if its geometry looks valid', () => {
  const { root, content, newSession, footer } = sidebarFixture();
  root.children = [footer, content];
  assert.equal(resolveSidebarFooter(root, newSession), undefined);
  root.action = null;
  root.lastElementChild = footer;
  assert.equal(resolveSidebarFooter(root, newSession), undefined);
});

test('does not use the content itself as the last-child fallback', () => {
  const { root, content, newSession } = sidebarFixture();
  root.action = null;
  root.children = [content];
  root.lastElementChild = content;
  assert.equal(resolveSidebarFooter(root, newSession), undefined);
});

test('requires a New Session anchor inside the current root', () => {
  const { root, newSession } = sidebarFixture();
  assert.equal(resolveSidebarFooter(root, undefined), undefined);
  newSession.parentElement = null;
  assert.equal(resolveSidebarFooter(root, newSession), undefined);
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
