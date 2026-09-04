import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function resolveTsc() {
  const binaryName = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
  const candidates = [
    path.join(packageRoot, 'node_modules/.bin', binaryName),
    path.join(packageRoot, '../../node_modules/.bin', binaryName),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue search
    }
  }
  return binaryName;
}

const tsc = resolveTsc();
const outputDirectory = path.resolve(packageRoot, process.env.CLUTCH_DSH_DISCUSS_OUT_DIR ?? 'lib');
const result = spawnSync(
  tsc,
  ['-p', path.join(packageRoot, 'tsconfig.json'), '--outDir', outputDirectory],
  {
    cwd: packageRoot,
    stdio: 'inherit',
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
