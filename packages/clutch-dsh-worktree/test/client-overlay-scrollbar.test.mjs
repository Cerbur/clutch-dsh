import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/client/surface/components/OverlayScrollbar.tsx', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
}).outputText;

// Execute the production component with persistent hook slots and controlled DOM metrics.
function mountScrollbar({ clientHeight = 200, scrollHeight = 800, scrollTop = 0 } = {}) {
  const slots = [];
  const effects = [];
  const listeners = new Map();
  const registrations = [];
  const removals = [];
  const content = {};
  const scrollport = {
    clientHeight,
    scrollHeight,
    scrollTop,
    firstElementChild: content,
    addEventListener(type, callback, options) {
      listeners.set(type, callback);
      registrations.push({ type, callback, options });
    },
    removeEventListener(type, callback) {
      assert.equal(listeners.get(type), callback);
      listeners.delete(type);
      removals.push(type);
    },
  };
  const observers = [];
  class ResizeObserver {
    targets = [];
    disconnected = false;
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  let cursor = 0;
  let mounted = false;
  const react = {
    useRef(current) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { current };
      return slots[slot];
    },
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (value) => { slots[slot] = value; }];
    },
    useLayoutEffect(callback) {
      if (!mounted) effects.push(callback);
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  new Function('require', 'exports', 'ResizeObserver', output)(
    (id) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === '../../worktree.css') {
        return { default: { overlayScrollbar: 'overlayScrollbar', scrollbarThumb: 'scrollbarThumb' } };
      }
      throw new Error(`Unexpected dependency: ${id}`);
    },
    exports,
    ResizeObserver,
  );
  const thumb = {};
  const captures = new Set();
  const released = [];
  const rail = {
    getBoundingClientRect: () => ({ top: 10 }),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture(id) {
      assert.ok(captures.delete(id));
      released.push(id);
    },
  };
  const scrollportRef = { current: scrollport };
  function render() {
    cursor = 0;
    const tree = exports.OverlayScrollbar({ scrollportRef });
    tree.props.children.props.ref.current = thumb;
    return tree;
  }
  render();
  mounted = true;
  const cleanups = effects.map((callback) => callback());
  const [observer] = observers;
  return {
    scrollport, scrollportRef, content, observer, listeners, registrations, removals,
    thumb, rail, captures, released, render,
    scroll: () => listeners.get('scroll')(),
    resize: () => observer.callback(),
    dispose: () => cleanups.forEach((cleanup) => cleanup?.()),
    pointer(overrides = {}) {
      return {
        button: 0, pointerId: 7, clientY: 60, target: thumb, currentTarget: rail,
        prevented: false,
        preventDefault() { this.prevented = true; },
        ...overrides,
      };
    },
  };
}

test('hides the scrollbar for empty, shorter, and exactly fitting content', () => {
  for (const scrollHeight of [0, 100, 200]) {
    const bar = mountScrollbar({ scrollHeight });
    assert.equal(bar.render().props.hidden, true);
    assert.equal(bar.render().props.children.props.style.transform, 'translateY(0px)');
    bar.dispose();
  }
});

test('projects proportional thumb height and travel, including minimum size and resize', () => {
  const bar = mountScrollbar({ scrollTop: 300 });
  let tree = bar.render();
  assert.equal(tree.props.hidden, false);
  assert.deepEqual(tree.props.children.props.style, { height: 50, transform: 'translateY(75px)' });
  bar.scrollport.scrollTop = 600;
  bar.scroll();
  assert.equal(bar.render().props.children.props.style.transform, 'translateY(150px)');
  bar.scrollport.scrollHeight = 4000;
  bar.scrollport.scrollTop = 3800;
  bar.resize();
  assert.deepEqual(bar.render().props.children.props.style, { height: 24, transform: 'translateY(176px)' });
  bar.scrollport.clientHeight = 400;
  bar.scrollport.scrollTop = 1800;
  bar.resize();
  assert.deepEqual(bar.render().props.children.props.style, { height: 40, transform: 'translateY(180px)' });
  bar.scrollport.scrollHeight = 300;
  bar.resize();
  assert.equal(bar.render().props.hidden, true, 'shrinking content hides the rail');
  bar.dispose();
});

