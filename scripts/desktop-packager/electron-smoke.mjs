// Opt-in integration check. Uses real Electron/Host and an isolated DSH_HOME.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildDesktopOverlay } from './extension-overlay.mjs';
import { patchEditMenu } from './patch-edit-menu.mjs';

const repo = resolve(process.env.DSH_REPO_ROOT || '.');
const desktop = join(repo, 'apps/desktop');
const target = join(desktop, '.desktop-build/targets/mac-arm64');
const require = createRequire(join(desktop, 'package.json'));
const here = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'clutch-electron-smoke-'));
const shell = join(root, 'app');
mkdirSync(shell);
const report = join(root, 'report.json');
const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
try {
  const lib = join(shell, 'lib');
  await buildDesktopOverlay(repo, lib);
  writeFileSync(
    join(lib, 'main.js'),
    patchEditMenu(readFileSync(join(lib, 'main.js'), 'utf8'), require('typescript')),
  );
  cpSync(join(desktop, 'lib/preload-app.cjs'), join(lib, 'preload-app.cjs'));
  cpSync(join(desktop, 'lib/preload.cjs'), join(lib, 'preload.cjs'));
  cpSync(join(desktop, 'renderer'), join(shell, 'renderer'), { recursive: true });
  cpSync(join(here, 'renderer'), join(shell, 'renderer/clutch-extension'), { recursive: true });
  cpSync(join(here, 'electron-smoke-main.mjs'), join(shell, 'smoke.mjs'));
  writeFileSync(
    join(shell, 'package.json'),
    JSON.stringify({ ...manifest, name: 'clutch-desktop-smoke', main: 'smoke.mjs' }),
  );
  symlinkSync(join(desktop, 'node_modules'), join(shell, 'node_modules'), 'dir');
  const local = join(root, 'local plugin');
  mkdirSync(local);
  writeFileSync(
    join(local, 'package.json'),
    JSON.stringify({
      name: '@clutch-test/smoke',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
      files: ['index.js', 'cordis.patch.yml'],
      dsh: { bundle: { patch: './cordis.patch.yml' } },
    }),
  );
  writeFileSync(join(local, 'index.js'), 'export function apply() {}\n');
  writeFileSync(
    join(local, 'cordis.patch.yml'),
    "- insert:\n    - id: clutch-smoke\n      name: '@clutch-test/smoke'\n",
  );
  const electron = join(
    dirname(require.resolve('electron/package.json')),
    'dist/Electron.app/Contents/MacOS/Electron',
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith('DSH_DESKTOP_') && !['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS'].includes(key),
    ),
  );
  const child = spawn(electron, [shell], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...env,
      DSH_HOME: join(root, 'dsh-home'),
      CLUTCH_SMOKE_ROOT: root,
      DSH_DESKTOP_NODE_BINARY: join(target, 'runtime/node/node'),
      DSH_DESKTOP_PNPM_ENTRY: join(target, 'runtime/pnpm/bin/pnpm.mjs'),
      DSH_DESKTOP_SEED_DIR: join(target, 'seed'),
      DSH_DESKTOP_DIAGNOSTIC_FILE: join(root, 'startup-error.txt'),
    },
  });
  let diagnostics = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      diagnostics = (diagnostics + chunk).slice(-16000);
    });
  const code = await new Promise((settle, reject) => {
    child.once('error', reject);
    child.once('close', settle);
  });
  if (existsSync(report)) process.stdout.write(readFileSync(report, 'utf8'));
  if (code !== 0) throw new Error('Electron smoke failed: ' + diagnostics);
  if (!existsSync(report)) throw new Error('Electron smoke exited without a report');
} finally {
  if (process.env.CLUTCH_KEEP_SMOKE === '1')
    process.stdout.write('Smoke artifacts: ' + root + '\n');
  else rmSync(root, { recursive: true, force: true });
}
