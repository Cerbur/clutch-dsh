import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GIT_SPLIT_DEFAULT_COLUMN_PERCENT,
  GIT_SPLIT_DEFAULT_ROW_PERCENT,
  GIT_SPLIT_KEY_STEP,
  GIT_SPLIT_MIN_COLUMN_PX,
  GIT_SPLIT_MIN_ROW_PX,
  clampGitSplitPercent,
  gitSplitPercentFromPointer,
} from '../lib/client/dashboard/git/git-column-split.js';

const rowGeometry = { start: 100, size: 500, divider: 7, minimum: GIT_SPLIT_MIN_ROW_PX };
const columnGeometry = { start: 40, size: 1000, divider: 7, minimum: GIT_SPLIT_MIN_COLUMN_PX };

/** Mirror the rounded percentage the divider math publishes to CSS. */
function percent(pixels, size) {
  return Math.round(((pixels / size) * 100) * 100) / 100;
}

test('keeps both row panes at their minimum usable height', () => {
  assert.equal(
    clampGitSplitPercent(0, rowGeometry),
    percent(GIT_SPLIT_MIN_ROW_PX, rowGeometry.size),
  );
  assert.equal(
    clampGitSplitPercent(100, rowGeometry),
    100 - percent(GIT_SPLIT_MIN_ROW_PX + rowGeometry.divider, rowGeometry.size),
  );
});

test('keeps both column panes at their minimum usable width', () => {
  assert.equal(
    clampGitSplitPercent(0, columnGeometry),
    percent(GIT_SPLIT_MIN_COLUMN_PX, columnGeometry.size),
  );
  assert.equal(
    clampGitSplitPercent(100, columnGeometry),
    100 - percent(GIT_SPLIT_MIN_COLUMN_PX + columnGeometry.divider, columnGeometry.size),
  );
});

test('keeps an in-range split and rounds it into a stable CSS value', () => {
  assert.equal(clampGitSplitPercent(45, rowGeometry), 45);
  assert.equal(clampGitSplitPercent(33.333333, rowGeometry), 33.33);
  assert.equal(clampGitSplitPercent(GIT_SPLIT_DEFAULT_COLUMN_PERCENT, columnGeometry), 38);
});

test('reports no usable split for degenerate geometry', () => {
  assert.equal(clampGitSplitPercent(Number.NaN, rowGeometry), undefined);
  assert.equal(clampGitSplitPercent(45, { ...rowGeometry, size: 0 }), undefined);
  // An axis too short for both panes cannot express a usable split.
  assert.equal(clampGitSplitPercent(45, { ...rowGeometry, size: 200 }), undefined);
  assert.equal(clampGitSplitPercent(45, { ...columnGeometry, size: 400 }), undefined);
});

test('centers the divider under the pointer and clamps out-of-range drags', () => {
  const rowPointer = rowGeometry.start + 0.5 * rowGeometry.size + rowGeometry.divider / 2;
  assert.equal(gitSplitPercentFromPointer(rowPointer, rowGeometry), 50);

  const columnPointer =
    columnGeometry.start + 0.25 * columnGeometry.size + columnGeometry.divider / 2;
  assert.equal(gitSplitPercentFromPointer(columnPointer, columnGeometry), 25);

  assert.equal(
    gitSplitPercentFromPointer(rowGeometry.start - 400, rowGeometry),
    percent(GIT_SPLIT_MIN_ROW_PX, rowGeometry.size),
  );
  assert.equal(
    gitSplitPercentFromPointer(columnGeometry.start + columnGeometry.size, columnGeometry),
    100 - percent(GIT_SPLIT_MIN_COLUMN_PX + columnGeometry.divider, columnGeometry.size),
  );
});

test('exposes the constants the CSS layout mirrors', () => {
  assert.equal(GIT_SPLIT_DEFAULT_ROW_PERCENT, 45);
  assert.equal(GIT_SPLIT_DEFAULT_COLUMN_PERCENT, 38);
  assert.equal(GIT_SPLIT_MIN_ROW_PX, 140);
  assert.equal(GIT_SPLIT_MIN_COLUMN_PX, 240);
  assert.ok(GIT_SPLIT_KEY_STEP > 0);
});
