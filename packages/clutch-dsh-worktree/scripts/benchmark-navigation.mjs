#!/usr/bin/env node
/**
 * Local Windows navigation benchmark, NOT two complete builds or browser A/B.
 * Build this package first. Run --help without creating fixtures or measuring.
 * Baseline: parent reader + current legacy Manager endpoints (verified below).
 * Optimized: current reader + current readWorkspaceNavigation endpoint.
 * All fixtures and the transpiled parent reader live in one owned OS-temp folder.
 */
import assert from 'node:assert/strict';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { runBenchmarkGit } from './benchmark-git.mjs';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const options = { samples: 30, warmups: 3, output: path.resolve('navigation-benchmark.json') };
const usage = `node scripts/benchmark-navigation.mjs [--samples 30] [--warmups 3] [--output PATH]
Requires a fresh package build with src identical to 7ba6394 and Git history containing b6d9541.
Minimum: 30 measured pairs and 3 warmup pairs per scenario. No measurement with --help.`;
for (let i = 2; i < process.argv.length; i += 1) {
  const flag = process.argv[i];
  if (flag === '--help') { console.log(usage); process.exit(0); }
  assert.ok(['--samples', '--warmups', '--output'].includes(flag), 'Unknown option: ' + flag);
  const value = process.argv[++i];
  assert.ok(value && !value.startsWith('--'), 'Missing value for ' + flag);
  const key = flag.slice(2);
  options[key] = key === 'output' ? path.resolve(value) : Number(value);
}
assert.ok(Number.isSafeInteger(options.samples) && options.samples >= 30, '--samples must be >=30');
assert.ok(Number.isSafeInteger(options.warmups) && options.warmups >= 3, '--warmups must be >=3');
const gitLimits = { timeoutMs: 30000, cleanupTimeoutMs: 5000, maxOutputBytes: 16 * 1024 * 1024 };
async function git(args, cwd = packageRoot) {
  return runBenchmarkGit(args, cwd, gitLimits);
}
const prefix = 'packages/clutch-dsh-worktree/';
const target = (await git(['rev-parse', '7ba6394^{commit}'])).trim();
const baseline = (await git(['rev-parse', 'b6d9541^{commit}'])).trim();
const checkoutCommit = (await git(['rev-parse', 'HEAD'])).trim();
assert.equal((await git(['rev-parse', target + '^'])).trim(), baseline, 'Unexpected parent');
assert.equal((await git(['diff', target, '--', 'src'])).trim(), '', 'Tracked source changes invalidate baseline verification');
const sourceAt = (ref, file) => git(['show', ref + ':' + prefix + file]);
const ts = await import('typescript');
const { createWorktreeManager } = await import('../lib/manage/manager.js');
const { LocalGitAdapter } = await import('../lib/provider/git/adapter.js');
const { createWorktreeViewReader } = await import('../lib/client/view/worktree-view-read.js');

// Reject semantic drift in the reused provider / Manage endpoint implementations.
const reused = ['src/provider', 'src/manage/manager-worktrees.ts', 'src/manage/manager-sessions.ts',
  'src/manage/manager-support.ts', 'src/client/view/worktree-view-errors.ts'];
assert.equal((await git(['diff', '--name-only', baseline, target, '--', ...reused])).trim(), '',
  'Shared implementation changed: a legacy-endpoint baseline is no longer justified');
const oldManager = await sourceAt(baseline, 'src/manage/manager.ts');
const newManager = await sourceAt(target, 'src/manage/manager.ts');
function nodes(source) {
  const result = [];
  const visit = (node) => { result.push(node); ts.forEachChild(node, visit); };
  visit(ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true));
  return result;
}
function method(source, name) {
  return nodes(source).find((n) => ts.isMethodDeclaration(n) && n.name.getText() === name);
}
const compact = (text) => text.replaceAll('this.context', 'context').replace(/\s+/gu, '');
for (const name of ['listWorktrees', 'getWorkspaceGitState', 'listBindings', 'getWorktreeInstructions']) {
  assert.equal(compact(method(oldManager, name).getText()), compact(method(newManager, name).getText()), name + ' changed');
}
const oldCheckout = method(oldManager, 'getWorkspaceCheckout');
// Traverse the method in the complete parent AST.
let checkoutArrow;
const visitCheckout = (n) => { if (ts.isArrowFunction(n)) checkoutArrow = n; ts.forEachChild(n, visitCheckout); };
visitCheckout(oldCheckout);
const navigationSource = await sourceAt(target, 'src/manage/manager-navigation.ts');
const checkoutFunction = nodes(navigationSource).find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'getWorkspaceCheckout');
assert.equal(compact(checkoutArrow.body.getText()), compact(checkoutFunction.body.getText()), 'Checkout extraction changed semantics');

