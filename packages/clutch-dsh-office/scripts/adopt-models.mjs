import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
const source = resolve(process.argv[2]);
const root = fileURLToPath(new URL('../assets/models/kitchen', import.meta.url));
const output = join(root, 'optimized');
const report = JSON.parse(await readFile(join(source, 'report.json'), 'utf8'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const manifest = {
  schemaVersion: 1,
  revision: '2026-10-31-meshopt-soft-r3',
  quality: 'medium',
  error: report.error,
  assets: {},
};
for (const asset of report.assets) {
  const original = await readFile(join(root, asset.name));
  const bytes = await readFile(join(source, 'medium', asset.name));
  const facts = asset.variants.medium;
  if (hash(bytes) !== facts.sha256 || facts.validation.errors)
    throw Error('Unvalidated variant: ' + asset.name);
  manifest.assets[asset.name] = {
    sourceSha256: hash(original),
    sha256: hash(bytes),
    bytes: bytes.length,
    triangles: facts.triangles,
    vertices: facts.vertices,
  };
}
await mkdir(output, { recursive: true });
for (const name of Object.keys(manifest.assets))
  await copyFile(join(source, 'medium', name), join(output, name));
await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const reports = fileURLToPath(new URL('../docs/reports', import.meta.url));
await mkdir(reports, { recursive: true });
await writeFile(
  join(reports, '2026-10-31-model-optimization.json'),
  JSON.stringify(report, null, 2) + '\n',
);
process.stdout.write(
  JSON.stringify({ revision: manifest.revision, assets: Object.keys(manifest.assets).length }) +
    '\n',
);
