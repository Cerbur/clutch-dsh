import { build } from 'tsdown';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { inlineAssets } from './inline-assets.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
if (!process.argv[2])
  throw new Error('Usage: node scripts/model-preview.mjs OPTIMIZER_OUTPUT_DIRECTORY');
const models = resolve(process.argv[2]);
const out = await mkdtemp(join(tmpdir(), 'office-model-review-'));
await build({
  cwd: root,
  entry: { review: 'test/model-review.ts' },
  outDir: out,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  plugins: [inlineAssets()],
  deps: { alwaysBundle: () => true },
});
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/')
      return res.end(
        '<!doctype html><meta charset="utf-8"><title>Kitchen model review</title><style>body{margin:0;background:#222;color:#eee;font:14px system-ui}header{padding:12px;display:flex;gap:12px;align-items:center}select,button{font:inherit}canvas{display:block}output{white-space:pre-wrap;font:12px monospace}</style><header><label>Quality <select id="quality"><option>original</option><option>high</option><option selected>medium</option><option>low</option></select></label><label>View <select id="view"><option>review</option><option>front</option><option>right</option><option>back</option><option>window</option><option>hood</option><option>edge</option></select></label><label><input id="wire" type="checkbox">Wireframe</label><label><input id="unlit" type="checkbox">Unlit</label><label><input id="normal" type="checkbox">No normal maps</label><label><input id="shadow" type="checkbox">No shadows</label></header><output id="metrics">Loading…</output><script type="module" src="/review.js"></script>',
      );
    if (url.pathname === '/review.js') {
      res.setHeader('Content-Type', 'text/javascript');
      return res.end(await readFile(join(out, 'review.js')));
    }
    if (url.pathname === '/report.json') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(await readFile(join(models, 'report.json')));
    }
    if (!/^\/(original|high|medium|low)\/[a-z-]+\.glb$/.test(url.pathname))
      return res.writeHead(404).end();
    const path = url.pathname.startsWith('/original/')
      ? join(root, 'assets/models/kitchen', url.pathname.split('/').at(-1))
      : resolve(models, '.' + url.pathname);
    if (!url.pathname.startsWith('/original/') && !path.startsWith(models + sep))
      throw Error('path');
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.end(await readFile(path));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
}).listen(4189, '127.0.0.1', () => process.stdout.write('Model review: http://127.0.0.1:4189\n'));
