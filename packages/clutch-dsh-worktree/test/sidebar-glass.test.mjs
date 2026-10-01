import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const stylesheet = await readFile(
  path.resolve(import.meta.dirname, '../src/client/worktree.css'),
  'utf8',
);
const bundledClient = await readFile(path.resolve(import.meta.dirname, '../lib/client.js'), 'utf8');

test('glass material belongs to the visible Worktree overlay', () => {
  assert.ok(stylesheet.includes('.surface {'));
  assert.ok(
    stylesheet.includes("[data-platform='darwin'] .surface[data-native-sidebar-covered='true']"),
  );
  assert.ok(stylesheet.includes('[data-sidebar-collapsed] [data-shell-overlay] .surface,'));
  assert.ok(stylesheet.includes('background: var(--dsw-specific-sidebar-fill)'));
  assert.ok(stylesheet.includes('background: transparent'));
  assert.ok(
    stylesheet.includes('color-mix(in srgb, var(--dsw-specific-sidebar-fill) 90%, transparent)'),
  );
  assert.equal(
    stylesheet.includes('backdrop-filter:'),
    false,
    'native vibrancy supplies the only glass material',
  );
  assert.ok(stylesheet.includes('prefers-reduced-transparency: reduce'));
  assert.ok(stylesheet.includes('background: var(--dsw-specific-sidebar-fill)'));
});

test('client bundling preserves the plugin surface glass material', () => {
  assert.ok(
    bundledClient.includes(
      '[data-sidebar-collapsed] [data-shell-overlay] .-cerbur-clutch-dsh-worktree-surface',
    ),
  );
  assert.ok(bundledClient.includes('data-native-sidebar-covered'));
  assert.ok(bundledClient.includes('coveredSidebarChildren'));
});
