import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { inlineAssets } from '../scripts/inline-assets.mjs';

async function sourceModule(relative, metaUrl) {
  let source = await readFile(new URL('../src/' + relative, import.meta.url), 'utf8');
  source = source.replace(/^export \{.*\} from .*;$/gm, '');
  if (metaUrl) source = source.replaceAll('import.meta.url', JSON.stringify(metaUrl));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}
const { createAssetByteLoader, withAssetSlot } = await sourceModule('client/scene/asset-bytes.ts');

test('production transport has no temporary browser or Host diagnostics', async () => {
  for (const file of ['index.ts', 'client/scene/asset-bytes.ts', 'client/scene/kitchen/asset.ts']) {
    const source = await readFile(new URL('../src/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /DEBUG-office-perf|traceAssetStage|officeAssetStages|assetDiagnosticLocation|connection\/request/,
    );
  }
});
const bytes = Buffer.from([0, 255, 3, 9]);
const descriptor = (id = 'models/kitchen/test.glb') => ({
  assetId: id,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  bytes: bytes.length,
});
const response = () =>
  new Response(new Uint8Array(bytes), {
    headers: { 'content-length': String(bytes.length) },
  });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('production transforms only packaged binary imports; index and descriptors agree, JSON/preview stay inline', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'office-transport-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets/models/kitchen'), { recursive: true });
  await writeFile(join(root, 'assets/models/kitchen/test.glb'), bytes);
  await writeFile(join(root, 'assets/models/kitchen/manifest.json'), '{}');
  const indexFile = join(root, 'lib/asset-index.json');
  const plugin = inlineAssets({ mode: 'external', root, indexFile });
  const importer = join(root, 'entry.js');
  const binary = await plugin.load(
    plugin.resolveId('./assets/models/kitchen/test.glb?inline', importer),
  );
  const exported = JSON.parse(binary.code.slice('export default '.length, -1));
  assert.deepEqual(exported, descriptor());
  assert.equal(binary.moduleType, 'js');
  const json = await plugin.load(
    plugin.resolveId('./assets/models/kitchen/manifest.json?inline', importer),
  );
  assert.equal(
    JSON.parse(json.code.slice('export default '.length, -1)),
    Buffer.from('{}').toString('base64'),
  );
  await plugin.writeBundle();
  const index = JSON.parse(await readFile(indexFile, 'utf8'));
  assert.deepEqual(index, {
    schemaVersion: 1,
    assets: [
      {
        ...descriptor(),
        path: 'assets/models/kitchen/test.glb',
        mime: 'model/gltf-binary',
      },
    ],
  });
  await writeFile(join(root, 'outside.glb'), bytes);
  await assert.rejects(
    plugin.load(plugin.resolveId('./outside.glb?inline', importer)),
    /outside the packaged allowlist/,
  );
  const preview = inlineAssets();
  const inline = await preview.load(preview.resolveId('./outside.glb?inline', importer));
  assert.deepEqual(
    Buffer.from(JSON.parse(inline.code.slice('export default '.length, -1)), 'base64'),
    bytes,
  );
});

test('Host registers exact owner-authenticated Connection route and serves only indexed id/hash pairs', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'office-host-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'lib'), { recursive: true });
  await mkdir(join(root, 'assets/models/kitchen'), { recursive: true });
  await writeFile(join(root, 'assets/models/kitchen/test.glb'), bytes);
  const index = {
    schemaVersion: 1,
    assets: [
      {
        ...descriptor(),
        path: 'assets/models/kitchen/test.glb',
        mime: 'model/gltf-binary',
      },
    ],
  };
  await writeFile(join(root, 'lib/asset-index.json'), JSON.stringify(index));
  const host = await sourceModule('index.ts', pathToFileURL(join(root, 'lib/index.js')).href);
  assert.deepEqual(host.inject, ['connection']);
  let route,
    dispose,
    withdrawn = false;
  await host.apply({
    effect: (effect, label) => {
      assert.equal(label, 'office:assets');
      dispose = effect();
    },
    connection: {
      fetch: {
        register: (value) => {
          route = value;
          return () => {
            withdrawn = true;
          };
        },
      },
    },
  });
  assert.equal(route.path, '/api/clutch-dsh-office/assets');
  assert.deepEqual(route.methods, ['GET', 'HEAD']);
  assert.equal(route.requestBody, 'buffered');
  const url =
    'http://office.test' +
    route.path +
    '?' +
    new URLSearchParams({
      assetId: descriptor().assetId,
      sha256: descriptor().sha256,
    });
  const get = await route.fetch(new Request(url));
  assert.equal(get.status, 200);
  assert.deepEqual(Buffer.from(await get.arrayBuffer()), bytes);
  assert.equal(get.headers.get('content-type'), 'model/gltf-binary');
  assert.equal(get.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.equal(get.headers.get('etag'), '"' + descriptor().sha256 + '"');
  const head = await route.fetch(new Request(url, { method: 'HEAD' }));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get('content-length'), String(bytes.length));
  assert.equal((await route.fetch(new Request(url, { method: 'POST' }))).status, 405);
  assert.equal(
    (await route.fetch(new Request(url.replace(descriptor().sha256, '0'.repeat(64))))).status,
    404,
  );
  assert.equal(
    (await route.fetch(new Request(url.replace('test.glb', 'missing.glb')))).status,
    404,
  );
  assert.equal((await route.fetch(new Request(url + '&path=/etc/passwd'))).status, 400);
  assert.equal((await route.fetch(new Request(url + '&assetId=duplicate'))).status, 400);
  assert.throws(
    () =>
      host.createOfficeAssetHandler(
        {
          schemaVersion: 1,
          assets: [{ ...index.assets[0], path: '../secret' }],
        },
        pathToFileURL(root + '/'),
      ),
    /invalid asset index entry/,
  );
  await writeFile(join(root, 'assets/models/kitchen/test.glb'), 'changed');
  assert.equal((await route.fetch(new Request(url))).status, 503);
  await rm(join(root, 'assets/models/kitchen/test.glb'));
  assert.equal((await route.fetch(new Request(url))).status, 404);
  dispose();
  assert.equal(withdrawn, true);
});

