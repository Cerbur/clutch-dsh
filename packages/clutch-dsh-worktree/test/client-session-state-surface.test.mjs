import { readSurfaceSource } from './client-surface-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

async function sources() {
  const [rows, css, surface, types, sessionView] = await Promise.all([
    readFile(new URL('../src/client/surface/components/rows.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/client/worktree.css', import.meta.url), 'utf8'),
    readSurfaceSource(),
    readFile(new URL('../src/client/surface/types.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/client/session/session-view.ts', import.meta.url), 'utf8'),
  ]);
  return { rows, css, surface, types, sessionView };
}

test('renders every visible Session status in the right-side rail', async () => {
  const { rows, css, surface, types, sessionView } = await sources();

  assert.match(rows, /sessionPresentation/);
  assert.match(rows, /data-session-status/);
  assert.match(rows, /const showTrailingStatus/);
  assert.match(rows, /showTrailingStatus/);
  assert.match(rows, /presentation\.status\.state/);
  assert.match(rows, /data-session-time/);
  assert.match(rows, /relativeTime\(/);
  assert.match(rows, /session\.status\.subagentsRunning/);
  assert.match(sessionView, /aggregateSessionStatus/);
  assert.match(rows, /groupActivityStatus.state/);
  assert.match(rows, /data-group-activity/);
  assert.match(rows, /groupActivity/);
  assert.match(rows, /!expanded/);
  assert.match(surface, /sessionPresentations/);
  assert.match(surface, /groupActivityStatus=\{workspaceGroupActivityStatus\}/);
  assert.match(surface, /groupActivityStatus=\{aggregateSessionStatus\(/);
  assert.match(surface, /sessionPresentations=\{sessionPresentations\}/);
  assert.match(types, /readonly presentation\??:/);
  assert.match(types, /sessionPresentations/);
  assert.match(types, /groupActivityStatus\??:/);
  assert.match(css, /\.sessionTrailing/);
  assert.match(css, /\.sessionStatus/);
  assert.match(css, /\.sessionTime/);
  assert.doesNotMatch(rows, /sessionStatusSlot/);
  assert.doesNotMatch(css, /\.sessionStatusSlot/);
  assert.doesNotMatch(css, /\.sessionActivity/);
  assert.match(css, /\.groupActivity/);
  assert.match(css, /data-group-activity/);
});

test('renders one aggregate status dot per collapsed row from complete eligible groups', async () => {
  const { rows, surface } = await sources();
  const workspaceStart = rows.indexOf('export function WorktreeWorkspaceRow');
  const groupStart = rows.indexOf('export function WorktreeGroupRow');
  const workspaceSource = rows.slice(workspaceStart, groupStart);
  const groupEnd = rows.indexOf('/** Worktree-mode Session row', groupStart);
  const groupSource = rows.slice(groupStart, groupEnd);

  assert.notEqual(workspaceStart, -1);
  assert.notEqual(groupStart, -1);
  assert.notEqual(groupEnd, -1);
  const workspaceActivityDotStart = workspaceSource.indexOf('styles.groupActivity');
  const groupActivityDotStart = groupSource.indexOf('styles.groupActivity');
  assert.notEqual(workspaceActivityDotStart, -1);
  assert.notEqual(groupActivityDotStart, -1);
  assert.equal(
    (workspaceSource.slice(workspaceActivityDotStart).match(/<StateDot\b/g) ?? []).length,
    1,
  );
  assert.equal(
    (groupSource.slice(groupActivityDotStart).match(/<StateDot\b/g) ?? []).length,
    1,
  );
  assert.match(workspaceSource, /const groupActivityVisible = !expanded && groupActivityStatus !== undefined/);
  assert.match(groupSource, /const groupActivityVisible = !expanded && groupActivityStatus !== undefined/);
  assert.match(
    surface,
    /const workspaceActivitySessionIds = filterVisibleSessionIds\([\s\S]*?allWorkspaceSessionIds,[\s\S]*?sessions,\s*\);[\s\S]*?const workspaceGroupActivityStatus = aggregateSessionStatus\(\s*workspaceActivitySessionIds,/,
  );
  assert.match(
    surface,
    /const mainSessionIds = filterVisibleSessionIds\([\s\S]*?allWorkspaceSessionIds,[\s\S]*?sessions,\s*\);[\s\S]*?groupActivityStatus=\{aggregateSessionStatus\(mainSessionIds,/,
  );
  assert.match(
    surface,
    /const worktreeSessionIds = filterVisibleSessionIds\([\s\S]*?sessions,\s*\);[\s\S]*?groupActivityStatus=\{aggregateSessionStatus\(worktreeSessionIds,/,
  );
});

test('does not define a second StateDot animation in the Worktree CSS', async () => {
  const { css } = await sources();
  assert.doesNotMatch(css, /@keyframes/);
  assert.doesNotMatch(css, /animation(?:-name|-delay)?\s*:/);
});

test('keeps Session titles roomy and offsets trailing time from Worktree actions', async () => {
  const { css } = await sources();

  assert.match(css, /\.sessionTrailing\s*\{[\s\S]*?flex:\s*0 0 52px;[\s\S]*?width:\s*52px;/);
  assert.match(css, /\.sessionTime\s*\{[\s\S]*?margin-right:\s*4px;/);
});
