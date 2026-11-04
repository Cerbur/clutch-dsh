import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const stylesheet = await readFile(
  path.resolve(import.meta.dirname, '../src/client/worktree.css'),
  'utf8',
);
const bundledClient = await readFile(path.resolve(import.meta.dirname, '../lib/client.js'), 'utf8');

test('workspace seat inherits the native sidebar material without another background layer', () => {
  assert.ok(stylesheet.includes('.surface {'));
  assert.match(stylesheet, /\.surface \{[^}]*background: transparent;/);
  assert.ok(stylesheet.includes(".surface[data-collapsed='true']"));
  assert.ok(!stylesheet.includes('data-native-sidebar-covered'));
  assert.equal(
    stylesheet.includes('backdrop-filter:'),
    false,
    'native vibrancy supplies the only glass material',
  );
});

test('client bundle uses the workspace slot and excludes the retired sidebar concealment', () => {
  assert.ok(bundledClient.includes('data-worktree-workspace-seat'));
  assert.ok(bundledClient.includes('sidebar.workspaces'));
  assert.ok(!bundledClient.includes('data-native-sidebar-covered'));
  assert.ok(!bundledClient.includes('coveredSidebarChildren'));
});