test('keeps the thumb in its track during elastic overscroll at either end', () => {
  const bar = mountScrollbar({ scrollTop: -80 });
  assert.equal(bar.render().props.children.props.style.transform, 'translateY(0px)');
  bar.scrollport.scrollTop = 680;
  bar.scroll();
  assert.equal(bar.render().props.children.props.style.transform, 'translateY(150px)');
  bar.scrollport.scrollTop = 300;
  bar.scroll();
  assert.equal(bar.render().props.children.props.style.transform, 'translateY(75px)');
  bar.dispose();
});

test('clicking the track centers the thumb and clamps jumps to the scroll range', () => {
  const bar = mountScrollbar();
  for (const [clientY, expected] of [[110, 300], [-10, 0], [500, 600]]) {
    const event = bar.pointer({ target: bar.rail, clientY });
    bar.render().props.onPointerDown(event);
    assert.equal(event.prevented, true);
    assert.equal(bar.scrollport.scrollTop, expected);
    assert.ok(bar.captures.has(7));
    bar.render().props.onPointerUp(event);
  }
  bar.dispose();
});

for (const release of ['onPointerUp', 'onPointerCancel']) {
  test(`thumb dragging uses the captured origin and ${release} ends the gesture`, () => {
    const bar = mountScrollbar({ scrollTop: 100 });
    const down = bar.pointer();
    bar.render().props.onPointerDown(down);
    assert.equal(bar.scrollport.scrollTop, 100, 'thumb press does not jump');
    assert.equal(bar.render().props['data-dragging'], true);
    bar.render().props.onPointerMove(bar.pointer({ pointerId: 8, clientY: 110 }));
    assert.equal(bar.scrollport.scrollTop, 100, 'another pointer cannot move this drag');
    bar.render().props.onPointerMove(bar.pointer({ clientY: 110 }));
    assert.equal(bar.scrollport.scrollTop, 300, '50px travel maps to 200px content movement');
    bar.render().props.onPointerMove(bar.pointer({ clientY: 85 }));
    assert.equal(bar.scrollport.scrollTop, 200, 'moves stay relative to the original pointerdown');
    bar.render().props[release](down);
    assert.deepEqual(bar.released, [7]);
    assert.equal(bar.captures.size, 0);
    assert.equal(bar.render().props['data-dragging'], undefined);
    bar.render().props.onPointerMove(bar.pointer({ clientY: 160 }));
    assert.equal(bar.scrollport.scrollTop, 200, 'released gestures cannot scroll');
    bar.render().props[release](down);
    assert.deepEqual(bar.released, [7], 'already released capture is not released again');
    bar.dispose();
  });
}

test('losing pointer capture ends dragging and ignores subsequent movement', () => {
  const bar = mountScrollbar();
  bar.render().props.onPointerDown(bar.pointer());
  bar.captures.clear();
  bar.render().props.onLostPointerCapture();
  assert.equal(bar.render().props['data-dragging'], undefined);
  bar.render().props.onPointerMove(bar.pointer({ clientY: 160 }));
  assert.equal(bar.scrollport.scrollTop, 0);
  bar.dispose();
});

test('ignores non-primary presses, missing scrollports, and tracks without travel', () => {
  const bar = mountScrollbar();
  const secondary = bar.pointer({ button: 2 });
  bar.render().props.onPointerDown(secondary);
  assert.equal(secondary.prevented, false);
  bar.scrollportRef.current = null;
  const missing = bar.pointer();
  bar.render().props.onPointerDown(missing);
  assert.equal(missing.prevented, false);
  assert.equal(bar.captures.size, 0);
  bar.dispose();
  const small = mountScrollbar({ clientHeight: 20 });
  const noTravel = small.pointer();
  small.render().props.onPointerDown(noTravel);
  assert.equal(noTravel.prevented, false);
  assert.equal(small.captures.size, 0);
  small.dispose();
});

test('observes viewport and content, registers passive scroll, and removes both on unmount', () => {
  const bar = mountScrollbar();
  assert.deepEqual(bar.observer.targets, [bar.scrollport, bar.content]);
  assert.equal(bar.registrations.length, 1, 'rerenders do not register extra listeners');
  assert.equal(bar.registrations[0].type, 'scroll');
  assert.deepEqual(bar.registrations[0].options, { passive: true });
  bar.render();
  bar.render();
  assert.equal(bar.registrations.length, 1);
  assert.equal(bar.observer.disconnected, false);
  bar.dispose();
  assert.equal(bar.observer.disconnected, true);
  assert.equal(bar.listeners.size, 0);
  assert.deepEqual(bar.removals, ['scroll']);
});
