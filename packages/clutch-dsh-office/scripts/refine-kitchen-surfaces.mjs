import { io } from './optimize-models.mjs';
import { KHRMaterialsClearcoat } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import process from 'node:process';

/** Derive a new input set; never overwrite an adopted source or frozen delivery. */
const input = resolve(process.argv[2] ?? 'assets/models/kitchen');
const output = resolve(process.argv[3] ?? '/tmp/office-surface-input');
if (input === output) throw new Error('Separate output directory required');
await mkdir(output, { recursive: true });
await cp(input, output, { recursive: true });
const doc = await io.readBinary(await readFile(join(input, 'range-hood.glb')));
const material = doc.getRoot().listMaterials()[0];
const base = material.getBaseColorTexture(),
  orm = material.getMetallicRoughnessTexture();
const { data: color, info } = await sharp(base.getImage())
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { data: surface } = await sharp(orm.getImage())
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
let changed = 0;
for (let i = 0; i < color.length; i += 4) {
  const r = color[i],
    g = color[i + 1],
    b = color[i + 2],
    max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (r + g + b) / 3;
  // Preserve saturated whale blue, white belly, black controls and warm task lamps.
  const coating = l > 42 && l < 222 && max - min < 30;
  if (!coating) continue;
  const shade = Math.max(0.78, Math.min(1.14, 0.95 + (l - 100) / 500));
  color[i] = Math.round(70 * shade);
  color[i + 1] = Math.round(85 * shade);
  color[i + 2] = Math.round(106 * shade);
  surface[i] = 255;
  surface[i + 1] = 82;
  surface[i + 2] = 0;
  changed++;
}
base.setImage(
  await sharp(color, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer(),
);
orm.setImage(
  await sharp(surface, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer(),
);
material.setMetallicFactor(1).setRoughnessFactor(1).setNormalScale(0.22);
const ext = doc.createExtension(KHRMaterialsClearcoat);
material.setExtension(
  'KHR_materials_clearcoat',
  ext
    .createClearcoat()
    .setClearcoatFactor(0.12)
    .setClearcoatTexture(orm)
    .setClearcoatRoughnessFactor(1)
    .setClearcoatRoughnessTexture(orm),
);
await writeFile(join(output, 'range-hood.glb'), await io.writeBinary(doc));
process.stdout.write(
  JSON.stringify({
    changedPixels: changed,
    totalPixels: info.width * info.height,
    roughness: 82 / 255,
    metallic: 0,
    coat: 0.12,
    normalScale: 0.22,
  }) + '\n',
);