const parentReaderSource = await sourceAt(baseline, 'src/client/view/worktree-view-read.ts');
const currentReaderSource = await sourceAt(target, 'src/client/view/worktree-view-read.ts');
const digest = (value) => createHash('sha256').update(value).digest('hex');
const provenance = { target, baseline, checkoutCommit, baselineReaderSha256: digest(parentReaderSource),
  currentReaderSourceSha256: digest(currentReaderSource),
  currentReaderBuildSha256: digest(await readFile(path.join(packageRoot, 'lib/client/view/worktree-view-read.js'))),
  sharedImplementationsVerified: reused, checkoutExtractionVerified: true };
const tempParent = await realpath(os.tmpdir());
const ownedRoot = await mkdtemp(path.join(tempParent, 'clutch-navigation-benchmark-'));
let activeManager;
try {
  const transpiled = ts.transpileModule(parentReaderSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const relativeImport = './worktree-view-errors.js';
  assert.equal(transpiled.split(relativeImport).length, 2, 'Unexpected parent runtime imports');
  const parentModule = path.join(ownedRoot, 'parent-reader.mjs');
  await writeFile(parentModule, transpiled.replace(relativeImport,
    pathToFileURL(path.join(packageRoot, 'lib/client/view/worktree-view-errors.js')).href));
  const { createWorktreeViewReader: createParentReader } = await import(pathToFileURL(parentModule).href);
  const scenarios = [
    { name: 'single-attached', workspaceCount: 1, managedCount: 0, detached: false },
    { name: 'single-detached', workspaceCount: 1, managedCount: 0, detached: true },
    { name: 'eight-managed-worktrees', workspaceCount: 1, managedCount: 8, detached: false },
    { name: 'twelve-workspaces-fanout', workspaceCount: 12, managedCount: 0, detached: false },
  ];
  const results = [];
  for (const scenario of scenarios) {
    const scenarioRoot = path.join(ownedRoot, scenario.name);
    await mkdir(scenarioRoot);
    const workspaces = new Map();
    const sidecars = new Map();
    for (let index = 0; index < scenario.workspaceCount; index += 1) {
      const workspaceId = 'ws-' + index;
      const repo = path.join(scenarioRoot, workspaceId);
      await mkdir(repo);
      await git(['init', '-b', 'main', '--template='], repo);
      await git(['config', 'core.hooksPath', path.join(ownedRoot, 'no-hooks')], repo);
      await git(['config', 'commit.gpgSign', 'false'], repo);
      await writeFile(path.join(repo, 'fixture.txt'), 'Navigation benchmark fixture\n');
      await git(['add', '--', 'fixture.txt'], repo);
      await git(['-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid',
        'commit', '-m', 'fixture'], repo);
      const commit = (await git(['rev-parse', 'HEAD'], repo)).trim();
      const records = [];
      for (let n = 0; n < scenario.managedCount; n += 1) {
        const branch = 'managed-' + n;
        const checkout = path.join(scenarioRoot, workspaceId + '-' + branch);
        await git(['worktree', 'add', '-b', branch, checkout, 'HEAD'], repo);
        records.push({ worktreeId: 'wt-' + n, workspaceId, absolutePath: checkout, branch,
          source: 'external', status: 'active', baseCommit: commit, baseBranch: 'main',
          importedAt: '2026-01-01T00:00:00.000Z', instructions: 'Instructions for ' + branch });
      }
      if (scenario.detached) await git(['checkout', '--detach', 'HEAD'], repo);
      const snapshot = { schemaVersion: 7, workspaceId, revision: '1', worktrees: records,
        bindings: records.map((record, n) => ({ workspaceId, worktreeId: record.worktreeId,
          sessionId: 'session-' + n, status: 'active' })), mainInstructions: 'Main instructions for ' + workspaceId };
      const sidecarPath = path.join(scenarioRoot, workspaceId + '.json');
      await writeFile(sidecarPath, JSON.stringify(snapshot));
      sidecars.set(workspaceId, sidecarPath);
      workspaces.set(workspaceId, { workspaceId, projectId: workspaceId, rootPath: repo });
    }
    let metrics;
    let activeGit = 0;
    const adapter = new LocalGitAdapter({ timeoutMs: 30000, maxOutputBytes: gitLimits.maxOutputBytes,
      cleanupTimeoutMs: 5000 });
    // Instrument the actual adapter runner; it uses bounded execFile with shell:false
    // when no DSH subprocess service is supplied. Do not replace Git facts with mocks.
    const originalRun = adapter.run.bind(adapter);
    adapter.run = async (...args) => {
      const sample = metrics;
      if (sample) {
        sample.gitInvocations += 1;
        sample.gitCommands[args[0].join(' ')] = (sample.gitCommands[args[0].join(' ')] ?? 0) + 1;
        activeGit += 1;
        sample.gitPeakConcurrency = Math.max(sample.gitPeakConcurrency, activeGit);
      }
      try { return await originalRun(...args); }
      finally { if (sample) activeGit -= 1; }
    };
    const manager = createWorktreeManager({ dshHome: scenarioRoot, git: adapter,
      dsh: { getWorkspace: async (id) => workspaces.get(id), readWorktreeActivity: async () => ({ state: 'idle' }) },
      sidecar: { read: async (id) => {
        if (metrics) metrics.sidecarReads += 1;
        assert.ok(sidecars.has(id));
        return JSON.parse(await readFile(sidecars.get(id), 'utf8'));
      } },
    });
    activeManager = manager;
    const ids = [...workspaces.keys()];
    const wrapManager = (mode) => new Proxy(manager, { get(targetManager, property) {
      if (mode === 'legacy' && property === 'readWorkspaceNavigation') return undefined;
      const value = Reflect.get(targetManager, property);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (metrics) {
          metrics.readerRpcCalls += 1;
          metrics.rpcMethods[property] = (metrics.rpcMethods[property] ?? 0) + 1;
        }
        return value.apply(targetManager, args);
      };
    } });
    async function measure(reader) {
      assert.equal(activeGit, 0);
      metrics = { gitInvocations: 0, gitPeakConcurrency: 0, sidecarReads: 0,
        readerRpcCalls: 0, gitCommands: {}, rpcMethods: {} };
      const sample = metrics;
      const start = performance.now();
      const completions = [];
      const pending = ids.map((id) => reader.read(id).then((view) => {
        completions.push({ workspaceId: id, ms: performance.now() - start });
        return view;
      }));
      const settled = await Promise.allSettled(pending);
      sample.wallMs = performance.now() - start;
      sample.workspaceCompletions = completions;
      sample.firstWorkspaceCompletionMs = completions[0]?.ms;
      sample.allCompletionMs = completions.at(-1)?.ms;
      metrics = undefined;
      assert.equal(activeGit, 0);
      const failure = settled.find((value) => value.status === 'rejected');
      if (failure) throw failure.reason;
      return { sample, views: settled.map((value) => value.value) };
    }
    const rawSamples = [];
    for (let pair = 0; pair < options.warmups + options.samples; pair += 1) {
      const phase = pair < options.warmups ? 'warmup' : 'measured';
      const order = pair % 2 === 0 ? ['legacy', 'navigation'] : ['navigation', 'legacy'];
      const observations = {};
      for (const mode of order) {
        const create = mode === 'legacy' ? createParentReader : createWorktreeViewReader;
        const reader = create(wrapManager(mode));
        try {
          const first = await measure(reader);
          const cached = await measure(reader);
          assert.deepEqual(cached.views, first.views, 'Cached views changed');
          for (let n = 0; n < ids.length; n += 1) assert.equal(cached.views[n], first.views[n]);
          assert.equal(cached.sample.gitInvocations + cached.sample.sidecarReads + cached.sample.readerRpcCalls, 0);
          assert.equal(first.sample.readerRpcCalls, ids.length * (mode === 'legacy' ? 5 : 1));
          assert.equal(first.sample.sidecarReads, ids.length * (mode === 'legacy' ? 3 : 1));
          for (const view of first.views) {
            assert.equal(view.worktrees.length, scenario.managedCount);
            assert.equal(view.readiness.status, 'ready');
            assert.equal(view.currentBranch, scenario.detached ? null : 'main');
            assert.equal(view.checkout.currentHead.kind, scenario.detached ? 'commit' : 'branch');
            assert.ok(view.worktrees.every((record) => record.health === 'ready'));
          }
          observations[mode] = first.views;
          rawSamples.push({ phase, pair, order, mode, entry: first.sample, cachedReentry: cached.sample });
        } finally { reader.dispose(); }
      }
      assert.deepEqual(observations.legacy, observations.navigation, 'Baseline and navigation outputs differ');
    }
    await manager.close();
    activeManager = undefined;
    const summaries = {};
    for (const mode of ['legacy', 'navigation']) {
      summaries[mode] = {};
      for (const entry of ['entry', 'cachedReentry']) {
        summaries[mode][entry] = {};
        for (const key of ['wallMs', 'firstWorkspaceCompletionMs', 'allCompletionMs', 'gitInvocations',
          'gitPeakConcurrency', 'sidecarReads', 'readerRpcCalls']) {
          summaries[mode][entry][key] = summarize(rawSamples.filter((s) => s.phase === 'measured' && s.mode === mode).map((s) => s[entry][key]));
        }
      }
    }
    const deltas = [];
    for (let pair = options.warmups; pair < options.warmups + options.samples; pair += 1) {
      const a = rawSamples.find((s) => s.pair === pair && s.mode === 'legacy').entry.wallMs;
      const b = rawSamples.find((s) => s.pair === pair && s.mode === 'navigation').entry.wallMs;
      deltas.push({ pair, legacyMinusNavigationMs: a - b, navigationOverLegacy: b / a });
    }
    results.push({ ...scenario, rawSamples, summaries, pairedDeltas: deltas,
      pairedDeltaSummaryMs: summarize(deltas.map((d) => d.legacyMinusNavigationMs)) });
    console.error('Completed ' + scenario.name);
  }
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), options, provenance,
    environment: { node: process.version, nodeExecutable: process.execPath, git: (await git(['--version'])).trim(),
      platform: process.platform, arch: process.arch, osRelease: os.release(), osVersion: os.version(),
      cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), tempParent },
    methodology: {
      comparison: 'Parent reader + verified current legacy Manager endpoints vs current reader + navigation endpoint; NOT two complete builds A/B.',
      order: 'Sequential pairs; alternating first mode; each mode uses a fresh reader followed by immediate cached reentry.',
      timing: 'performance.now; fresh reader cache, warm OS/Git filesystem caches; setup, transpilation, assertions and JSON writing excluded.',
      rpc: 'Actual client reader method calls into real local Manage; counts RPC-equivalent calls, no network/Gateway/serialization latency.',
      sidecar: 'Real UTF-8 JSON files, readFile+JSON.parse on every read. No production schema validation, migration, locking or shard layout.',
      git: 'Real LocalGitAdapter and its default Node execFile runner; wrapper counts pending run calls including failures. No DSH subprocess service.',
      completion: 'First/all complete reader promises, not browser paint. Cache reentry uses the same reader without invalidation.',
      excluded: 'DSH startup/recovery, native Session service, browser rendering, transport, antivirus control, cold disk cache and error scenarios.',
      build: 'Existing lib artifacts must be freshly built by the operator; source revisions and reader artifact hash are recorded.',
      fixture: 'Independent local repositories, one committed file each; 8 managed attached worktrees with bindings and nonempty instructions; fanout uses 12 independent repositories.',
      statistics: 'Warmups retained but excluded from summaries; p95 uses nearest rank; paired deltas retain sign; no wall-time pass/fail threshold.',
    }, results };
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log('Wrote ' + options.output);
} finally {
  if (activeManager) await activeManager.close();
  // Only the exact directory returned by our mkdtemp is eligible for removal.
  assert.equal(path.dirname(ownedRoot), tempParent);
  assert.ok(path.basename(ownedRoot).startsWith('clutch-navigation-benchmark-'));
  await rm(ownedRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { n: sorted.length, min: sorted[0], max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}
