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

test('renders native Session status and right-side time/activity slots', async () => {
  const { rows, css, surface, types } = await sources();

  assert.match(rows, /sessionPresentation/);
  assert.match(rows, /data-session-status/);
  assert.match(rows, /data-session-activity/);
  assert.match(rows, /data-session-time/);
  assert.match(rows, /StateDot state=\{['"]ongoing['"]\}/);
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
  assert.match(css, /\.sessionActivity/);
  assert.match(css, /\.sessionTime/);
  assert.match(css, /\.sessionStatusSlot/);
  assert.match(css, /\.groupActivity/);
  assert.match(css, /data-group-activity/);
});

test('does not define a second StateDot animation in the Worktree CSS', async () => {
  const { css } = await sources();
  assert.doesNotMatch(css, /@keyframes/);
  assert.doesNotMatch(css, /animation(?:-name|-delay)?\s*:/);
});
