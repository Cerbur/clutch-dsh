import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(path.join(packageRoot, '.test-'));
const outputDirectory = path.join(tempRoot, 'lib');
const buildScript = path.join(packageRoot, 'scripts/build.mjs');
const testDirectory = path.join(packageRoot, 'test');

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: packageRoot, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

try {
  const buildStatus = run(process.execPath, [buildScript], {
    ...process.env,
    CLUTCH_DSH_DISCUSS_OUT_DIR: outputDirectory,
  });
  if (buildStatus !== 0) {
    throw new Error(`isolated package build exited with status ${buildStatus}`);
  }

  await cp(path.join(packageRoot, 'skills'), path.join(tempRoot, 'skills'), { recursive: true });
  const tests = (await readdir(testDirectory))
    .filter((entry) => entry.endsWith('.test.mjs'))
    .sort()
    .map((entry) => path.join(testDirectory, entry));
  const testStatus = run(process.execPath, ['--test', ...tests], {
    ...process.env,
    CLUTCH_DSH_DISCUSS_TEST_LIB: outputDirectory,
  });
  if (testStatus !== 0) throw new Error(`package tests exited with status ${testStatus}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
