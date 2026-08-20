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
    pluginRoot = null,
    packageName = folderName,
    plugin = 'clutch-dsh-worktree',
    role = 'plugin',
    serviceDefinition = 'clutch-dsh-worktree',
    dsh = true,
    bundlePatch = './cordis.patch.yml',
    patchContent = '[]\n',
    metadata = true,
  } = {},
) {
  const packageDirectory = path.join(
    root,
    'packages',
    ...(pluginRoot === null ? [folderName] : [pluginRoot, folderName]),
  );
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({
      name: packageName,
      ...(metadata ? { clutchDsh: { plugin, role, serviceDefinition } } : {}),
      ...(dsh ? { dsh: { bundle: { patch: bundlePatch } } } : {}),
    }),
  );
  if (patchContent !== null) {
    await writeFile(path.join(packageDirectory, 'cordis.patch.yml'), patchContent);
  }
}

test('allows planning-only directories without package metadata', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'packages', 'clutch-dsh-worktree'));

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /cordis patches ok/);
});

test('accepts a package whose manifest points to a YAML patch array', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree');

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /cordis patches ok/);
});

test('accepts a nested package whose manifest points to its YAML patch array', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree-contract', {
    pluginRoot: 'clutch-dsh-worktree',
    packageName: 'clutch-dsh-worktree-contract',
    role: 'service-definition',
    serviceDefinition: 'clutch-dsh-worktree-contract',
  });

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /cordis patches ok/);
});

test('rejects a package whose bundle manifest is missing', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree', { dsh: false });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /cordis\.patch\.yml/);
  assert.match(result.stdout, /dsh\.bundle\.patch is missing/);
});

test('rejects a bundle manifest without a patch path', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree', { bundlePatch: '' });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /dsh\.bundle\.patch is missing/);
});

test('rejects a package whose patch file is missing', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree', { patchContent: null });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /ENOENT/);
});

test('rejects a patch file whose YAML root is not an array', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createPackage(root, 'clutch-dsh-worktree', {
    patchContent: 'dsh:\n  bundle: clutch-dsh-worktree\n',
  });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /cordis\.patch\.yml must contain a YAML array/);
});