test('byte fetch is lazy, document-relative, cookie-authenticated, deduplicated and caches validated CPU bytes', async () => {
  const calls = [];
  const load = createAssetByteLoader(async (...args) => {
    calls.push(args);
    return response();
  });
  assert.equal(calls.length, 0);
  const [a, b] = await Promise.all([load(descriptor()), load(descriptor())]);
  assert.equal(a, b);
  assert.equal(await load(descriptor()), a);
  assert.equal(calls.length, 1);
  assert.ok(calls[0][0].startsWith('api/clutch-dsh-office/assets?'));
  assert.equal(calls[0][1].credentials, 'same-origin');
  assert.deepEqual(Buffer.from(await load(bytes.toString('base64'))), bytes);
});

test('failed HTTP, length and digest validation evict entries so retry can succeed', async () => {
  for (const bad of [
    () => new Response(null, { status: 404 }),
    () => new Response('short'),
    () => new Response(new Uint8Array([9, 9, 9, 9])),
  ]) {
    let count = 0;
    const load = createAssetByteLoader(async () => (++count === 1 ? bad() : response()));
    await assert.rejects(load(descriptor()), /Office asset/);
    assert.deepEqual(Buffer.from(await load(descriptor())), bytes);
    assert.equal(count, 2);
  }
});

test('compressed HTTP Content-Length describes wire bytes; decoded bytes still require exact length/hash', async () => {
  const load = createAssetByteLoader(
    async () =>
      new Response(new Uint8Array(bytes), {
        headers: { 'content-encoding': 'gzip', 'content-length': '24' },
      }),
  );
  assert.deepEqual(Buffer.from(await load(descriptor())), bytes);
});

test('20-second default fetch deadline is bounded and timed-out fetch/body failures evict cache and release slots', async () => {
  for (const phase of ['fetch', 'body']) {
    let calls = 0;
    const load = createAssetByteLoader(
      async () => {
        calls++;
        if (calls > 1) return response();
        if (phase === 'fetch') return new Promise(() => {});
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          arrayBuffer: () => new Promise(() => {}),
        };
      },
      { timeoutMs: 15 },
    );
    await assert.rejects(load(descriptor()), { name: 'TimeoutError' });
    assert.deepEqual(Buffer.from(await load(descriptor())), bytes);
    assert.equal(calls, 2);
  }
});

test('one room cancellation does not cancel another room; last cancellation aborts transport and permits retry', async () => {
  let aborted = 0,
    calls = 0;
  const releases = [];
  const load = createAssetByteLoader((_url, { signal }) => {
    calls++;
    return new Promise((resolve, reject) => {
      releases.push(() => resolve(response()));
      signal.addEventListener(
        'abort',
        () => {
          aborted++;
          reject(signal.reason);
        },
        { once: true },
      );
    });
  });
  const first = new AbortController(),
    second = new AbortController();
  const a = load(descriptor(), first.signal),
    b = load(descriptor(), second.signal);
  first.abort();
  await assert.rejects(a, { name: 'AbortError' });
  assert.equal(aborted, 0);
  releases.shift()();
  await b;
  const third = new AbortController();
  const c = load(descriptor('models/kitchen/other.glb'), third.signal);
  third.abort();
  await assert.rejects(c, { name: 'AbortError' });
  await tick();
  assert.equal(aborted, 1);
  const retry = load(descriptor('models/kitchen/other.glb'));
  releases.pop()();
  await retry;
  assert.equal(calls, 3);
});

test('binary fetches and full GLB pipelines are each bounded to two concurrent jobs; queued canceled jobs do not run', async () => {
  let active = 0,
    peak = 0;
  const load = createAssetByteLoader(async () => {
    active++;
    peak = Math.max(peak, active);
    await tick();
    active--;
    return response();
  });
  await Promise.all(
    Array.from({ length: 8 }, (_, i) => load(descriptor('models/kitchen/asset' + i + '.glb'))),
  );
  assert.equal(peak, 2);
  active = 0;
  peak = 0;
  const canceled = new AbortController();
  const tasks = Array.from({ length: 8 }, (_, i) =>
    withAssetSlot(i === 7 ? canceled.signal : new AbortController().signal, async () => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return i;
    }),
  );
  canceled.abort();
  const settled = await Promise.allSettled(tasks);
  assert.equal(peak, 2);
  assert.equal(settled[7].status, 'rejected');
  assert.equal(settled.filter((r) => r.status === 'fulfilled').length, 7);
});
