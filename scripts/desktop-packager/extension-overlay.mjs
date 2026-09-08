import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error('extension overlay: upstream structure changed: ' + before.slice(0, 100));
  return source.replace(before, () => after);
}
export function patchManager(source) {
  source = replaceOnce(
    source,
    'const remaining = pluginRecords(projectDir).filter(plugin => plugin.name !== mutation.name)',
    'const remaining = pluginRecords(this.paths.profile).filter(plugin => plugin.name !== mutation.name)',
  );
  source = replaceOnce(
    source,
    'const requestedName = packageNameFromSpec(mutation.spec)',
    'const requestedName = mutation.clutchName ?? packageNameFromSpec(mutation.spec)',
  );
  source = replaceOnce(
    source,
    '...plugins.map(plugin => `${plugin.name}@${plugin.version}`),',
    '...plugins.map(plugin => `${plugin.name}@${previousSpecs[plugin.name] ?? plugin.version}`),',
  );
  source = replaceOnce(
    source,
    'const plugins = pluginRecords(this.paths.profile)',
    'const plugins = pluginRecords(this.paths.profile)\n          const previousSpecs = projectManifest(this.paths.profile).dependencies',
  );
  return source;
}
export function patchMain(source, helperPath) {
  source =
    'import { serialOperations, assertSender, prepareMutation, registerBridge } from ' +
    JSON.stringify(helperPath) +
    '\n' +
    source;
  source = replaceOnce(
    source,
    'import { DesktopProjectManager',
    'import { packageNameFromSpec, DesktopProjectManager',
  );
  // Core names come from the verified package-set descriptor; never allow overwrites.
  source = replaceOnce(
    source,
    'const manager = new DesktopProjectManager(paths, resources)',
    "const manager = new DesktopProjectManager(paths, resources)\n  const clutchOperations = serialOperations()\n  const clutchCoreNames = () => JSON.parse(readFileSync(join(paths.profile, 'desktop-packages.json'), 'utf8')).packages.map(p => p.name)",
  );
  source = replaceOnce(
    source,
    "assertDesktopSender(event, ['shell'])\n    if (development !== undefined) {",
    'assertSender(event)\n    if (development !== undefined) {',
  );
  source = replaceOnce(
    source,
    'await manager.mutate(mutation, hooks)',
    'await clutchOperations.run(async () => {\n      const prepared = await prepareMutation(mutation, manager, clutchCoreNames(), packageNameFromSpec)\n      await manager.mutate(prepared, hooks)\n    })',
  );
  source = replaceOnce(
    source,
    'ipcMain.handle(DESKTOP_IPC.localeGet,',
    `registerBridge({
    ipcMain, dialog, manager, mutate, coreNames: clutchCoreNames,
    restart: () => clutchOperations.run(async () => {
      if (development !== undefined) throw new Error('extension: packaged Desktop required')
      await hooks.beforeActivate()
      await hooks.afterActivate()
      if (mainWindow !== undefined && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
    }),
  })
  ipcMain.handle(DESKTOP_IPC.localeGet,`,
  );
  return source;
}
export const preloadSource = `(() => {
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('clutchExtension', {
  version: 1,
  list: () => ipcRenderer.invoke('clutch-extension:list'),
  install: spec => ipcRenderer.invoke('clutch-extension:install', spec),
  remove: name => ipcRenderer.invoke('clutch-extension:remove', name),
  chooseLocal: kind => ipcRenderer.invoke('clutch-extension:choose', kind),
  restart: () => ipcRenderer.invoke('clutch-extension:restart'),
});
})();
`;
export function rewriteImports(source, original, overrides = {}) {
  return source.replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, specifier) => {
    const path = resolve(dirname(original), specifier);
    return 'from ' + quote + (overrides[path] ?? path) + quote;
  });
}
export async function buildDesktopOverlay(repo, output) {
  const desktop = join(repo, 'apps/desktop');
  const require = createRequire(join(desktop, 'package.json'));
  const { build } = await import(pathToFileURL(require.resolve('tsdown')).href);
  const temporary = mkdtempSync(join(tmpdir(), 'clutch-desktop-overlay-'));
  try {
    const managerPath = join(desktop, 'src/project-manager.ts');
    const mainPath = join(desktop, 'src/main.ts');
    const manager = join(temporary, 'project-manager.ts');
    const main = join(temporary, 'main.ts');
    writeFileSync(
      manager,
      rewriteImports(patchManager(readFileSync(managerPath, 'utf8')), managerPath),
    );
    let mainSource = patchMain(readFileSync(mainPath, 'utf8'), join(here, 'extension-runtime.mjs'));
    // Keep upstream imports intact and add aliases isolated from upstream names.
    mainSource =
      "import { readFileSync as clutchReadFile } from 'node:fs'\nimport { join as clutchJoin } from 'node:path'\n" +
      mainSource.replace(
        "JSON.parse(readFileSync(join(paths.profile, 'desktop-packages.json'), 'utf8'))",
        "JSON.parse(clutchReadFile(clutchJoin(paths.profile, 'desktop-packages.json'), 'utf8'))",
      );
    writeFileSync(main, rewriteImports(mainSource, mainPath, { [managerPath]: manager }));
    mkdirSync(output, { recursive: true });
    await build({
      cwd: desktop,
      config: false,
      entry: { main },
      outDir: output,
      format: 'esm',
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      clean: false,
      dts: false,
      logLevel: 'silent',
      deps: { neverBundle: ['electron', 'electron-updater', 'semver'] },
      alias: { tar: require.resolve('tar') },
    });
    // Only the Electron-owned management window gets the additional bridge.
    writeFileSync(
      join(output, 'preload.cjs'),
      readFileSync(join(desktop, 'lib/preload.cjs'), 'utf8') + '\n' + preloadSource,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
