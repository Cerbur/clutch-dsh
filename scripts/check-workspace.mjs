import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const requiredFiles = ['cordis.patch.yml', 'tsconfig.json', path.join('src', 'index.ts')];
const requiredScripts = ['build', 'lint', 'typecheck', 'test'];

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function packageRole(folderName) {
  if (folderName.startsWith('tool-')) {
    return { capability: folderName.slice('tool-'.length), role: 'consumer' };
  }
  if (folderName.endsWith('-local')) {
    return { capability: folderName.slice(0, -'-local'.length), role: 'provider' };
  }
  return { capability: folderName, role: 'service-definition' };
}

function expectedPackageName(folderName) {
  const { capability, role } = packageRole(folderName);
  if (role === 'consumer') return `dsh-tool-${capability}`;
  if (role === 'provider') return `dsh-${capability}-local`;
  return `dsh-${capability}`;
}

function report(errors, packageDirectory, message) {
  errors.push(`${packageDirectory}: ${message}`);
}

async function validatePackage(packageDirectory, folderName, errors) {
  const packageJsonPath = path.join(packageDirectory, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  } catch (error) {
    report(errors, packageDirectory, `cannot parse package.json (${error.message})`);
    return;
  }

  const expectedName = expectedPackageName(folderName);
  if (packageJson.name !== expectedName) {
    report(
      errors,
      packageDirectory,
      `package name must be ${expectedName}, got ${packageJson.name ?? '<missing>'}`,
    );
  }

  for (const scriptName of requiredScripts) {
    if (typeof packageJson.scripts?.[scriptName] !== 'string') {
      report(errors, packageDirectory, `missing script ${scriptName}`);
    }
  }

  for (const relativePath of requiredFiles) {
    if (!(await exists(path.join(packageDirectory, relativePath)))) {
      report(errors, packageDirectory, `missing ${relativePath}`);
    }
  }

  const { capability, role } = packageRole(folderName);
  if (role === 'provider' || role === 'consumer') {
    const serviceDefinitionName = `dsh-${capability}`;
    const dependencyValue = packageJson.dependencies?.[serviceDefinitionName];
    if (dependencyValue !== 'workspace:*') {
      report(
        errors,
        packageDirectory,
        `dependency ${serviceDefinitionName} must be workspace:*, got ${dependencyValue ?? '<missing>'}`,
      );
    }
  }
}

async function main() {
  const packagesDirectory = path.resolve(process.cwd(), 'packages');
  if (!(await exists(packagesDirectory))) {
    globalThis.console.log('workspace shape ok');
    return;
  }

  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const errors = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDirectory = path.join(packagesDirectory, entry.name);
    if (!(await exists(path.join(packageDirectory, 'package.json')))) continue;
    await validatePackage(packageDirectory, entry.name, errors);
  }

  if (errors.length > 0) {
    globalThis.console.log('workspace shape failed');
    for (const error of errors) globalThis.console.log(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  globalThis.console.log('workspace shape ok');
}

await main();
