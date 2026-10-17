import assert from 'node:assert/strict';
import console from 'node:console';
import process from 'node:process';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';

const { fetch, structuredClone } = globalThis;

const { values } = parseArgs({
  options: {
    'dsh-source': { type: 'string' },
    versions: { type: 'string' },
    output: { type: 'string' },
  },
});
const source = fileURLToPath(new URL('..', import.meta.url));
const workspaceSource = path.resolve(source, '../..');
const manifest = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8'));
const originalRoot = JSON.parse(await readFile(path.join(workspaceSource, 'package.json'), 'utf8'));
const lock = parse(await readFile(path.join(workspaceSource, 'pnpm-lock.yaml'), 'utf8'));
const discovered =
  values.versions?.split(',') ??
  (values['dsh-source'] === undefined
    ? []
    : execFileSync('git', ['tag', '--list', 'dsh-v0.2.1-rc*', '--sort=version:refname'], {
        cwd: values['dsh-source'],
        encoding: 'utf8',
      })
        .trim()
        .split('\n')
        .map((tag) => tag.replace(/^dsh-v/, '')));
const versions = [...new Set(discovered)];
if (versions.length === 0 || versions.some((version) => !/^0\.2\.1-rc\.\d+$/.test(version))) {
  throw new Error(
    'Pass --dsh-source /path/to/deepseek-harness or --versions 0.2.1-rc.1,0.2.1-rc.2',
  );
}
const output =
  values.output === undefined
    ? await mkdtemp(path.join(tmpdir(), 'title-dsh-compat-'))
    : path.resolve(values.output);
await mkdir(output, { recursive: true });
console.log(`DSH compatibility artifacts: ${output}`);

const activeChildren = new Set();
let interrupted = false;
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, async () => {
    if (interrupted) return;
    interrupted = true;
    await Promise.allSettled([...activeChildren].map(stop));
    process.exit(code);
  });
}

