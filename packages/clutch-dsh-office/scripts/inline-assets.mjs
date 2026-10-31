import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep } from 'node:path';
import { runtimeModelPath } from './runtime-models.mjs';

/** DSH owns module loading; inline the fixed MVP asset without a Host file route. */
export function inlineAssets({ mode = 'inline', root, indexFile } = {}) {
  if (mode !== 'inline' && mode !== 'external') throw new Error('Invalid Office asset mode');
  if (mode === 'external' && (!root || !indexFile))
    throw new Error('Office asset root/index required');
  const prefix = '\0office-glb:';
  const assets = new Map();
  return {
    name: 'office-inline-glb',
    async resolveId(id, importer) {
      if (!/\.(glb|png|bin|json)\?inline$/.test(id) || !importer) return null;
      return (
        prefix +
        (await runtimeModelPath(resolve(dirname(importer), id.slice(0, -'?inline'.length))))
      );
    },
    async load(id) {
      if (!id.startsWith(prefix)) return null;
      const bytes = await readFile(id.slice(prefix.length));
      if (mode === 'external' && !id.endsWith('.json')) {
        const path = relative(resolve(root), id.slice(prefix.length)).split(sep).join('/');
        if (
          !/^assets\/(models|lighting)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(glb|png|bin)$/.test(
            path,
          )
        )
          throw new Error('Office binary asset is outside the packaged allowlist: ' + path);
        const assetId = path.slice('assets/'.length);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const descriptor = { assetId, sha256, bytes: bytes.length };
        const mime = path.endsWith('.glb')
          ? 'model/gltf-binary'
          : path.endsWith('.png')
            ? 'image/png'
            : 'application/octet-stream';
        assets.set(assetId, { ...descriptor, path, mime });
        return {
          code: `export default ${JSON.stringify(descriptor)};`,
          moduleType: 'js',
        };
      }
      return {
        code: `export default ${JSON.stringify(bytes.toString('base64'))};`,
        moduleType: 'js',
      };
    },
    async writeBundle() {
      if (mode !== 'external') return;
      await mkdir(dirname(indexFile), { recursive: true });
      await writeFile(
        indexFile,
        JSON.stringify(
          {
            schemaVersion: 1,
            assets: [...assets.values()].sort((a, b) => a.assetId.localeCompare(b.assetId)),
          },
          null,
          2,
        ) + '\n',
      );
    },
  };
}
