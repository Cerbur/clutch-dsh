import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

async function sources() {
  const [rows, css, surface, types] = await Promise.all([
    readFile(new URL('../src/client/worktree-surface-rows.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/client/worktree.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/client/WorktreeSurface.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/client/worktree-surface-types.ts', import.meta.url), 'utf8'),
  ]);
  return { rows, css, surface, types };
}

test('renders every visible Session status in the right-side rail', async () => {
  const { rows, css, surface, types } = await sources();

  assert.match(rows, /sessionPresentation/);
  assert.match(rows, /data-session-status/);
  assert.match(rows, /const showTrailingStatus/);
  assert.match(rows, /showTrailingStatus/);
  assert.match(rows, /presentation\.status\.state/);
  assert.match(rows, /data-session-time/);
  assert.match(rows, /relativeTime\(/);
  assert.match(rows, /session\.status\.subagentsRunning/);
  assert.match(rows, /hasOngoingSession/);
  assert.match(rows, /data-group-activity/);
  assert.match(rows, /groupActivity/);
  assert.match(rows, /!expanded/);
  assert.match(surface, /sessionPresentations/);
  assert.match(surface, /hasOngoingSession=\{workspaceHasOngoingSession\}/);
  assert.match(surface, /hasOngoingSession=\{hasOngoingSession\(/);
  assert.match(surface, /sessionPresentations=\{sessionPresentations\}/);
  assert.match(types, /readonly presentation\??:/);
  assert.match(types, /sessionPresentations/);
  assert.match(css, /\.sessionTrailing/);
  assert.match(css, /\.sessionStatus/);
  assert.match(css, /\.sessionTime/);
  assert.doesNotMatch(rows, /sessionStatusSlot/);
  assert.doesNotMatch(css, /\.sessionStatusSlot/);
  assert.doesNotMatch(css, /\.sessionActivity/);
  assert.match(css, /\.groupActivity/);
  assert.match(css, /data-group-activity/);
});

test('does not define a second StateDot animation in the Worktree CSS', async () => {
  const { css } = await sources();
  assert.doesNotMatch(css, /@keyframes/);
  assert.doesNotMatch(css, /animation(?:-name|-delay)?\s*:/);
});

test('keeps Session titles roomy and offsets trailing time from Worktree actions', async () => {
  const { css } = await sources();

  assert.match(
    css,
    /\.sessionTrailing\s*\{[\s\S]*?flex:\s*0 0 52px;[\s\S]*?width:\s*52px;/,
  );
  assert.match(css, /\.sessionTime\s*\{[\s\S]*?margin-right:\s*4px;/);
});
