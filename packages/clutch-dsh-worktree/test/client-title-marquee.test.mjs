import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/client/surface/state/useTitleMarquee.ts', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

test('native title reveal skips tiny overflow, holds the tail, resets on leave and cancels on disposal', (t) => {
  const names = ['window', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const original = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() =>
    names.forEach((name, i) => {
      if (original[i]) Object.defineProperty(globalThis, name, original[i]);
      else delete globalThis[name];
    }),
  );
  let reduced = false;
  let nextFrame = 0;
  const frames = new Map();
  const globals = {
    window: { matchMedia: () => ({ matches: reduced }) },
    requestAnimationFrame: (fn) => {
      frames.set(++nextFrame, fn);
      return nextFrame;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  };
  names.forEach((name) =>
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: globals[name],
    }),
  );
  const advance = (now) => {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(now);
  };
  let dispose;
  const exports = {};
  new Function('require', 'exports', output)(
    () => ({
      useRef: (current) => ({ current }),
      useMemo: (fn) => fn(),
      useEffect: (fn) => {
        dispose = fn();
      },
    }),
    exports,
  );
  const title = {
    clientWidth: 100,
    scrollWidth: 108,
    scrollLeft: 0,
    dataset: {},
    scrollTo({ left }) {
      this.scrollLeft = left;
    },
  };
  const marquee = exports.useTitleMarquee({ current: title });
  marquee.enter();
  assert.equal(frames.size, 0, 'barely clipped titles do not jitter');
  title.scrollWidth = 180;
  marquee.enter();
  advance(100);
  advance(1100);
  assert.equal(title.scrollLeft, 30, 'travel speed is independent of title length');
  assert.deepEqual(title.dataset, { scrolled: '', clipped: '' });
  advance(4100);
  assert.equal(title.scrollLeft, 80);
  assert.deepEqual(title.dataset, { scrolled: '' }, 'final character has no right fade');
  assert.equal(frames.size, 0, 'tail holds without a return loop');
  marquee.leave();
  assert.equal(title.scrollLeft, 0);
  assert.deepEqual(title.dataset, {});
  reduced = true;
  marquee.enter();
  assert.equal(title.scrollLeft, 80, 'reduced motion reveals the tail immediately');
  assert.equal(frames.size, 0);
  marquee.leave();
  reduced = false;
  marquee.enter();
  marquee.enter();
  assert.equal(frames.size, 1, 'reentry cancels the previous frame');
  marquee.leave();
  assert.equal(frames.size, 0);
  marquee.enter();
  dispose();
  assert.equal(frames.size, 0, 'unmount stops outstanding animation');
});
