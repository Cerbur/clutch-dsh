import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'node:test';
import test from 'node:test';

import { WorkspaceShardedSidecarRepository } from '../lib/index.js';
import { isWindowsPath, normalizeWindowsPath, sameWindowsPath } from '../lib/contract/windows-path.js';
import { sameLexicalPath } from '../lib/provider/path-identity.js';
import { createProcessLiveness } from '../lib/provider/sidecar/process-liveness.js';

test('persists a sidecar when Windows rejects fsync on a read-only file handle', async () => {
  const dshHome = await mkdtemp(path.join(os.tmpdir(), 'clutch-dsh-worktree-windows-'));
  const probePath = path.join(dshHome, 'probe');
  const probe = await open(probePath, 'w');
  const fileHandlePrototype = Object.getPrototypeOf(probe);
  await probe.close();
  // FileHandle does not expose its open flags; simulate the Windows fsync error at this boundary.
  const syncMock = mock.method(fileHandlePrototype, 'sync', async () => {
    throw Object.assign(new Error('simulated Windows read-only fsync'), { code: 'EPERM' });
  });

  try {
    const sidecar = new WorkspaceShardedSidecarRepository({ dshHome });
    const worktreePath = path.join(dshHome, 'clutch-dsh-worktree', 'worktree', 'wt_windows');

    await sidecar.upsertWorktree({
      workspaceId: 'ws_windows',
      worktreeId: 'wt_windows',
      absolutePath: worktreePath,
      branch: 'main',
      source: 'plugin',
      status: 'active',
    });

    const persisted = JSON.parse(await readFile(sidecar.getShardPath('ws_windows'), 'utf8'));
    assert.equal(persisted.worktrees[0].worktreeId, 'wt_windows');
  } finally {
    syncMock.mock.restore();
    await rm(dshHome, { recursive: true, force: true });
  }
});

test('shares Windows path identity rules between browser-safe and Node layers', () => {
  const extendedDrive = '\\\\?\\C:\\Repo\\Worktree';
  const ordinaryDrive = 'c:\\repo\\worktree';
  const extendedUnc = '\\\\?\\UNC\\SERVER\\Share\\Repo';
  const ordinaryUnc = '\\\\server\\share\\repo';

  assert.equal(isWindowsPath(extendedDrive), true);
  assert.equal(normalizeWindowsPath(extendedDrive), 'c:/repo/worktree');
  assert.equal(sameWindowsPath(extendedDrive, ordinaryDrive), true);
  assert.equal(sameWindowsPath(extendedUnc, ordinaryUnc), true);
  assert.equal(sameLexicalPath(extendedDrive, ordinaryDrive), true);
});

test('keeps Windows process probing behind an injectable liveness seam', async () => {
  let probedPid = 0;
  const liveness = createProcessLiveness({
    platform: 'win32',
    windowsIsAlive: async (pid) => {
      probedPid = pid;
      return false;
    },
  });

  assert.equal(await liveness.isAlive(1234), false);
  assert.equal(probedPid, 1234);
});
