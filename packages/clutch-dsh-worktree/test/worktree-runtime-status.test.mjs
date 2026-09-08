import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readWorktreeStatus } from '../lib/provider/git/worktree-status.js';

test('runtime status keeps Git availability separate from lifecycle and locks', async () => {
  const absolutePath = await mkdtemp(path.join(os.tmpdir(), 'worktree-status-'));
  const facts = { absolutePath, branch: 'topic' };
  try {
    assert.equal(await readWorktreeStatus(undefined), 'missing');
    assert.equal(await readWorktreeStatus(facts), 'missing');
    await writeFile(path.join(absolutePath, '.git'), 'gitdir: fixture');
    assert.equal(await readWorktreeStatus(facts), 'ready');
    assert.equal(await readWorktreeStatus({ ...facts, locked: true }), 'ready');
    assert.equal(await readWorktreeStatus({ ...facts, detached: true }), 'detached');
    assert.equal(await readWorktreeStatus({ absolutePath }), 'detached');
    assert.equal(await readWorktreeStatus({ ...facts, bare: true }), 'bare');
    assert.equal(await readWorktreeStatus({ ...facts, prunable: true, locked: true }), 'prunable');
    await rm(path.join(absolutePath, '.git'));
    assert.equal(await readWorktreeStatus({ ...facts, detached: true }), 'missing');
    await mkdir(path.join(absolutePath, 'file-parent'));
    await writeFile(path.join(absolutePath, 'file-parent', 'file'), '');
    assert.equal(
      await readWorktreeStatus({
        absolutePath: path.join(absolutePath, 'file-parent', 'file', 'child'),
        branch: 'topic',
      }),
      'unavailable',
    );
  } finally {
    await rm(absolutePath, { recursive: true, force: true });
  }
});
