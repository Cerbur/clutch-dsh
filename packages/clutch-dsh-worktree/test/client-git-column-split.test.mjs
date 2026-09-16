import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GIT_COLUMN_SPLIT_DEFAULT_PERCENT,
  GIT_COLUMN_SPLIT_KEY_STEP,
  GIT_COLUMN_SPLIT_MIN_PANE_PX,
  clampGitColumnSplitPercent,
  gitColumnSplitPercentFromPointer,
} from '../lib/client/dashboard/git/git-column-split.js';

const geometry = { top: 100, height: 500, divider: 7 };

/** Mirror the rounded percentage the divider math publishes to CSS. */
function percent(pixels, height) {
  return Math.round(((pixels / height) * 100) * 100) / 100;
}

test('keeps both stacked panes at their minimum usable height', () => {
  assert.equal(
    clampGitColumnSplitPercent(0, geometry),
    percent(GIT_COLUMN_SPLIT_MIN_PANE_PX, geometry.height),
  );
  assert.equal(
    clampGitColumnSplitPercent(100, geometry),
    100 - percent(GIT_COLUMN_SPLIT_MIN_PANE_PX + geometry.divider, geometry.height),
  );
});

test('keeps an in-range split and rounds it into a stable CSS value', () => {
  assert.equal(clampGitColumnSplitPercent(45, geometry), 45);
  assert.equal(clampGitColumnSplitPercent(33.333333, geometry), 33.33);
});

test('falls back to the default split for degenerate geometry', () => {
  assert.equal(
    clampGitColumnSplitPercent(Number.NaN, geometry),
    GIT_COLUMN_SPLIT_DEFAULT_PERCENT,
  );
  assert.equal(
    clampGitColumnSplitPercent(45, { top: 0, height: 0, divider: 0 }),
    GIT_COLUMN_SPLIT_DEFAULT_PERCENT,
  );
  // A column too short for both panes keeps the default instead of collapsing one pane.
  assert.equal(
    clampGitColumnSplitPercent(45, { top: 0, height: 200, divider: 7 }),
    GIT_COLUMN_SPLIT_DEFAULT_PERCENT,
  );
});

test('centers the divider under the pointer and clamps out-of-range drags', () => {
  const pointerY = geometry.top + 0.5 * geometry.height + geometry.divider / 2;
  assert.equal(gitColumnSplitPercentFromPointer(pointerY, geometry), 50);
  assert.equal(
    gitColumnSplitPercentFromPointer(geometry.top - 400, geometry),
    percent(GIT_COLUMN_SPLIT_MIN_PANE_PX, geometry.height),
  );
});

test('exposes the constants the CSS layout mirrors', () => {
  assert.equal(GIT_COLUMN_SPLIT_DEFAULT_PERCENT, 45);
  assert.equal(GIT_COLUMN_SPLIT_MIN_PANE_PX, 140);
  assert.ok(GIT_COLUMN_SPLIT_KEY_STEP > 0);
});
