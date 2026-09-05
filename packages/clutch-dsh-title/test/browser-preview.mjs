import { build } from 'tsdown';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';

const root = fileURLToPath(new URL('..', import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), 'title-preview-'));
await build({
  cwd: root,
  entry: { preview: 'test/browser-fixture.tsx' },
  outDir,
  format: 'esm',
  platform: 'browser',
  dts: false,
  deps: { alwaysBundle: () => true },
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [
    {
      name: 'preview-native-css',
      async resolveId(source, importer) {
        if (!source.endsWith('.css')) return;
        const resolved = source.startsWith('.')
          ? resolve(dirname(importer), source)
          : (await this.resolve(source, importer, { skipSelf: true }))?.id;
        if (resolved) return '\0preview:' + resolved + '.js';
      },
      async load(id) {
        if (!id.startsWith('\0preview:')) return;
        const path = id.slice(9, -3);
        const css = await readFile(path, 'utf8');
        const prefix = basename(path).replaceAll('.', '-');
        const map = Object.fromEntries(
          [...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => [
            match[1],
            `${prefix}-${match[1]}`,
          ]),
        );
        const scoped = css.replace(/\.([A-Za-z_][A-Za-z0-9_-]*)/g, (_, name) => `.${map[name]}`);
        return `const style = document.createElement('style'); style.textContent = ${JSON.stringify(scoped)}; document.head.append(style); export default ${JSON.stringify(map)};`;
      },
    },
  ],
});
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(
      '<!doctype html><html><head><style>:root{--dsw-alias-label-primary:#252525;--dsw-alias-button-primary-fill:#4d6bfe;--dsw-alias-label-primary-foreground:white;--dsw-alias-border-l3:#ddd;--dsw-alias-border-l4:#ddd;--dsw-alias-interactive-bg-hover:#eee}body{margin:0;background:#fafafa;color:#252525;font:14px system-ui}#root{max-width:840px;margin:20px auto;background:white;border:1px solid #ddd;border-radius:16px}button{cursor:pointer}p{line-height:1.6;margin:0}h2{margin:0}</style></head><body><div id="root"></div><script type="module" src="/preview.js"></script></body></html>',
    );
    return;
  }
  if (!/^\/[A-Za-z0-9_-]+\.js$/.test(pathname)) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(join(outDir, pathname.slice(1))));
  } catch {
    res.writeHead(404).end();
  }
});
server.listen(4179, '127.0.0.1', () =>
  process.stdout.write('Template preview: http://127.0.0.1:4179\n'),
);
