import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { URL } from 'node:url';
import { Parser, x as extractTar } from 'tar';
import { pipeline } from 'node:stream/promises';

const NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u;
const MAX_BYTES = 512 * 1024 * 1024;
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
export function serialOperations() {
  let pending = Promise.resolve();
  return {
    run(action) {
      const result = pending.then(action);
      pending = result.catch(() => {});
      return result;
    },
  };
}
export function assertSender(event) {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) throw new Error('extension: main frame required');
  const url = new URL(frame.url);
  if (url.protocol !== 'dsh-app:' || url.hostname !== 'shell')
    throw new Error('extension: untrusted renderer');
}
export function assertMutable(name, coreNames) {
  if (typeof name !== 'string' || !NAME.test(name))
    throw new Error('extension: invalid package name');
  if (coreNames.includes(name)) throw new Error('extension: this package is protected');
}
export function validateLocalPackage(directory) {
  const manifest = json(join(directory, 'package.json'));
  if (
    typeof manifest.name !== 'string' ||
    !NAME.test(manifest.name) ||
    typeof manifest.version !== 'string' ||
    !manifest.version
  )
    throw new Error('extension: package name and version are required');
  const patch = manifest.dsh?.bundle?.patch;
  const check = (path) => {
    if (typeof path !== 'string' || isAbsolute(path))
      throw new Error('extension: invalid package entry');
    const target = resolve(directory, path);
    if (
      !target.startsWith(resolve(directory) + sep) ||
      !existsSync(target) ||
      !statSync(target).isFile()
    )
      throw new Error(
        'extension: missing package entry: ' + path + '; build the local package first',
      );
  };
  check(patch);
  const entries = (value) => {
    if (typeof value === 'string') {
      if (!value.includes('*')) check(value);
    } else if (value && typeof value === 'object')
      for (const entry of Object.values(value)) entries(entry);
  };
  if (manifest.exports) entries(manifest.exports);
  else check(manifest.main ?? 'index.js');
  for (const spec of Object.values({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  })) {
    if (typeof spec !== 'string' || /^(?:file:|link:|workspace:|\.\.?\/|\/)/u.test(spec))
      throw new Error('extension: local/workspace dependencies must be published or bundled first');
  }
  return manifest;
}
async function command(node, args, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(node, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: dirname(node) + ':' + (process.env.PATH ?? '') },
    });
    let output = '';
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk) => {
        output = (output + chunk).slice(-65536);
      });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error('extension: package snapshot failed: ' + output)),
    );
  });
}
export async function snapshotLocal(input, root, runtime) {
  if (typeof input !== 'string' || !isAbsolute(input))
    throw new Error('extension: use an absolute local path');
  const temporary = mkdtempSync(join(tmpdir(), 'clutch-extension-'));
  try {
    const archive = join(temporary, 'package.tgz');
    const inputStat = statSync(input);
    if (inputStat.isDirectory()) {
      validateLocalPackage(input);
      await command(
        runtime.node,
        [
          runtime.pnpm,
          '--config.ignore-scripts=true',
          '--config.ignore-pnpmfile=true',
          '--pm-on-fail=ignore',
          '--dir',
          input,
          'pack',
          '--out',
          archive,
        ],
        input,
      );
    } else {
      if (!inputStat.isFile() || !input.endsWith('.tgz'))
        throw new Error('extension: expected a directory or .tgz archive');
      if (inputStat.size > 128 * 1024 * 1024) throw new Error('extension: archive exceeds 128 MiB');
      copyFileSync(input, archive);
    }
    if (statSync(archive).size > 128 * 1024 * 1024)
      throw new Error('extension: archive exceeds 128 MiB');
    let bytes = 0;
    let count = 0;
    let invalid;
    const seen = new Set();
    const parser = new Parser({
      strict: true,
      onReadEntry(entry) {
        bytes += entry.size;
        count++;
        const path = entry.path.replace(/\/$/u, '');
        if (!path.startsWith('package/') && path !== 'package')
          invalid = 'expected package/ archive root';
        if (
          path.split('/').some((part) => part === '..' || part === '.') ||
          path.includes('\\') ||
          seen.has(path)
        )
          invalid = 'invalid or duplicate archive path';
        if (!['File', 'Directory'].includes(entry.type))
          invalid = 'links and special files are unsupported';
        if (bytes > MAX_BYTES || count > 50000) invalid = 'archive exceeds extraction limit';
        seen.add(path);
        if (invalid) parser.abort(new Error('extension: ' + invalid));
        entry.resume();
      },
    });
    await pipeline(createReadStream(archive), parser);
    const extracted = join(temporary, 'unpacked');
    mkdirSync(extracted);
    await extractTar({ file: archive, cwd: extracted, strict: true });
    const manifest = validateLocalPackage(join(extracted, 'package'));
    const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
    const storage = join(root, 'local-packages');
    mkdirSync(storage, { recursive: true, mode: 0o700 });
    const destination = join(storage, hash + '.tgz');
    if (
      !existsSync(destination) ||
      createHash('sha256').update(readFileSync(destination)).digest('hex') !== hash
    ) {
      // Publish only a complete snapshot; a failed copy never poisons its final name.
      const incoming = mkdtempSync(join(storage, '.incoming-'));
      try {
        const candidate = join(incoming, 'package.tgz');
        copyFileSync(archive, candidate);
        renameSync(candidate, destination);
      } finally {
        rmSync(incoming, { recursive: true, force: true });
      }
    }
    return { name: manifest.name, spec: 'file:' + destination };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
export async function prepareMutation(mutation, manager, coreNames, packageNameFromSpec) {
  if (mutation.type === 'plugin-add') {
    if (typeof mutation.spec !== 'string')
      throw new Error('extension: package spec must be a string');
    const spec = mutation.spec.trim();
    const local = spec.startsWith('file:') ? spec.slice(5) : spec;
    const prepared = isAbsolute(local)
      ? await snapshotLocal(local, manager.paths.root, manager.runtime)
      : { name: packageNameFromSpec(spec), spec };
    assertMutable(prepared.name, coreNames);
    return { ...mutation, spec: prepared.spec, clutchName: prepared.name };
  }
  assertMutable(mutation.name, coreNames);
  return mutation;
}
export function registerBridge({ ipcMain, dialog, manager, mutate, restart, coreNames }) {
  const handle = (channel, action) =>
    ipcMain.handle('clutch-extension:' + channel, (event, ...args) => {
      assertSender(event);
      return action(event, ...args);
    });
  handle('list', () => {
    const manifest = json(join(manager.paths.profile, 'package.json'));
    return manager
      .listPlugins()
      .filter((plugin) => !coreNames().includes(plugin.name))
      .map((plugin) => ({
        ...plugin,
        source: (manifest.dependencies[plugin.name] ?? '').startsWith('file:') ? 'local' : 'npm',
      }));
  });
  handle('install', (event, spec) => mutate(event, { type: 'plugin-add', spec }));
  handle('remove', (event, name) => mutate(event, { type: 'plugin-remove', name }));
  handle('restart', () => restart());
  handle('choose', async (_event, kind) => {
    if (!['directory', 'archive'].includes(kind)) throw new Error('extension: invalid picker kind');
    const result = await dialog.showOpenDialog({
      properties: kind === 'directory' ? ['openDirectory'] : ['openFile'],
      ...(kind === 'archive' ? { filters: [{ name: 'npm package', extensions: ['tgz'] }] } : {}),
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
