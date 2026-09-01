import { accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(
  packageRoot,
  'node_modules/.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);
const outputDirectory = path.resolve(packageRoot, process.env.CLUTCH_DSH_DISCUSS_OUT_DIR ?? 'lib');

accessSync(tsc, constants.X_OK);
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
