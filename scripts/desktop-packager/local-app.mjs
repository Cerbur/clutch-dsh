import { spawnSync } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, URL } from 'node:url';
import { patchEditMenu } from './patch-edit-menu.mjs';
import { buildDesktopOverlay } from './extension-overlay.mjs';

const [mode, input] = process.argv.slice(2);
if (!input || !['electron', 'seed', 'assemble'].includes(mode))
  throw new Error('Usage: local-app.mjs electron|seed|assemble <dsh-repo>');
const repo = resolve(input);
const desktop = join(repo, 'apps/desktop');
const require = createRequire(join(desktop, 'package.json'));
const ts = require('typescript');
const target = join(desktop, '.desktop-build/targets/mac-arm64');

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, { cwd: repo, stdio: 'inherit', env: environment });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.status ?? result.signal}`);
}

if (mode === 'electron') {
  const electronRoot = dirname(require.resolve('electron/package.json'));
  const environment = { ...process.env };
  delete environment.ELECTRON_SKIP_BINARY_DOWNLOAD;
  run(process.execPath, [join(electronRoot, 'install.js')], environment);
  if (!existsSync(join(electronRoot, 'dist/Electron.app'))) {
    throw new Error('local app: Electron installer did not produce dist/Electron.app');
  }
} else if (mode === 'seed') {
  // The local seed retains upstream offline installation and integrity checks.
  // Only release-certificate signing is omitted in this temporary compiled copy.
  const original = join(desktop, 'scripts/prepare-seed.ts');
  let source = readFileSync(original, 'utf8');
  const guard = "if (targetPlatform === 'darwin') {";
  if (source.split(guard).length !== 2)
    throw new Error('local seed: upstream signing guard changed');
  source = source.replace(guard, 'if (false) {');
  source = source.replaceAll('import.meta.dirname', JSON.stringify(dirname(original)));
  source = source.replace(
    /from (['"])(\.[^'"]+)\1/g,
    (_, quote, specifier) =>
      `from ${quote}${pathToFileURL(resolve(dirname(original), specifier)).href}${quote}`,
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-local-seed-'));
  try {
    const entry = join(temporary, 'prepare.mjs');
    writeFileSync(entry, output);
    run(process.execPath, ['--import', require.resolve('tsx/esm'), entry]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
} else {
  const artifacts = join(target, 'local-artifacts');
  mkdirSync(artifacts, { recursive: true });
  const staging = mkdtempSync(join(artifacts, 'build-'));
  const app = join(staging, 'DeepSeek Harness.app');
  const resources = join(app, 'Contents/Resources');
  const shell = join(resources, 'app');
  try {
    const electron = join(dirname(require.resolve('electron/package.json')), 'dist/Electron.app');
    run('/usr/bin/ditto', [electron, app]);
    rmSync(join(resources, 'default_app.asar'), { force: true });
    mkdirSync(shell, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
    writeFileSync(join(shell, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    mkdirSync(join(shell, 'lib'));
    for (const file of readdirSync(join(desktop, 'lib'))) {
      if (/\.(?:js|cjs)$/.test(file)) cpSync(join(desktop, 'lib', file), join(shell, 'lib', file));
    }
    cpSync(join(desktop, 'renderer'), join(shell, 'renderer'), { recursive: true });
    for (const file of ['plugin-manager.html', 'plugin-manager.js', 'plugin-manager.css']) {
      cpSync(new URL('./renderer/' + file, import.meta.url), join(shell, 'renderer', file));
    }
    await buildDesktopOverlay(repo, join(shell, 'lib'));
    for (const resource of ['runtime', 'seed']) {
      cpSync(join(target, resource), join(resources, resource), { recursive: true });
    }
    const copyDependency = (name, from, destination, ancestors = new Map()) => {
      const resolver = createRequire(join(from, 'package.json'));
      const path = resolver.resolve(`${name}/package.json`);
      if (ancestors.get(name) === path) return;
      const source = dirname(path);
      const output = join(destination, 'node_modules', name);
      mkdirSync(dirname(output), { recursive: true });
      cpSync(source, output, {
        recursive: true,
        filter: (file) => file !== join(source, 'node_modules'),
      });
      const next = new Map(ancestors).set(name, path);
      for (const dependency of Object.keys(
        JSON.parse(readFileSync(path, 'utf8')).dependencies ?? {},
      )) {
        copyDependency(dependency, source, output, next);
      }
    };
    for (const name of Object.keys(manifest.dependencies)) copyDependency(name, desktop, shell);
    const updater = createRequire(join(shell, 'node_modules/electron-updater/out/main.js'));
    updater.resolve('fs-extra');
    const main = join(shell, 'lib/main.js');
    const patched = patchEditMenu(readFileSync(main, 'utf8'), ts);
    if (patchEditMenu(patched, ts) !== patched) throw new Error('edit menu patch not idempotent');
    writeFileSync(main, patched);
    console.log('Verified packaged dependencies and one top-level editMenu');
    run(process.execPath, ['--check', main]);
    const plist = join(app, 'Contents/Info.plist');
    const appId = process.env.DSH_DESKTOP_APP_ID || 'com.clutch.dsh';
    for (const [key, value] of Object.entries({
      CFBundleIdentifier: appId,
      CFBundleName: 'DeepSeek Harness',
      CFBundleDisplayName: 'DeepSeek Harness',
      CFBundleExecutable: 'DeepSeek Harness',
      CFBundleShortVersionString: manifest.version,
      CFBundleVersion: manifest.version,
    })) {
      run('/usr/bin/plutil', ['-replace', key, '-string', value, plist]);
    }
    renameSync(join(app, 'Contents/MacOS/Electron'), join(app, 'Contents/MacOS/DeepSeek Harness'));
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    const parent = resolve(process.env.DSH_INSTALL_DIR || '/Applications');
    mkdirSync(parent, { recursive: true });
    const installed = join(parent, 'DeepSeek Harness.app');
    const backup = `${installed}.previous`;
    if (existsSync(backup))
      throw new Error(`Previous backup exists; move it before installing: ${backup}`);
    const incoming = mkdtempSync(join(parent, '.dsh-install-'));
    try {
      const candidate = join(incoming, 'DeepSeek Harness.app');
      run('/usr/bin/ditto', [app, candidate]);
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate]);
      if (existsSync(installed)) renameSync(installed, backup);
      try {
        renameSync(candidate, installed);
      } catch (error) {
        if (existsSync(backup)) renameSync(backup, installed);
        throw error;
      }
    } finally {
      rmSync(incoming, { recursive: true, force: true });
    }
    console.log(`Installed: ${installed}\nExisting app, if any, preserved at: ${backup}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
