import assert from 'node:assert/strict';
import test from 'node:test';

import { sumLineTotals } from '../lib/client/dashboard/git/git-facts.js';

test('keeps known line totals when a commit also changes binary files', () => {
  assert.deepEqual(
    sumLineTotals([
      { path: 'README.md', status: 'modified', additions: 163, deletions: 34 },
      { path: 'screenshots-dashboard.png', status: 'added' },
      { path: 'screenshots-dashboard.webp', status: 'deleted' },
    ]),
    { additions: 163, deletions: 34 },
  );
});

test('keeps binary-only totals explicitly unknown', () => {
  assert.equal(
    sumLineTotals([
      { path: 'screenshots-dashboard.png', status: 'added' },
      { path: 'screenshots-dashboard.webp', status: 'deleted' },
    ]),
    undefined,
  );
});
