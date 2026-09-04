import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'tsdown';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const packageManifest = JSON.parse(
  await readFile(path.join(packageDirectory, 'package.json'), 'utf8'),
);
const clientId = packageManifest.name;
const CSS_PREFIX = '\0clutch-dsh-fireworks-css:';
const CSS_SUFFIX = '.mjs';
const clientExternals = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
];

await build({
  name: `${clientId}/client`,
  cwd: packageDirectory,
  entry: { client: 'lib/client/entry.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  clean: false,
  dts: false,
  sourcemap: true,
  deps: {
    neverBundle: clientExternals,
    alwaysBundle: (id) => !clientExternals.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [
    {
      name: 'clutch-dsh-fireworks-css',
      resolveId(source, importer) {
        if (!source.endsWith('.css')) return null;
        const emitted =
          importer === undefined
            ? path.resolve(packageDirectory, source)
            : path.resolve(path.dirname(importer), source);
        const candidate = existsSync(emitted)
          ? emitted
          : path.resolve(packageDirectory, 'src/client', source.replace(/^\.\//, ''));
        return `${CSS_PREFIX}${candidate}${CSS_SUFFIX}`;
      },
      async load(id) {
        if (!id.startsWith(CSS_PREFIX) || !id.endsWith(CSS_SUFFIX)) return null;
        const fileId = id.slice(CSS_PREFIX.length, -CSS_SUFFIX.length);
        this.addWatchFile(fileId);
        const css = await readFile(fileId, 'utf8');
        const classNames = [...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)]
          .map((match) => match[1])
          .filter((className, index, names) => names.indexOf(className) === index);
        const classMap = Object.fromEntries(
          classNames.map((className) => [
            className,
            `${clientId.replaceAll(/[^A-Za-z0-9_-]/g, '-')}-${className}`,
          ]),
        );
        const scopedCss = css.replace(
          /\.([A-Za-z_][A-Za-z0-9_-]*)/g,
          (_match, className) => `.${classMap[className]}`,
        );
        const styleId = `${clientId}/${path.basename(fileId)}`;
        return [
          `const css = ${JSON.stringify(scopedCss)};`,
          `const styleId = ${JSON.stringify(styleId)};`,
          "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=\"' + styleId + '\"]') === null) {",
          "  const tag = document.createElement('style');",
          `  tag.dataset.plugin = ${JSON.stringify(clientId)};`,
          '  tag.dataset.pluginCss = styleId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n');
      },
    },
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(clientId)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
});
