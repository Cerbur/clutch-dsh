import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'check-workspace.mjs');

function runCheck(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'clutch-dsh-workspace-'));
  await mkdir(path.join(root, 'packages'), { recursive: true });
  return root;
}

test('allows planning-only directories without package metadata', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'packages', 'clutch-dsh-worktree'));

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /workspace shape ok/);
});

test('reports the path and missing files for an invalid package', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageDirectory = path.join(root, 'packages', 'file-cap');
  await mkdir(packageDirectory);
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({ name: 'dsh-file-cap', scripts: {} }),
  );

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /packages\/file-cap/);
  assert.match(result.stdout, /cordis\.patch\.yml/);
});
