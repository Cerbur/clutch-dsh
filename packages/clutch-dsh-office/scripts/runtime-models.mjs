import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';

/** Build/export/import share one reviewed derivative selection, never a runtime filesystem URL. */
export async function runtimeModelPath(path) {
  // Node on Windows accepts forward slashes too. Normalize before classifying:
  // skipping this selection also invalidates the bake's reviewed source hashes.
  path = path.replaceAll('\\', '/');
  if (!path.endsWith('.glb') || !path.includes('/models/kitchen/') || path.includes('/optimized/'))
    return path;
  let manifest;
  try {
    manifest = JSON.parse(await readFile(join(dirname(path), 'optimized/manifest.json'), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return path;
    throw e;
  }
  const entry = manifest.assets[basename(path)];
  if (!entry) throw new Error('Missing reviewed kitchen derivative: ' + basename(path));
  const hash = (b) => createHash('sha256').update(b).digest('hex');
  if (hash(await readFile(path)) !== entry.sourceSha256)
    throw new Error('Stale derivative source: ' + path);
  const result = join(dirname(path), 'optimized', basename(path));
  if (hash(await readFile(result)) !== entry.sha256)
    throw new Error('Derivative checksum mismatch: ' + path);
  return result;
}
