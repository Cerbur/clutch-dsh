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

export function expectedBundle(folderName) {
  if (folderName.startsWith('tool-')) return `dsh-${folderName.slice(5)}`;
  if (folderName.endsWith('-local')) return `dsh-${folderName.slice(0, -6)}`;
  return `dsh-${folderName}`;
}

export async function validatePatch(packageDirectory) {
  const packageJsonPath = path.join(packageDirectory, 'package.json');
  const patchPath = path.join(packageDirectory, 'cordis.patch.yml');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const patch = parseYaml(await readFile(patchPath, 'utf8'));
  const bundleReference = patch?.dsh?.bundle;

  if (typeof bundleReference !== 'string' || bundleReference.length === 0) {
    throw new Error('dsh.bundle is missing');
  }

  const folderName = path.basename(packageDirectory);
  const expected = expectedBundle(folderName);
  if (bundleReference !== expected) {
    throw new Error(`dsh.bundle must be ${expected}, got ${bundleReference}`);
  }

  return { packageName: packageJson.name, bundleReference };
}

async function main() {
  const packagesDirectory = path.resolve(process.cwd(), 'packages');
  if (!(await exists(packagesDirectory))) {
    globalThis.console.log('cordis patches ok');
    return;
  }

  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const errors = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDirectory = path.join(packagesDirectory, entry.name);
    if (!(await exists(path.join(packageDirectory, 'package.json')))) continue;
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
