import assert from 'node:assert/strict';
import test from 'node:test';

import { computeOverlayBounds } from '../lib/client/overlay-bounds.js';

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
