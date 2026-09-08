import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { moveAppToTrash } from './trash-app.mjs';

test('moves an old application into a collision-safe Trash path', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clutch-trash-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const trash = join(root, 'Trash');
  const app = join(root, 'DeepSeek Harness.app');
  mkdirSync(app);
  writeFileSync(join(app, 'marker'), 'old');

  const destination = moveAppToTrash(app, trash);

  assert.equal(existsSync(app), false);
  assert.equal(existsSync(join(destination, 'marker')), true);
  assert.match(destination, /DeepSeek Harness .* [0-9a-f]{8}\.app$/u);
});
