import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function isInsidePackage(packageDirectory, targetPath) {
  const relativePath = path.relative(packageDirectory, targetPath);
  return (
    relativePath !== '' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== '..' &&
    !path.isAbsolute(relativePath)
  );
}

export function bundlePatchReference(packageJson) {
  return packageJson?.dsh?.bundle?.patch;
}

export async function validatePatch(packageDirectory) {
  const packageJsonPath = path.join(packageDirectory, 'package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const patchReference = bundlePatchReference(packageJson);

  if (typeof patchReference !== 'string' || patchReference.length === 0) {
    throw new Error('dsh.bundle.patch is missing');
  }
  if (path.isAbsolute(patchReference)) {
    throw new Error('dsh.bundle.patch must be a relative package path');
  }

  const patchPath = path.resolve(packageDirectory, patchReference);
  if (!isInsidePackage(packageDirectory, patchPath)) {
    throw new Error('dsh.bundle.patch must point inside the package');
  }

  let patch;
  try {
    patch = parseYaml(await readFile(patchPath, 'utf8'));
  } catch (error) {
    throw new Error(`unable to read or parse ${path.basename(patchPath)}: ${error.message}`, {
      cause: error,
    });
  }
  if (!Array.isArray(patch)) {
    throw new Error('cordis.patch.yml must contain a YAML array');
  }

  return { packageName: packageJson.name, patchPath: patchReference };
}

async function findPackageDirectories(packagesDirectory) {
  const packageDirectories = [];
  const pluginEntries = await readdir(packagesDirectory, { withFileTypes: true });

  for (const pluginEntry of pluginEntries) {
    if (!pluginEntry.isDirectory()) continue;

    const pluginDirectory = path.join(packagesDirectory, pluginEntry.name);
    if (await exists(path.join(pluginDirectory, 'package.json'))) {
      packageDirectories.push(pluginDirectory);
    }

    const moduleEntries = await readdir(pluginDirectory, { withFileTypes: true });
    for (const moduleEntry of moduleEntries) {
      if (!moduleEntry.isDirectory()) continue;

      const packageDirectory = path.join(pluginDirectory, moduleEntry.name);
      if (await exists(path.join(packageDirectory, 'package.json'))) {
        packageDirectories.push(packageDirectory);
      }
    }
  }

  return packageDirectories;
}

async function main() {
  const packagesDirectory = path.resolve(process.cwd(), 'packages');
  if (!(await exists(packagesDirectory))) {
    globalThis.console.log('cordis patches ok');
    return;
  }

  const errors = [];
  for (const packageDirectory of await findPackageDirectories(packagesDirectory)) {
    try {
      await validatePatch(packageDirectory);
    } catch (error) {
      errors.push(`${path.join(packageDirectory, 'cordis.patch.yml')}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    globalThis.console.log('cordis patches failed');
    for (const error of errors) globalThis.console.log(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  globalThis.console.log('cordis patches ok');
}

await main();
