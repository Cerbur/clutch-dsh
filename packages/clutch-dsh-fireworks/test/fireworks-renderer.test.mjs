import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmojiFireworksVisuals,
  emojiFireworksRenderer,
} from '../lib/client/fireworks-renderer.js';

function countGlyph(visuals, glyph) {
  return visuals.filter((visual) => visual.glyph === glyph).length;
}

test('creates a deterministic full-screen emoji burst', () => {
  const signal = { id: 'call-42', message: 'MVP shipped!' };
  const first = createEmojiFireworksVisuals(signal);
  const second = createEmojiFireworksVisuals(signal);
  assert.deepEqual(first, second);
  assert.equal(first.length, 40);
  assert.ok(countGlyph(first, '🎉') >= 10);
  assert.ok(countGlyph(first, '🌟') >= 5);
  assert.ok(countGlyph(first, '✨') >= 5);
  assert.ok(new Set(first.map((visual) => visual.glyph)).size >= 10);
  assert.ok(first.every((visual) => visual.kind === 'emoji'));
  assert.ok(first.every((visual) => visual.glyph.length > 0));
  assert.ok(first.every((visual) => visual.left >= 4 && visual.left <= 96));
  assert.ok(first.every((visual) => visual.top >= -8 && visual.top <= 108));
  assert.ok(first.every((visual) => visual.delayMs >= 0 && visual.delayMs <= 720));
});

test('keeps randomized ending scales in the enlarged range', () => {
  const visuals = createEmojiFireworksVisuals({ id: 'call-42' });

  assert.ok(visuals.every((visual) => visual.scale >= 1.15 && visual.scale <= 1.65));
  assert.ok(new Set(visuals.map((visual) => visual.scale)).size > 1);
});

test('starts the drift animation at 0.75 scale', async () => {
  const css = await readFile(new URL('../src/client/fireworks.css', import.meta.url), 'utf8');

  assert.match(css, /0%\s*{[\s\S]*?scale\(0\.75\);/);
});

test('exposes the renderer interface used by the overlay', () => {
  assert.deepEqual(
    emojiFireworksRenderer.createVisuals({ id: 'call-1' }),
    createEmojiFireworksVisuals({ id: 'call-1' }),
  );
});
