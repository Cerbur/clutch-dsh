import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('keeps the Session header context and adds a Hero title overlay', async () => {
  const source = await readFile(new URL('../src/client/WorktreeContext.tsx', import.meta.url), 'utf8');
  const heroSource = await readFile(
    new URL('../src/client/WorktreeHeroContext.tsx', import.meta.url),
    'utf8',
  );
  const entry = await readFile(new URL('../src/client/entry.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/client/worktree-context.css', import.meta.url), 'utf8');

  assert.match(source, /WorktreeHeaderContext/);
  assert.match(source, /conversation\.session\.header\.actions/);
  assert.match(heroSource, /WorktreeHeroContext/);
  assert.match(heroSource, /data-phase/);
  assert.match(heroSource, /querySelector/);
  assert.match(heroSource, /offsetParent/);
  assert.match(heroSource, /previewBadge/);
  assert.match(entry, /WorktreeOverlay/);
  assert.match(entry, /shell\.overlay/);
  assert.match(css, /headerContext/);
  assert.match(css, /heroContext/);
  assert.match(css, /text-overflow: ellipsis/);
});
