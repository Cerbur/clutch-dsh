import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const requiredFiles = ['cordis.patch.yml', 'tsconfig.json', path.join('src', 'index.ts')];
const requiredScripts = ['build', 'lint', 'typecheck', 'test'];
const validRoles = new Set(['plugin', 'service-definition', 'provider', 'consumer']);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function report(errors, packageDirectory, message) {
  errors.push(`${packageDirectory}: ${message}`);
}

function packageParts(name) {
  const separator = name.startsWith('@') ? name.indexOf('/') : -1;
  return separator > 0
    ? { scope: name.slice(0, separator), name: name.slice(separator + 1) }
    : { scope: '', name };
}

function packageMatchesDirectory(packageName, folderName) {
  return packageParts(packageName).name === folderName;
}

function packageBelongsToPlugin(packageName, pluginName) {
  const packageIdentity = packageParts(packageName);
  const pluginIdentity = packageParts(pluginName);
  return (
    packageIdentity.scope === pluginIdentity.scope &&
    (packageIdentity.name === pluginIdentity.name ||
      packageIdentity.name.startsWith(`${pluginIdentity.name}-`))
  );
}

async function findPackageDirectories(packagesDirectory) {
  const packageDirectories = [];
  const pluginEntries = await readdir(packagesDirectory, { withFileTypes: true });

  for (const pluginEntry of pluginEntries) {
    if (!pluginEntry.isDirectory()) continue;

    const pluginDirectory = path.join(packagesDirectory, pluginEntry.name);
    if (await exists(path.join(pluginDirectory, 'package.json'))) {
      packageDirectories.push({
        packageDirectory: pluginDirectory,
        folderName: pluginEntry.name,
      });
    }

    const moduleEntries = await readdir(pluginDirectory, { withFileTypes: true });
    for (const moduleEntry of moduleEntries) {
      if (!moduleEntry.isDirectory()) continue;

      const packageDirectory = path.join(pluginDirectory, moduleEntry.name);
      if (!(await exists(path.join(packageDirectory, 'package.json')))) continue;
      packageDirectories.push({
        packageDirectory,
        folderName: moduleEntry.name,
      });
    }
  }

  return packageDirectories;
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

  if (
    typeof packageJson.name !== 'string' ||
    !packageMatchesDirectory(packageJson.name, folderName)
  ) {
    report(
      errors,
      packageDirectory,
      `package name must match directory name ${folderName} (a scope is allowed), got ${
        packageJson.name ?? '<missing>'
      }`,
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

  const metadata = packageJson.clutchDsh;
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    report(errors, packageDirectory, 'clutchDsh metadata must be an object');
    return;
  }

  const { plugin, role, serviceDefinition } = metadata;
  if (typeof plugin !== 'string' || plugin.length === 0) {
    report(errors, packageDirectory, 'clutchDsh.plugin must be a non-empty string');
  } else if (
    typeof packageJson.name === 'string' &&
    !packageBelongsToPlugin(packageJson.name, plugin)
  ) {
    report(
      errors,
      packageDirectory,
      `package name must use plugin scope/prefix ${plugin} or equal plugin ${plugin}, got ${packageJson.name}`,
    );
  }

  if (!validRoles.has(role)) {
    report(
      errors,
      packageDirectory,
      `clutchDsh.role must be plugin, service-definition, provider, or consumer, got ${role ?? '<missing>'}`,
    );
  }

  if (typeof serviceDefinition !== 'string' || serviceDefinition.length === 0) {
    report(errors, packageDirectory, 'clutchDsh.serviceDefinition must be a non-empty string');
    return;
  }

  if (
    (role === 'plugin' || role === 'service-definition') &&
    serviceDefinition !== packageJson.name
  ) {
    report(
      errors,
      packageDirectory,
      `${role} serviceDefinition must be ${packageJson.name ?? '<missing>'}, got ${serviceDefinition}`,
    );
  }

  if (role === 'provider' || role === 'consumer') {
    const dependencyValue = packageJson.dependencies?.[serviceDefinition];
    if (dependencyValue !== 'workspace:*') {
      report(
        errors,
        packageDirectory,
        `dependency ${serviceDefinition} must be workspace:*, got ${dependencyValue ?? '<missing>'}`,
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

  const errors = [];
  for (const { packageDirectory, folderName } of await findPackageDirectories(packagesDirectory)) {
    await validatePackage(packageDirectory, folderName, errors);
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
