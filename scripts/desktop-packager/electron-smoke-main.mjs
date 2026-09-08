// Runs only inside the temporary Electron application created by electron-smoke.mjs.
import { app, BrowserWindow, Menu, dialog } from 'electron';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout, clearTimeout } from 'node:timers';
const root = process.env.CLUTCH_SMOKE_ROOT;
if (!root) throw new Error('Use electron-smoke.mjs');
app.setPath('userData', join(root, 'electron-data'));
const children = [];
const originalSpawn = childProcess.spawn;
childProcess.spawn = (...args) => {
  const child = originalSpawn(...args);
  children.push({
    child,
    host: args[1]?.some((value) => String(value).includes('dsh-desktop-host')),
  });
  return child;
};
syncBuiltinESMExports();
const errors = [];
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, path, error) => errors.push(path + ': ' + error.message));
});
let finished = false;
async function finish(error, result) {
  if (finished) return;
  finished = true;
  clearTimeout(deadline);
  writeFileSync(
    join(root, 'report.json'),
    JSON.stringify(
      error
        ? { ok: false, error: String(error.stack ?? error), preloadErrors: errors }
        : { ok: true, ...result, preloadErrors: errors },
      null,
      2,
    ) + '\n',
  );
  for (const { child } of children)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await delay(1500);
  for (const { child } of children)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  app.exit(error ? 1 : 0);
}
const deadline = setTimeout(() => {
  void finish(new Error('Electron smoke timed out'));
}, 180000);
dialog.showErrorBox = (title, message) => {
  void finish(new Error(title + ': ' + message));
};
async function until(read, label) {
  for (let attempt = 0; attempt < 1200; attempt++) {
    const value = read();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Timed out waiting for ' + label);
}
const activeHost = () =>
  children.filter(
    (item) => item.host && item.child.exitCode === null && item.child.signalCode === null,
  );
await import('./lib/main.js');
// Electron waits for the ESM entry to settle before emitting ready.
void app.whenReady().then(async () => {
  try {
    const primary = await until(
      () =>
        BrowserWindow.getAllWindows().find(
          (window) => window.webContents.getURL() === 'dsh-app://app/index.html',
        ),
      'main window',
    );
    await until(() => !primary.webContents.isLoading(), 'main load');
    assert.equal(
      await primary.webContents.executeJavaScript('typeof window.clutchExtension'),
      'undefined',
    );
    const item = Menu.getApplicationMenu()
      .items.flatMap((item) => item.submenu?.items ?? [])
      .find((item) => item.accelerator === 'CmdOrCtrl+,');
    assert.ok(item?.enabled);
    item.click();
    const nativeWindow = await until(
      () =>
        BrowserWindow.getAllWindows().find(
          (window) => window.webContents.getURL() === 'dsh-app://shell/plugin-manager.html',
        ),
      'native plugin window',
    );
    await until(() => !nativeWindow.webContents.isLoading(), 'native plugin load');
    assert.equal(
      await nativeWindow.webContents.executeJavaScript('typeof window.clutchExtension'),
      'undefined',
    );
    const extension = Menu.getApplicationMenu().items.find((item) => item.label === 'Extension');
    assert.ok(extension?.submenu.items[0].enabled);
    extension.submenu.items[0].click();
    const management = await until(
      () =>
        BrowserWindow.getAllWindows().find(
          (window) =>
            window.webContents.getURL() === 'dsh-app://shell/clutch-extension/plugin-manager.html',
        ),
      'management window',
    );
    await until(() => !management.webContents.isLoading(), 'management load');
    assert.equal(
      await management.webContents.executeJavaScript('typeof window.dshDesktop'),
      'undefined',
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(
      await management.webContents.executeJavaScript('window.clutchExtension.list()'),
      [],
    );
    const shellPid = process.pid;
    const firstHost = activeHost().at(-1).child.pid;
    await management.webContents.executeJavaScript('window.clutchExtension.restart()');
    assert.equal(process.pid, shellPid);
    assert.equal(activeHost().length, 1);
    assert.notEqual(activeHost()[0].child.pid, firstHost);
    assert.ok(!primary.isDestroyed() && !management.isDestroyed());
    const local = JSON.stringify(join(root, 'local plugin'));
    await management.webContents.executeJavaScript('window.clutchExtension.install(' + local + ')');
    assert.deepEqual(
      (await management.webContents.executeJavaScript('window.clutchExtension.list()')).map(
        (item) => item.name,
      ),
      ['@clutch-test/smoke'],
    );
    await management.webContents.executeJavaScript(
      'window.clutchExtension.remove("@clutch-test/smoke")',
    );
    assert.deepEqual(
      await management.webContents.executeJavaScript('window.clutchExtension.list()'),
      [],
    );
    assert.equal(activeHost().length, 1);
    await until(() => !primary.webContents.isLoading(), 'reloaded main window');
    assert.equal(await primary.webContents.executeJavaScript('document.readyState'), 'complete');
    await finish(undefined, {
      shellPid,
      firstHost,
      finalHost: activeHost()[0].child.pid,
      checks: [
        'real preload and IPC',
        'app bridge isolation',
        'runtime restart without shell restart',
        'local install',
        'uninstall',
        'one surviving Host',
      ],
    });
  } catch (error) {
    await finish(error);
  }
});
