import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { normalizePluginSpec } from '../src/plugin.mjs';

test('plugin module', async (t) => {
  await t.test('normalizePluginSpec resolves local relative paths to absolute', () => {
    const rel = './packages/clutch-dsh-worktree';
    const normalized = normalizePluginSpec(rel);
    assert.ok(path.isAbsolute(normalized));
    assert.ok(normalized.endsWith(path.join('packages', 'clutch-dsh-worktree')));
  });

  await t.test('normalizePluginSpec keeps npm package names intact', () => {
    assert.equal(normalizePluginSpec('@cerbur/clutch-dsh-worktree'), '@cerbur/clutch-dsh-worktree');
    assert.equal(normalizePluginSpec('dshmarket'), 'dshmarket');
  });

  await t.test('normalizePluginSpec handles file: and link: prefixes', () => {
    const prefixed = 'link:./packages/clutch-dsh-worktree';
    const normalized = normalizePluginSpec(prefixed);
    assert.ok(normalized.startsWith('link:'));
    assert.ok(path.isAbsolute(normalized.slice(5)));
  });
});
