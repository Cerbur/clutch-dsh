import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(await readFile(path.join(packageDirectory, 'package.json'), 'utf8'));

async function fixture(t, includeBuildDependencies) {
  const directory = await mkdtemp(path.join(tmpdir(), 'worktree-client-build-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modules = path.join(directory, 'node_modules');
  await mkdir(path.join(modules, '@deepseek-ai/dsh-client-store/lib'), { recursive: true });
  await mkdir(path.join(directory, 'scripts'));
  await mkdir(path.join(directory, 'lib/client'), { recursive: true });
  for (const script of ['build-client.mjs', 'client-css-path.mjs']) {
    await cp(path.join(packageDirectory, 'scripts', script), path.join(directory, 'scripts', script));
  }
  // Copy the published store, not its development node_modules: the build must
  // resolve its private implementation dependencies from our own manifest.
  await cp(require.resolve('@deepseek-ai/dsh-client-store'), path.join(modules, '@deepseek-ai/dsh-client-store/lib/index.js'));
  await cp(require.resolve('@deepseek-ai/dsh-client-store/package.json'), path.join(modules, '@deepseek-ai/dsh-client-store/package.json'));
  const names = ['tsdown'];
  if (includeBuildDependencies) {
    for (const name of ['zustand', 'immer']) {
      if (manifest.devDependencies[name] !== undefined) names.push(name);
    }
  }
  for (const name of names) {
    await symlink(path.dirname(require.resolve(`${name}/package.json`)), path.join(modules, name), 'dir');
  }
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: manifest.name, type: 'module' }));
  await writeFile(path.join(directory, 'lib/client/entry.js'), `
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
export function apply() {
  const store = createSnapshotStore({ count: 0 });
  store.update((draft) => { draft.count += 1; });
  return store.getSnapshot();
}
`);
  return directory;
}

test('Client build bundles the published snapshot-store dependencies without Desktop module seeds', async (t) => {
  const directory = await fixture(t, true);
  await run(process.execPath, ['scripts/build-client.mjs'], { cwd: directory, timeout: 20000, maxBuffer: 1024 * 1024 });
  const handoffs = [];
  new Function('window', await readFile(path.join(directory, 'lib/client.js'), 'utf8'))({
    __ModuleLoader__: { load: (handoff) => handoffs.push(handoff) },
  });
  assert.equal(handoffs.length, 1);
  const client = handoffs[0].factory((specifier) => {
    assert.fail(`client-modules: require("${specifier}") missed the module table`);
  });
  assert.deepEqual(client.apply(), { count: 1 });
});

test('Client build rejects unresolved private dependencies instead of emitting unusable require calls', async (t) => {
  const directory = await fixture(t, false);
  await assert.rejects(
    run(process.execPath, ['scripts/build-client.mjs'], { cwd: directory, timeout: 20000, maxBuffer: 1024 * 1024 }),
    (error) => {
      assert.ok(error.code !== 0);
      assert.match(error.stdout + error.stderr, /zustand|immer/);
      return true;
    },
  );
});
