import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

test('keeps the Session header hover card and adds a Hero title overlay', async () => {
  const source = await readFile(new URL('../src/client/WorktreeContext.tsx', import.meta.url), 'utf8');
  const heroSource = await readFile(
    new URL('../src/client/WorktreeHeroContext.tsx', import.meta.url),
    'utf8',
  );
  const entry = await readFile(new URL('../src/client/entry.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/client/worktree-context.css', import.meta.url), 'utf8');

  assert.match(source, /WorktreeHeaderContext/);
  assert.match(source, /conversation\.session\.header\.actions/);
  assert.match(source, /title=\{value\.label\}/);
  assert.match(source, /\bHoverCard\b/);
  assert.match(source, /openDelayMs=\{500\}/);
  assert.match(
    source,
    /content=\{<div className=\{styles\.contextHoverTitle\}>\{value\.label\}<\/div>\}/,
  );
  assert.match(heroSource, /WorktreeHeroContext/);
  assert.match(heroSource, /data-phase/);
  assert.match(heroSource, /querySelector/);
  assert.match(heroSource, /offsetParent/);
  assert.match(heroSource, /previewBadge/);
  assert.match(heroSource, /HoverCard/);
  assert.match(heroSource, /openDelayMs=\{500\}/);
  assert.match(heroSource, /content=\{<div className=\{styles\.contextHoverTitle\}>\{label\}<\/div>\}/);
  assert.match(entry, /WorktreeOverlay/);
  assert.match(entry, /shell\.overlay/);
  assert.match(css, /headerContext/);
  assert.match(css, /heroContext/);
  assert.match(css, /\.contextHoverTitle[\s\S]*overflow-wrap: anywhere;/);
  assert.match(css, /\.heroContext[\s\S]*pointer-events: auto;/);
  assert.match(heroSource, /data-worktree-hero-host/);
  assert.match(
    css,
    /\.heroContextHost[\s\S]*position: absolute;/,
  );
  assert.doesNotMatch(css, /\.heroContext\s*\{[\s\S]*position: absolute;/);
  assert.match(css, /text-overflow: ellipsis/);
});
