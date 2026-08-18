import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'validate-cordis-patches.mjs');

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
  const root = await mkdtemp(path.join(tmpdir(), 'clutch-dsh-patches-'));
  await mkdir(path.join(root, 'packages'), { recursive: true });
  return root;
}

async function createPackage(
  root,
  folderName,
  {
    packageName = folderName,
    plugin = 'clutch-dsh-worktree',
    role = 'provider',
    serviceDefinition = 'clutch-dsh-worktree-manager',
    bundle,
    metadata = true,
  } = {},
) {
  const packageDirectory = path.join(root, 'packages', folderName);
  await mkdir(packageDirectory);
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({
      name: packageName,
      ...(metadata ? { clutchDsh: { plugin, role, serviceDefinition } } : {}),
    }),
  );
  await writeFile(path.join(packageDirectory, 'cordis.patch.yml'), `dsh:\n  bundle: ${bundle}\n`);
}

test('allows planning-only directories without package metadata', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'packages', 'clutch-dsh-worktree'));

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /cordis patches ok/);
});

test('rejects a package whose bundle does not match its service definition', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree-git', {
    bundle: 'clutch-dsh-other-manager',
  });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /cordis\.patch\.yml/);
  assert.match(result.stdout, /clutch-dsh-worktree-manager/);
});

test('accepts a package whose bundle matches its declared service definition', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree-git', {
    bundle: 'clutch-dsh-worktree-manager',
  });

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /cordis patches ok/);
});

test('rejects a package without a declared service definition', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree-git', {
    bundle: 'clutch-dsh-worktree-manager',
    metadata: false,
  });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /clutchDsh\.serviceDefinition is missing/);
});
