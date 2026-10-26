import { build } from 'tsdown';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), 'office-preview-'));
await build({
  cwd: root,
  entry: { preview: 'test/browser-fixture.tsx' },
  outDir,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  deps: { alwaysBundle: () => true },
  define: { 'process.env.NODE_ENV': '"production"' },
});
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><html lang="zh"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSH Office · Kitchen preview</title><style>body{margin:0;background:#f7f8fa}#root{height:100vh}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>',
    );
    return;
  }
  if (!/^\/[\w-]+\.js$/.test(path)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(join(outDir, path.slice(1)));
    res.setHeader('Content-Type', 'text/javascript');
    res.end(body);
  } catch (error) {
    if (error.code !== 'ENOENT') process.stderr.write(String(error) + '\n');
    res.writeHead(404).end();
  }
});
server.listen(4188, '127.0.0.1', () =>
  process.stdout.write('Office preview: http://127.0.0.1:4188\n'),
);