function terminate(child, signal) {
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function running(child) {
  if (process.platform === 'win32') return child.exitCode === null && child.signalCode === null;
  if (child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

function start(command, args, cwd, logPath, env = process.env) {
  if (interrupted) throw new Error('DSH compatibility run interrupted');
  const log = createWriteStream(logPath);
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const owned = { child };
  activeChildren.add(owned);
  let text = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      text += data;
      log.write(data);
    });
  const done = new Promise((resolve, reject) => {
    child.once('error', (error) => {
      if (!running(child)) activeChildren.delete(owned);
      log.end();
      reject(error);
    });
    child.once('close', (code, signal) => {
      log.end();
      if (!running(child)) activeChildren.delete(owned);
      resolve({ code, signal, text });
    });
  });
  return Object.assign(owned, { done, text: () => text });
}

async function run(command, args, cwd, logPath, env) {
  const process = start(command, args, cwd, logPath, env);
  const timer = setTimeout(
    () => {
      void stop(process);
    },
    10 * 60 * 1000,
  );
  try {
    const result = await process.done;
    assert.equal(result.code, 0, `${command} failed; see ${logPath}\n${result.text.slice(-1800)}`);
    return result.text;
  } finally {
    clearTimeout(timer);
    await stop(process);
  }
}

async function waitFor(read, description, child, timeoutMs = 60000) {
  const expires = Date.now() + timeoutMs;
  while (Date.now() < expires) {
    const result = await read();
    if (result) return result;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`Web process stopped before ${description}`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function stop(process) {
  if (!running(process.child)) {
    activeChildren.delete(process);
    return;
  }
  terminate(process.child, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (running(process.child) && Date.now() < deadline) await delay(50);
  if (running(process.child)) terminate(process.child, 'SIGKILL');
  await Promise.race([process.done, delay(1000)]);
  activeChildren.delete(process);
}

async function smoke(pkg, version, versionOutput) {
  const home = await mkdtemp(path.join(versionOutput, 'home-'));
  const profile = path.join(home, 'profiles/web');
  await mkdir(path.join(profile, 'node_modules/@cerbur'), { recursive: true });
  try {
    await symlink(pkg, path.join(profile, 'node_modules/@cerbur/clutch-dsh-title'), 'dir');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await writeFile(
    path.join(profile, 'package.json'),
    JSON.stringify(
      {
        private: true,
        dependencies: { '@cerbur/clutch-dsh-title': `link:${pkg}` },
        dsh: {
          profile: {
            bundles: [
              '@deepseek-ai/dsh-base',
              '@deepseek-ai/dsh-web-app',
              '@cerbur/clutch-dsh-title',
            ],
          },
        },
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(profile, 'cordis.yml'), '[]\n');
  await writeFile(
    path.join(profile, 'cordis.patch.yml'),
    `- insert:\n    - id: title-matrix-fixture\n      name: ${JSON.stringify(path.join(pkg, 'test/compat-host.mjs'))}\n`,
  );
  const reportPath = path.join(home, 'host.json');
  const cli = path.join(pkg, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
  const environment = { ...process.env, DSH_HOME: home, DSH_TITLE_COMPAT_REPORT: reportPath };
  const actual = await run(
    process.execPath,
    [cli, '--version'],
    pkg,
    path.join(versionOutput, 'cli-version.log'),
    environment,
  );
  assert.equal(actual.trim(), version);
  const server = start(
    process.execPath,
    [cli, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
    pkg,
    path.join(versionOutput, 'web.log'),
    environment,
  );
  try {
    const launch = await waitFor(
      () => server.text().match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/)?.[1],
      'Web listener',
      server.child,
    );
    const host = await waitFor(
      async () => {
        try {
          return JSON.parse(await readFile(reportPath, 'utf8'));
        } catch (error) {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        }
      },
      'host regression report',
      server.child,
    );
    assert.equal(host.ok, true, host.error);
    assert.doesNotMatch(server.text(), /entries? did not activate|failed to import/);
    const auth = await fetch(launch, { redirect: 'manual' });
    assert.equal(auth.status, 303);
    const cookie = auth.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie, 'Web launch must establish an authenticated test session');
    const base = new URL('/', launch);
    const rpc = async (endpoint, args = {}) => {
      const rpcId = `matrix-${Date.now()}`;
      const response = await fetch(new URL(`api/${endpoint}`, base), {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'client-request',
          rpcId,
          method: endpoint,
          payload: { args },
        }),
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.rpcId, rpcId);
      assert.equal(result.result.ok, true, JSON.stringify(result.result));
      return result.result.value;
    };
    const page = await fetch(base, { headers: { cookie } });
    assert.equal(page.status, 200);
    const settings = await rpc('settings/describe');
    assert.ok(settings.namespaces.some((item) => item.ns === 'clutch-dsh-title'));
    const stats = await rpc('titleStats/getStats');
    assert.ok(stats.totalCalls >= 5);
    const diagnostics = await rpc('titleStats/getDiagnostics');
    assert.ok(diagnostics.totalRecovered >= 1);
    assert.equal((await rpc('titleStats/resetStats')).totalCalls, 0);
    assert.equal((await rpc('titleStats/resetDiagnostics')).totalIncidents, 0);
    const browser = await fetch(new URL(host.browserUrl, base), {
      headers: { cookie },
    });
    assert.equal(browser.status, 200);
    assert.match(await browser.text(), /@cerbur\/clutch-dsh-title/);
    await writeFile(path.join(versionOutput, 'host.json'), JSON.stringify(host, null, 2));
    await stop(server);
    const reloadPath = path.join(home, 'reload.json');
    const restart = start(
      process.execPath,
      [cli, 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'],
      pkg,
      path.join(versionOutput, 'web-restart.log'),
      { ...environment, DSH_TITLE_COMPAT_REPORT: reloadPath, DSH_TITLE_COMPAT_RELOAD: '1' },
    );
    let reloaded;
    try {
      reloaded = await waitFor(
        async () => {
          try {
            return JSON.parse(await readFile(reloadPath, 'utf8'));
          } catch (error) {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          }
        },
        'restarted host report',
        restart.child,
      );
      assert.equal(reloaded.ok, true, reloaded.error);
      assert.doesNotMatch(restart.text(), /entries? did not activate|failed to import/);
    } finally {
      await stop(restart);
    }
    const checks = [
      ...host.checks,
      'authenticated Web page and plugin bundle',
      'settings/stats/diagnostics RPC and resets',
      ...reloaded.checks,
    ];
    await writeFile(path.join(versionOutput, 'web-checks.json'), JSON.stringify(checks, null, 2));
    return checks;
  } finally {
    await stop(server);
  }
}

const results = [];
for (const version of versions) {
  if (interrupted) break;
  const versionOutput = path.join(output, version);
  await mkdir(versionOutput, { recursive: true });
  const workspace = await mkdtemp(path.join(versionOutput, 'workspace-'));
  const pkg = path.join(workspace, 'packages/clutch-dsh-title');
  const result = { version, ok: false };
  results.push(result);
  try {
    console.log(`${version}: prepare isolated workspace`);
    await mkdir(path.dirname(pkg), { recursive: true });
    await cp(source, pkg, {
      recursive: true,
      filter: (filename) =>
        !['lib', 'node_modules'].includes(path.relative(source, filename).split(path.sep)[0]),
    });
    const root = structuredClone(originalRoot);
    root.packageManager = manifest.packageManager;
    root.pnpm = { overrides: {} };
    for (const [importer, owner] of [
      ['.', root.name],
      ['packages/clutch-dsh-title', manifest.name],
    ]) {
      for (const group of ['dependencies', 'devDependencies']) {
        for (const [name, dep] of Object.entries(lock.importers[importer][group] ?? {})) {
          if (name.startsWith('@deepseek-ai/dsh-') || dep.version.startsWith('@')) continue;
          root.pnpm.overrides[`${owner}>${name}`] = dep.version.split('(')[0];
        }
      }
    }
    const current = structuredClone(manifest);
    for (const [name, value] of Object.entries(current.devDependencies)) {
      if (name.startsWith('@deepseek-ai/dsh-') && /^0\./.test(value))
        current.devDependencies[name] = version;
    }
    current.devDependencies['@deepseek-ai/dsh'] = version;
    await writeFile(path.join(workspace, 'package.json'), JSON.stringify(root, null, 2));
    await writeFile(path.join(pkg, 'package.json'), JSON.stringify(current, null, 2));
    await cp(
      path.join(workspaceSource, 'tsconfig.base.json'),
      path.join(workspace, 'tsconfig.base.json'),
    );
    await writeFile(path.join(workspace, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    console.log(`${version}: install exact DSH dependencies`);
    await run(
      'pnpm',
      ['install', '--ignore-scripts', '--registry=https://registry.npmjs.org'],
      workspace,
      path.join(versionOutput, 'install.log'),
    );
    for (const name of Object.keys(current.devDependencies).filter(
      (name) => name.startsWith('@deepseek-ai/dsh') && !name.endsWith('-legacy'),
    )) {
      const installed = JSON.parse(
        await readFile(path.join(pkg, 'node_modules', name, 'package.json'), 'utf8'),
      );
      assert.equal(installed.version, version, `${name} did not switch to ${version}`);
    }
    console.log(`${version}: clean build and full title suite`);
    const test = await run(
      'pnpm',
      ['--filter', manifest.name, 'test'],
      workspace,
      path.join(versionOutput, 'test.log'),
    );
    result.tests = Number(test.match(/(?:#|ℹ) tests (\d+)/)?.[1]);
    assert.ok(result.tests > 0, 'test report must contain the executed test count');
    await run(
      'pnpm',
      ['--filter', manifest.name, 'typecheck'],
      workspace,
      path.join(versionOutput, 'typecheck.log'),
    );
    console.log(`${version}: real Web host, persistence and HTTP RPC`);
    result.webChecks = await smoke(pkg, version, versionOutput);
    result.ok = true;
    console.log(`${version}: PASS (${result.tests} tests, ${result.webChecks.length} Web checks)`);
  } catch (error) {
    result.error = error.stack ?? String(error);
    console.error(`${version}: FAIL: ${error.message}`);
  }
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(`Results: ${path.join(output, 'results.json')}`);
if (results.some((result) => !result.ok)) process.exitCode = 1;
