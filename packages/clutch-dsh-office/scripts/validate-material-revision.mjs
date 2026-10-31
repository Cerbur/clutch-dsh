import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { validateAsset } from './sync-asset.mjs';

/** Hash authored geometry and hierarchy independently of material/image/color edits. */
export function materialGeometrySignature(bytes) {
  const jsonSize = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonSize));
  const binary = bytes.subarray(28 + jsonSize);
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const accessor = (index) => {
    const a = doc.accessors[index];
    if (a.sparse || !widths[a.type] || !sizes[a.componentType])
      throw new Error('Unsupported geometry encoding for material-only audit');
    const v = doc.bufferViews[a.bufferView];
    const width = widths[a.type] * sizes[a.componentType];
    const stride = v.byteStride ?? width;
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const digest = createHash('sha256');
    for (let i = 0; i < a.count; i++)
      digest.update(binary.subarray(start + i * stride, start + i * stride + width));
    return {
      type: a.type,
      count: a.count,
      componentType: a.componentType,
      normalized: a.normalized ?? false,
      sha256: digest.digest('hex'),
    };
  };
  const attributes = (items) =>
    Object.fromEntries(
      Object.entries(items)
        .filter(([key]) => !key.startsWith('COLOR_'))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, accessor(value)]),
    );
  const signature = {
    nodes: doc.nodes.map(
      ({ name, children, mesh, skin, matrix, translation, rotation, scale }) => ({
        name,
        children,
        mesh,
        skin,
        matrix,
        translation,
        rotation,
        scale,
      }),
    ),
    scenes: doc.scenes,
    scene: doc.scene ?? 0,
    meshes: doc.meshes.map(({ name, primitives }) => ({
      name,
      primitives: primitives.map((p) => ({
        mode: p.mode ?? 4,
        indices: accessor(p.indices),
        attributes: attributes(p.attributes),
        targets: p.targets?.map(attributes),
      })),
    })),
    skins: doc.skins?.map((s) => ({
      ...s,
      inverseBindMatrices:
        s.inverseBindMatrices === undefined ? undefined : accessor(s.inverseBindMatrices),
    })),
    animations: doc.animations?.map((a) => ({
      ...a,
      samplers: a.samplers.map((s) => ({
        ...s,
        input: accessor(s.input),
        output: accessor(s.output),
      })),
    })),
  };
  return hash(JSON.stringify(signature));
}

export async function validateMaterialRevision(parentPath, childPath) {
  const load = async (path) => {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    const bytes = await readFile(join(dirname(path), manifest.file));
    return { manifest, bytes, facts: validateAsset(manifest, bytes) };
  };
  const parent = await load(parentPath);
  const child = await load(childPath);
  assert.equal(parent.manifest.assetId, child.manifest.assetId, 'component identity changed');
  assert.deepEqual(
    parent.manifest.coordinates,
    child.manifest.coordinates,
    'origin/axis contract changed',
  );
  const before = materialGeometrySignature(parent.bytes);
  const after = materialGeometrySignature(child.bytes);
  assert.equal(before, after, 'material revision changed geometry, UVs, transforms or hierarchy');
  assert.notEqual(parent.facts.sha256, child.facts.sha256, 'no material byte change');
  return {
    assetId: child.facts.assetId,
    parentRevision: parent.facts.revision,
    parentSha256: parent.facts.sha256,
    revision: child.facts.revision,
    sha256: child.facts.sha256,
    geometrySignature: after,
    geometryUnchanged: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3])
    throw new Error(
      'Usage: node scripts/validate-material-revision.mjs parent/manifest.json child/manifest.json',
    );
  process.stdout.write(
    JSON.stringify(
      await validateMaterialRevision(resolve(process.argv[2]), resolve(process.argv[3])),
      null,
      2,
    ) + '\n',
  );
}
