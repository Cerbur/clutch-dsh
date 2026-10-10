import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mountDashboardOverlay,
  isRightSidebarOpenFromDom,
} from '../lib/client/dashboard/dashboard-overlay.js';
import { resolveNativeSidebarRoot } from '../lib/client/overlay/sidebar-overlay-geometry.js';
import { FrameElement, appFrameFixture } from './app-frame-fixture.mjs';

function dom(t) {
  const saved = globalThis.HTMLElement;
  globalThis.HTMLElement = FrameElement;
  t.after(() => {
    globalThis.HTMLElement = saved;
  });
}

for (const titlebar of [false, true]) {
  for (const rightbar of [false, true]) {
    test(`Dashboard mounts with auxiliary frame nodes (titlebar=${titlebar}, rightbar=${rightbar})`, (t) => {
      dom(t);
      const fixture = appFrameFixture({ titlebar, rightbar });
      let placement;
      const dispose = mountDashboardOverlay(fixture.surface, (next) => {
        placement = next;
      });
      t.after(dispose);
      assert.deepEqual(placement, { left: 284, top: 0, width: rightbar ? 676 : 916, height: 800 });
      assert.equal(fixture.center.getAttribute('inert'), '');
      for (const element of [fixture.sidebar, fixture.right, fixture.chrome, fixture.overlay]) {
        assert.equal(element.getAttribute('inert'), null);
      }
    });
  }
}

