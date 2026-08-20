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

async function writeRunnablePackage(
  root,
  packageParts,
  folderName,
  {
    name = folderName,
    metadata = {
      plugin: 'clutch-dsh-worktree',
      role: 'service-definition',
      serviceDefinition: folderName,
    },
    dependencies = {},
  } = {},
) {
  const packageDirectory = path.join(root, 'packages', ...packageParts);
  await mkdir(path.join(packageDirectory, 'src'), { recursive: true });
  const packageJson = {
    name,
    scripts: {
      build: 'node build.mjs',
      lint: 'node lint.mjs',
      typecheck: 'node typecheck.mjs',
      test: 'node test.mjs',
    },
    dependencies,
  };
  if (metadata !== null) packageJson.clutchDsh = metadata;
  await writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify(packageJson));
  await writeFile(path.join(packageDirectory, 'cordis.patch.yml'), 'dsh:\n  bundle: example\n');
  await writeFile(path.join(packageDirectory, 'tsconfig.json'), '{}');
  await writeFile(path.join(packageDirectory, 'src', 'index.ts'), 'export {};\n');
}

async function createRunnablePackage(root, folderName, options = {}) {
  return writeRunnablePackage(root, [folderName], folderName, options);
}

async function createNestedRunnablePackage(root, pluginName, folderName, options = {}) {
  return writeRunnablePackage(root, [pluginName, folderName], folderName, options);
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
    JSON.stringify({ name: 'file-cap', scripts: {} }),
  );

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /packages\/file-cap/);
  assert.match(result.stdout, /cordis\.patch\.yml/);
});

test('accepts plugin-prefixed packages with arbitrary module names and exact service dependencies', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const serviceDefinition = 'clutch-dsh-worktree-manager';
  await createRunnablePackage(root, serviceDefinition);
  await createRunnablePackage(root, 'clutch-dsh-worktree-git', {
    metadata: {
      plugin: 'clutch-dsh-worktree',
      role: 'provider',
      serviceDefinition,
    },
    dependencies: { [serviceDefinition]: 'workspace:*' },
  });
  await createRunnablePackage(root, 'clutch-dsh-worktree-ui', {
    metadata: {
      plugin: 'clutch-dsh-worktree',
      role: 'consumer',
      serviceDefinition,
    },
    dependencies: { [serviceDefinition]: 'workspace:*' },
  });

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /workspace shape ok/);
});

test('accepts runnable module packages nested under a plugin root', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const serviceDefinition = 'clutch-dsh-worktree-manager';
  await createNestedRunnablePackage(root, 'clutch-dsh-worktree', serviceDefinition);
  await createNestedRunnablePackage(root, 'clutch-dsh-worktree', 'clutch-dsh-worktree-local', {
    metadata: {
      plugin: 'clutch-dsh-worktree',
      role: 'provider',
      serviceDefinition,
    },
    dependencies: { [serviceDefinition]: 'workspace:*' },
  });

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /workspace shape ok/);
});

test('accepts one plugin package that owns all capability roles internally', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createRunnablePackage(root, 'clutch-dsh-worktree', {
    metadata: {
      plugin: 'clutch-dsh-worktree',
      role: 'plugin',
      serviceDefinition: 'clutch-dsh-worktree',
    },
  });

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /workspace shape ok/);
});

test('accepts scoped atomic plugin package names', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createRunnablePackage(root, 'clutch-dsh-worktree', {
    name: '@cerbur/clutch-dsh-worktree',
    metadata: {
      plugin: '@cerbur/clutch-dsh-worktree',
      role: 'plugin',
      serviceDefinition: '@cerbur/clutch-dsh-worktree',
    },
  });

  const result = await runCheck(root);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /workspace shape ok/);
});

test('requires the package name to match its directory name', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createRunnablePackage(root, 'clutch-dsh-worktree-git', {
    name: 'clutch-dsh-worktree-other',
  });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /package name must match directory name/);
});

test('requires the package name to use the declared plugin prefix', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createRunnablePackage(root, 'other-plugin-git', {
    metadata: {
      plugin: 'clutch-dsh-worktree',
      role: 'service-definition',
      serviceDefinition: 'other-plugin-git',
    },
  });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /must use plugin scope\/prefix/);
});

test('requires valid clutchDsh metadata and role', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createRunnablePackage(root, 'clutch-dsh-worktree-missing', { metadata: null });
  await createRunnablePackage(root, 'clutch-dsh-worktree-utility', {
    metadata: {
      plugin: 'clutch-dsh-worktree',
      role: 'utility',
      serviceDefinition: 'clutch-dsh-worktree-utility',
    },
  });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /clutchDsh metadata must be an object/);
  assert.match(
    result.stdout,
    /clutchDsh.role must be plugin, service-definition, provider, or consumer/,
  );
});

test('requires providers and consumers to use an exact workspace dependency', async (t) => {
  const root = await createFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await createRunnablePackage(root, 'clutch-dsh-worktree-git', {
    metadata: {
      plugin: 'clutch-dsh-worktree',
      role: 'provider',
      serviceDefinition: 'clutch-dsh-worktree-manager',
    },
    dependencies: { 'clutch-dsh-worktree-manager': 'workspace:^' },
  });

  const result = await runCheck(root);

  assert.equal(result.code, 1);
  assert.match(result.stdout, /dependency clutch-dsh-worktree-manager must be workspace:\*/);
});
