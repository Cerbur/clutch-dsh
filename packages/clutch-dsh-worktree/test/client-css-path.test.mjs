import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveClientCssPath } from '../scripts/client-css-path.mjs';

test('CSS source resolution follows the emitted importer depth', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worktree-css-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [importer, source, expected] of [
    ['lib/client/WorktreeSurface.js', './worktree.css', 'src/client/worktree.css'],
    ['lib/client/surface/rows.js', '../worktree.css', 'src/client/worktree.css'],
    ['lib/client/surface/components/row.js', '../../worktree.css', 'src/client/worktree.css'],
    ['lib/client/surface/row.js', './row.css', 'src/client/surface/row.css'],
  ]) {
    assert.equal(
      resolveClientCssPath(directory, source, path.join(directory, importer)),
      path.join(directory, expected),
    );
  }
  const emitted = path.join(directory, 'lib/client/worktree.css');
  await mkdir(path.dirname(emitted), { recursive: true });
  await writeFile(emitted, '.surface {}');
  assert.equal(
    resolveClientCssPath(
      directory,
      '../worktree.css',
      path.join(directory, 'lib/client/surface/rows.js'),
    ),
    emitted,
  );
});
