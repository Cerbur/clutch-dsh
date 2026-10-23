import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { URL } from 'node:url';
import { parseAnimation, MAX_SCRIPT_BYTES, MAX_ANIMATION_DURATION_MS } from '../lib/animation.js';
import { animationDocument } from '../lib/client/animation-sandbox.js';
import {
  ANIMATION_GENERATION_PROMPT,
  animationGenerationPrompt,
} from '../lib/client/animation-generation-prompt.js';
import {
  animationPromptLocales,
  promptLanguage,
  subscribePromptLanguage,
} from '../lib/client/animation-prompt-locales.js';

test('every localized creative slot appends to exactly one English technical/art core', () => {
  assert.deepEqual(Object.keys(animationPromptLocales).sort(), ['en', 'zh']);
  assert.doesNotMatch(ANIMATION_GENERATION_PROMPT, /[\u3400-\u9fff]/u);
  for (const copy of Object.values(animationPromptLocales)) {
    assert.equal(
      animationGenerationPrompt(copy.creativeBrief),
      `${ANIMATION_GENERATION_PROMPT}\n\n${copy.creativeBrief}`,
    );
    assert.doesNotMatch(copy.creativeBrief, /render\(|durationMs|fx\.|65536/);
    assert.ok(
      copy.guide && copy.copy && copy.copied && copy.failed && copy.unavailable && copy.label,
    );
  }
});

test('prompt metadata and helper signatures match the parser and public v1 interface', async () => {
  const header = ANIMATION_GENERATION_PROMPT.split('\n').find((line) =>
    line.startsWith('// clutch_fireworks: '),
  );
  assert.equal(
    parseAnimation(header + '\nfunction render(frame, fx) {}', 'custom-prompt').durationMs,
    4000,
  );
  assert.ok(ANIMATION_GENERATION_PROMPT.includes(String(MAX_SCRIPT_BYTES)));
  assert.ok(ANIMATION_GENERATION_PROMPT.includes(String(MAX_ANIMATION_DURATION_MS)));
  const types = await readFile(new URL('../src/animation.ts', import.meta.url), 'utf8');
  const frame = types.match(/interface AnimationFrame \{([\s\S]*?)\n\}/)[1];
  for (const [, field] of frame.matchAll(/readonly (\w+):/g))
    assert.ok(ANIMATION_GENERATION_PROMPT.includes(field), field);
  assert.match(ANIMATION_GENERATION_PROMPT, /frame\.theme.*'light' or 'dark'.*during playback/);
  assert.match(ANIMATION_GENERATION_PROMPT, /missing theme as 'dark'/);
  const helpers = types.match(/interface AnimationHelpers \{([\s\S]*?)\n\}/)[1];
  for (const [, name] of helpers.matchAll(/^ {2}(\w+)\(/gm))
    assert.ok(ANIMATION_GENERATION_PROMPT.includes(`fx.${name}(`), name);
  assert.match(
    ANIMATION_GENERATION_PROMPT,
    /fx\.ring\(x, y, radius, color, lineWidth=2, alpha=1\)/,
  );
  assert.match(
    ANIMATION_GENERATION_PROMPT,
    /fx\.emoji\(text, x, y, size=32, alpha=1, rotation=0\)/,
  );
});

test('prompt-shaped complete standalone script executes against the real Worker helpers at all timeline phases', () => {
  const header = ANIMATION_GENERATION_PROMPT.split('\n').find((line) =>
    line.startsWith('// clutch_fireworks: '),
  );
  const source = `${header}
function render(frame, fx) {
  const {ctx, width, height, progress, time, durationMs, dpr, seed, message, delta, theme} = frame;
  if (![width, height, progress, time, durationMs, dpr, seed, delta].every(Number.isFinite) || typeof message !== 'string') throw new Error('frame');
  if (theme !== 'light' && theme !== 'dark') throw new Error('theme');
  const color = theme === 'light' ? '#334155' : '#edba58';
  const alpha = fx.clamp(Math.min(progress * 5, (1-progress) * 4));
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(width,height); ctx.stroke();
  ctx.restore();
  const x = fx.random() * width, y = height * fx.easeOut(progress);
  fx.circle(x,y,2,color,alpha,0);
  fx.ring(x,y,8,color,2,alpha);
  fx.line(x,y,x+4,y+4,color,2,alpha);
  fx.star(x,y,5,color,alpha,0.1);
  fx.emoji('✦',x,y,24,alpha,0.1);
}`;
  const html = animationDocument(parseAnimation(source, 'custom-contract'), 'test', 42);
  const options = JSON.parse(
    html.slice(html.indexOf(')({"workerSource":') + 2, html.lastIndexOf(')</script>')),
  );
  const reports = [];
  const drawnColors = new Set();
  const context = new Proxy(
    {
      globalCompositeOperation: 'source-over',
      measureText: () => ({ width: 24 }),
      stroke() {
        drawnColors.add(this.strokeStyle);
      },
    },
    {
      get: (target, key) => target[key] ?? (() => {}),
    },
  );
  const worker = vm.createContext({ postMessage: (value) => reports.push(value) });
  vm.runInContext(options.workerSource, worker);
  worker.onmessage({ data: { type: 'init', canvas: { getContext: () => context } } });
  for (const [width, height] of [
    [390, 844],
    [5120, 1440],
  ])
    for (const progress of [0, 0.1, 0.5, 0.9, 1])
      for (const theme of ['light', 'dark'])
        worker.onmessage({
          data: {
            type: 'frame',
            frame: {
              width,
              height,
              dpr: 1,
              time: progress * 4000,
              delta: 16,
              progress,
              durationMs: 4000,
              seed: 42,
              message: '',
              theme,
            },
          },
        });
  assert.equal(reports[0].type, 'ready');
  assert.equal(
    reports.filter((value) => value.type === 'painted').length,
    20,
    JSON.stringify(reports),
  );
  assert.ok(
    reports.every((value) => value.type !== 'error'),
    JSON.stringify(reports),
  );
  assert.ok(drawnColors.has('#334155') && drawnColors.has('#edba58'));
});

test('language follows DSH document.lang and releases its live observer', (t) => {
  const previous = new Map(
    ['document', 'MutationObserver'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  t.after(() => {
    for (const [key, value] of previous) {
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
    }
  });
  const root = { lang: 'zh-CN' };
  globalThis.document = { documentElement: root };
  let callback,
    disconnected = false;
  globalThis.MutationObserver = class {
    constructor(changed) {
      callback = changed;
    }
    observe(element, options) {
      assert.equal(element, root);
      assert.deepEqual(options.attributeFilter, ['lang']);
    }
    disconnect() {
      disconnected = true;
    }
  };
  const seen = [];
  const stop = subscribePromptLanguage(() => seen.push(promptLanguage()));
  assert.equal(promptLanguage(), 'zh');
  for (const lang of ['en-US', 'zh-Hans', 'fr', '']) {
    root.lang = lang;
    callback();
  }
  assert.deepEqual(seen, ['en', 'zh', 'en', 'en']);
  stop();
  assert.equal(disconnected, true);
});
