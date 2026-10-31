import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitchenPixelRatio } from '../lib/client/scene/render-budget.js';

test('full-size Retina scenes keep detail and large canvases never undersample CSS pixels', () => {
  for (const [width, height, dpr] of [
    [1042, 820, 2],
    [3840, 2160, 3],
    [800, 600, 1],
    [400, 300, 0.75],
  ]) {
    const ratio = kitchenPixelRatio(width, height, dpr);
    assert.ok(ratio >= Math.min(1, dpr));
    assert.ok(ratio <= Math.min(2, dpr));
  }
  assert.equal(kitchenPixelRatio(1680, 820, 2), 2);
  assert.equal(kitchenPixelRatio(800, 600, NaN), 1);
});
