import assert from 'node:assert/strict';
import test from 'node:test';

import { computeOverlayBounds } from '../lib/client/overlay-bounds.js';
import {
  findNewSessionAnchor,
  resolveNativeSidebarRoot,
  syncObservedElement,
} from '../lib/client/sidebar-overlay-geometry.js';

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
