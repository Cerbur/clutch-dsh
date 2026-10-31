import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, sep, basename, join } from 'node:path';
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
      id = id.replaceAll('\\', '/');
      importer = importer.replaceAll('\\', '/');
      return (
        prefix +
        (await runtimeModelPath(resolve(dirname(importer), id.slice(0, -'?inline'.length))))
      );
    },
    async load(id) {
      if (!id.startsWith(prefix)) return null;
      let assetPath = id.slice(prefix.length).replaceAll('\\', '/');
      let bytes = await readFile(assetPath);
      let bakeSourceSha256;
      if (
        mode === 'external' &&
        assetPath.includes('/models/kitchen/optimized/') &&
        assetPath.endsWith('.glb')
      ) {
        const transportDir = join(dirname(dirname(assetPath)), 'transport');
        const manifest = JSON.parse(await readFile(join(transportDir, 'manifest.json'), 'utf8'));
        const entry = manifest.assets[basename(assetPath)];
        const hash = (b) => createHash('sha256').update(b).digest('hex');
        if (!entry || hash(bytes) !== entry.sourceSha256)
          throw new Error('Stale texture transport source');
        assetPath = join(transportDir, basename(assetPath));
        bytes = await readFile(assetPath);
        if (hash(bytes) !== entry.sha256 || bytes.length !== entry.bytes)
          throw new Error('Texture transport checksum mismatch');
        bakeSourceSha256 = entry.sourceSha256;
      }
      if (mode === 'external' && !id.endsWith('.json')) {
        const path = relative(resolve(root), assetPath).split(sep).join('/');
        if (
          !/^assets\/(models|lighting)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(glb|png|bin)$/.test(
            path,
          )
        )
          throw new Error('Office binary asset is outside the packaged allowlist: ' + path);
        const assetId = path.slice('assets/'.length);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const descriptor = {
          assetId,
          sha256,
          bytes: bytes.length,
          ...(bakeSourceSha256 ? { bakeSourceSha256 } : {}),
        };
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