test('native sidebar root follows functional anchors through wrappers and preceding chrome', () => {
  const { sidebar, root } = appFrameFixture();
  const wrapper = new FrameElement();
  wrapper.rect = { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
  wrapper.append(root);
  sidebar.append(new FrameElement(), wrapper);
  assert.equal(resolveNativeSidebarRoot(sidebar), root);
});

test('Dashboard uses the public sidebar pane when the footer action is absent', (t) => {
  dom(t);
  const { action, surface } = appFrameFixture({ titlebar: true, pane: true });
  action.remove();
  let placement;
  t.after(
    mountDashboardOverlay(surface, (next) => {
      placement = next;
    }),
  );
  assert.equal(placement?.width, 676);
});

test('collapsed rightbar does not reserve a track or report stale open state', (t) => {
  dom(t);
  const { frame, right, center, surface } = appFrameFixture({ titlebar: true });
  frame.setAttribute('data-rightbar-collapsed', '');
  right.setAttribute('data-sidebar-right-open', '');
  right.rect.left = NaN;
  center.rect.right = 1200;
  center.rect.width = 920;
  let placement;
  let open;
  t.after(
    mountDashboardOverlay(
      surface,
      (next) => {
        placement = next;
      },
      {
        onRightSidebarChange: (next) => {
          open = next;
        },
      },
    ),
  );
  assert.deepEqual(placement, { left: 284, top: 0, width: 916, height: 800 });
  assert.equal(open, false);
  assert.equal(isRightSidebarOpenFromDom(frame, right), false);
});

test('caption band and arbitrary sibling order do not alter content placement', (t) => {
  dom(t);
  const { frame, sidebar, center, right, overlay, surface, chrome } = appFrameFixture({
    titlebar: true,
  });
  center.rect.top = 32;
  center.rect.height = 768;
  chrome.rect = { ...center.rect, top: 0, bottom: 32, height: 32 };
  frame.append(overlay, right, chrome, center, sidebar);
  let placement;
  t.after(
    mountDashboardOverlay(surface, (next) => {
      placement = next;
    }),
  );
  assert.deepEqual(placement, { left: 284, top: 32, width: 676, height: 768 });
  assert.equal(chrome.getAttribute('inert'), null);
});

test('nested rightbar marker remains a frame-owned column', (t) => {
  dom(t);
  const { frame, right, surface } = appFrameFixture();
  const wrapper = new FrameElement();
  wrapper.rect = { ...right.rect };
  wrapper.append(right);
  frame.append(wrapper);
  let placement;
  t.after(
    mountDashboardOverlay(surface, (next) => {
      placement = next;
    }),
  );
  assert.equal(placement?.width, 676);
  assert.equal(wrapper.getAttribute('inert'), null);
  assert.equal(right.getAttribute('inert'), null);
});

for (const invalid of [
  'missing sidebar',
  'missing center',
  'ambiguous center',
  'ambiguous rightbar',
  'non-finite center',
  'non-finite sidebar',
  'non-finite overlay',
  'detached overlay',
  'foreign rightbar',
]) {
  test(`Dashboard fails closed for ${invalid}`, (t) => {
    dom(t);
    const { frame, sidebar, center, right, overlay, surface } = appFrameFixture();
    if (invalid === 'missing sidebar') sidebar.remove();
    if (invalid === 'missing center') center.remove();
    if (invalid === 'ambiguous center') {
      const duplicate = new FrameElement();
      duplicate.rect = { ...center.rect };
      frame.append(duplicate);
    }
    if (invalid === 'ambiguous rightbar') {
      const duplicate = new FrameElement();
      duplicate.setAttribute('data-rightbar-col', '');
      frame.append(duplicate);
    }
    if (invalid === 'non-finite center') center.rect.left = NaN;
    if (invalid === 'non-finite sidebar') sidebar.rect.right = Infinity;
    if (invalid === 'non-finite overlay') overlay.rect.top = NaN;
    if (invalid === 'detached overlay') overlay.isConnected = false;
    if (invalid === 'foreign rightbar') new FrameElement().append(right);
    let placement = 'unreported';
    t.after(
      mountDashboardOverlay(surface, (next) => {
        placement = next;
      }),
    );
    assert.equal(placement, undefined);
    assert.equal(center.getAttribute('inert'), null);
    assert.equal(sidebar.getAttribute('inert'), null);
    assert.equal(right.getAttribute('inert'), null);
  });
}

test('Dashboard resize recovers invalid geometry and replaces observed content without leaking concealment', (t) => {
  dom(t);
  const callbacks = [];
  const observed = new Set();
  let pending;
  for (const [key, value] of Object.entries({
    ResizeObserver: class {
      constructor(callback) {
        callbacks.push(callback);
      }
      observe(element) {
        observed.add(element);
      }
      unobserve(element) {
        observed.delete(element);
      }
      disconnect() {
        observed.clear();
      }
    },
    MutationObserver: class {
      constructor(callback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelAnimationFrame: () => {
      pending = undefined;
    },
  })) {
    const saved = globalThis[key];
    globalThis[key] = value;
    t.after(() => {
      globalThis[key] = saved;
    });
  }
  const { frame, center, surface, right } = appFrameFixture();
  center.rect.height = 0;
  let placement;
  const dispose = mountDashboardOverlay(surface, (next) => {
    placement = next;
  });
  assert.equal(placement, undefined);
  assert.equal(observed.has(center), true);
  center.rect.height = 800;
  callbacks[0]();
  pending();
  assert.equal(placement?.width, 676);
  const replacement = new FrameElement();
  replacement.rect = { ...center.rect };
  center.remove();
  frame.append(replacement);
  callbacks[1]();
  pending();
  assert.equal(center.getAttribute('inert'), null);
  assert.equal(observed.has(center), false);
  assert.equal(observed.has(replacement), true);
  assert.equal(replacement.getAttribute('inert'), '');
  frame.setAttribute('data-rightbar-collapsed', '');
  callbacks[1]();
  pending();
  assert.equal(
    placement?.width,
    916,
    'semantic collapse must not lose content during the grid transition',
  );
  assert.equal(replacement.getAttribute('inert'), '');
  right.rect.left = 1200;
  right.rect.width = 0;
  replacement.rect.right = 1200;
  replacement.rect.width = 920;
  callbacks[1]();
  pending();
  assert.equal(placement?.width, 916);
  assert.equal(observed.has(right), true);
  callbacks[0]();
  dispose();
  assert.equal(pending, undefined);
  assert.equal(observed.size, 0);
  assert.equal(replacement.getAttribute('inert'), null);
});
