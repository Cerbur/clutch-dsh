import { build } from 'tsdown';
import { fileURLToPath, URL } from 'node:url';

const shared = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
];
await build({
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  entry: { client: 'lib/client/entry.js' },
  outDir: 'lib',
  format: 'cjs',
  alias: { yaml: fileURLToPath(new URL('../browser/index.js', import.meta.resolve('yaml'))) },
  platform: 'browser',
  target: 'es2022',
  clean: false,
  dts: false,
  deps: { neverBundle: shared, alwaysBundle: (id) => !shared.includes(id) },
  define: { 'process.env.NODE_ENV': '"production"' },
  outputOptions: {
    entryFileNames: 'client.js',
    banner:
      'window.__ModuleLoader__.load({ id: "@cerbur/clutch-dsh-title", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
});
