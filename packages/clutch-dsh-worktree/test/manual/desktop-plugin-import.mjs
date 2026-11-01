import assert from 'node:assert/strict';
import console from 'node:console';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';

// Read an existing Desktop graph; create and remove only an isolated profile.
assert.ok(process.execArgv.includes('--expose-internals'), 'run with --expose-internals');
assert.ok(process.argv[2], 'pass the existing DSH installation package.json path');
const anchor = path.resolve(process.argv[2]);
const installed = createRequire(anchor);
const resolve = (name) => pathToFileURL(installed.resolve(name)).href;
const { Context } = await import(resolve('@deepseek-ai/cordis'));
const { default: Loader } = await import(resolve('@deepseek-ai/cordis-plugin-loader'));
const { createRuntimeResolution, PluginPackages } = await import(resolve('@deepseek-ai/dsh-app-boot'));
const candidate = process.argv[3] === undefined
  ? fileURLToPath(new URL('../..', import.meta.url))
  : path.resolve(process.argv[3]);
const manifest = JSON.parse(await readFile(path.join(candidate, 'package.json'), 'utf8'));
const home = await mkdtemp(path.join(tmpdir(), 'worktree-desktop-import-'));
const dir = path.join(home, 'profiles/test');
const ctx = new Context();
try {
  await mkdir(path.join(dir, 'node_modules/@cerbur'), { recursive: true });
  await symlink(candidate, path.join(dir, 'node_modules', manifest.name), 'dir');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'worktree-desktop-import-fixture', type: 'module',
    dependencies: { [manifest.name]: `link:${candidate}` },
    dsh: { profile: { bundles: [manifest.name] } },
  }));
  const profile = {
    name: 'test', dir, skippedBundles: [],
    layers: [{ packageName: manifest.name, packageDir: candidate, patchPaths: [], patches: [] }],
    patches: [],
  };
  const resolution = await createRuntimeResolution({ installAnchor: anchor, profile, home });
  console.log('Desktop native resolution', resolution.linkedRoots);
  ctx.baseUrl = pathToFileURL(path.join(dir, 'cordis.yml')).href;
  await ctx.plugin(PluginPackages, { resolution });
  await ctx.plugin(Loader);
  let failures = 0;
  for (const subpath of ['', '/typert']) {
    const specifier = manifest.name + subpath;
    try {
      const module = await ctx.loader.import(specifier);
      assert.ok(module);
      console.log('IMPORT OK', specifier);
    } catch (error) {
      failures++;
      console.error('FAILED TO IMPORT', specifier, error);
    }
  }
  process.exitCode = failures ? 1 : 0;
} finally {
  await ctx.fiber.dispose();
  await rm(home, { recursive: true, force: true });
}
