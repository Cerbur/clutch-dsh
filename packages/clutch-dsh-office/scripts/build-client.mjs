import { build } from 'tsdown';
import { fileURLToPath, URL } from 'node:url';

const shared = [
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
];
await build({
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  entry: { client: 'lib/client/entry.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  clean: false,
  dts: false,
  deps: { neverBundle: shared, alwaysBundle: (id) => !shared.includes(id) },
  define: { 'process.env.NODE_ENV': '"production"' },
  outputOptions: {
    entryFileNames: 'client.js',
    banner:
      'window.__ModuleLoader__.load({ id: "@cerbur/clutch-dsh-office", factory: (require) => {',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
});
