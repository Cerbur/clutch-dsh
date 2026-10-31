import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { simplify, reorder, getBounds, cloneDocument } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import validator from 'gltf-validator';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const hash = (b) => createHash('sha256').update(b).digest('hex');
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});

export function modelFacts(doc, bytes) {
  const root = doc.getRoot();
  const primitives = root.listMeshes().flatMap((m) => m.listPrimitives());
  const accessors = new Set(
    primitives.flatMap((p) => [...p.listAttributes(), p.getIndices()].filter(Boolean)),
  );
  return {
    bytes: bytes.length,
    sha256: hash(bytes),
    meshes: root.listMeshes().length,
    primitives: primitives.length,
    vertices: primitives.reduce((n, p) => n + p.getAttribute('POSITION').getCount(), 0),
    triangles: primitives.reduce(
      (n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3,
      0,
    ),
    decodedGeometryBytes: [...accessors].reduce((n, a) => n + a.getArray().byteLength, 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().map((t) => ({
      name: t.getName(),
      mimeType: t.getMimeType(),
      size: t.getSize(),
      bytes: t.getImage()?.length,
      sha256: hash(t.getImage()),
    })),
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
    morphTargets: primitives.reduce((n, p) => n + p.listTargets().length, 0),
    bounds: root.listScenes().map((s) => getBounds(s)),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
    hierarchy: root.listNodes().map((n) => ({
      name: n.getName(),
      translation: n.getTranslation(),
      rotation: n.getRotation(),
      scale: n.getScale(),
      children: n.listChildren().map((c) => c.getName()),
      extras: n.getExtras(),
    })),
  };
}

/** Exact same-index faces share every UV/normal/material value. On a double-sided
 * primitive, opposite winding is redundant too. Removing that duplicate cannot
 * create a hole: the retained triangle covers exactly the same three vertices. */
export function removeDuplicateTriangles(doc) {
  let removed = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      if (primitive.getMode() !== 4 || !primitive.getIndices()) continue;
      const accessor = primitive.getIndices(),
        indices = accessor.getArray(),
        seen = new Set(),
        result = [];
      for (let i = 0; i < indices.length; i += 3) {
        const tri = [indices[i], indices[i + 1], indices[i + 2]];
        let key;
        if (primitive.getMaterial()?.getDoubleSided())
          key = [...tri].sort((a, b) => a - b).join(',');
        else {
          const start = tri.indexOf(Math.min(...tri));
          key = [...tri.slice(start), ...tri.slice(0, start)].join(',');
        }
        if (seen.has(key)) {
          removed++;
          continue;
        }
        seen.add(key);
        result.push(...tri);
      }
      if (result.length !== indices.length) {
        primitive.setIndices(accessor.clone().setArray(new indices.constructor(result)));
        if (accessor.listParents().length === 1) accessor.dispose();
      }
    }
  return removed;
}

function hasCoincidentFaces(doc) {
  for (const mesh of doc.getRoot().listMeshes())
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices()?.getArray(),
        seen = new Set();
      for (let i = 0; indices && i < indices.length; i += 3) {
        const key = [indices[i], indices[i + 1], indices[i + 2]].sort((a, b) => a - b).join(',');
        if (seen.has(key)) return true;
        seen.add(key);
      }
    }
  return false;
}

export async function optimizeModels({
  input,
  output,
  ratios = [0.85, 0.6, 0.35],
  error = 0.001,
  compress = true,
}) {
  if (
    !(error > 0 && error <= 0.01) ||
    ratios.length !== 3 ||
    ratios.some((r) => !(r > 0 && r <= 1))
  )
    throw new Error('Invalid ratios/error');
  const names = (await readdir(input)).filter((n) => n.endsWith('.glb')).sort();
  if (!names.length || resolve(input) === resolve(output))
    throw new Error('Separate input and output paths required');
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const report = {
    schemaVersion: 1,
    error,
    ratios,
    compression: compress
      ? 'EXT_meshopt_compression, lossless float attributes; no quantization'
      : 'none',
    assets: [],
  };
  for (const name of names) {
    const bytes = await readFile(join(input, name));
    const jsonLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const supported = new Set(ALL_EXTENSIONS.map((extension) => extension.EXTENSION_NAME));
    if ((json.extensionsUsed ?? []).some((name) => !supported.has(name)))
      throw new Error('Unsupported extension: ' + name);
    const original = await io.readBinary(bytes);
    original.setLogger(new Logger(Logger.Verbosity.ERROR));
    const before = modelFacts(original, bytes);
    const protectedAsset =
      before.skins > 0 ||
      before.morphTargets > 0 ||
      before.animations > 0 ||
      before.triangles <= 1000 ||
      ['rug.glb', 'floor-mat.glb'].includes(name);
    const asset = { name, original: before, protected: protectedAsset, variants: {} };
    await mkdir(join(output, 'original'), { recursive: true });
    await writeFile(join(output, 'original', name), bytes, { flag: 'wx' }).catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
    if (hash(await readFile(join(output, 'original', name))) !== before.sha256)
      throw new Error('Original snapshot differs: ' + name);
    for (const [i, quality] of ['high', 'medium', 'low'].entries()) {
      let doc,
        removedDuplicateTriangles = 0,
        appliedError = error;
      for (let attempt = 0; attempt < 7; attempt++) {
        doc = cloneDocument(original);
        doc.setLogger(new Logger(Logger.Verbosity.ERROR));
        if (!protectedAsset)
          await doc.transform(
            simplify({
              simplifier: MeshoptSimplifier,
              ratio: ratios[i],
              error: appliedError,
              lockBorder: true,
            }),
          );
        removedDuplicateTriangles = protectedAsset ? 0 : removeDuplicateTriangles(doc);
        if (!hasCoincidentFaces(doc)) break;
        if (attempt === 6) throw new Error('Cannot safely preserve thin surfaces: ' + name);
        appliedError /= 2;
      }
      const simplified = await io.writeBinary(doc);
      // The validator cannot decode EXT_meshopt_compression itself. Validate the
      // actual simplified accessors before encoding, then validate the container.
      const decodedValidation = await validator.validateBytes(new Uint8Array(simplified), {
        maxIssues: 50,
      });
      if (decodedValidation.issues.numErrors)
        throw new Error(
          name + ': invalid simplified geometry ' + JSON.stringify(decodedValidation.issues),
        );
      const plainFacts = modelFacts(doc, simplified);
      await mkdir(join(output, quality + '-uncompressed'), { recursive: true });
      await writeFile(
        join(output, quality + '-uncompressed', name),
        protectedAsset ? bytes : simplified,
      );
      if (
        before.primitives !== plainFacts.primitives ||
        JSON.stringify(before.hierarchy) !== JSON.stringify(plainFacts.hierarchy) ||
        JSON.stringify(before.textures) !== JSON.stringify(plainFacts.textures) ||
        before.materials !== plainFacts.materials
      )
        throw new Error('Semantic/texture loss: ' + name);
      if (compress && !protectedAsset) {
        await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'performance' }));
        doc
          .createExtension(EXTMeshoptCompression)
          .setRequired(true)
          .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
      }
      const final = protectedAsset ? bytes : await io.writeBinary(doc);
      const validation = await validator.validateBytes(new Uint8Array(final), { maxIssues: 50 });
      if (validation.issues.numErrors)
        throw new Error(name + ': ' + JSON.stringify(validation.issues));
      const decoded = await io.readBinary(final);
      const facts = modelFacts(decoded, final);
      if (facts.triangles > before.triangles || facts.primitives !== before.primitives)
        throw new Error('Invalid optimized geometry: ' + name);
      await mkdir(join(output, quality), { recursive: true });
      await writeFile(join(output, quality, name), final);
      asset.variants[quality] = {
        ...facts,
        simplifiedBytes: simplified.length,
        removedFraction: 1 - facts.triangles / before.triangles,
        removedDuplicateTriangles,
        appliedError,
        validation: {
          errors: validation.issues.numErrors,
          warnings: validation.issues.numWarnings,
          messages: validation.issues.messages,
          decodedErrors: decodedValidation.issues.numErrors,
          decodedWarnings: decodedValidation.issues.numWarnings,
        },
      };
    }
    report.assets.push(asset);
    process.stdout.write(
      `${name}: ${before.triangles} -> ${asset.variants.medium.triangles} triangles\n`,
    );
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      output: { type: 'string' },
      ratios: { type: 'string' },
      error: { type: 'string' },
      'no-compress': { type: 'boolean' },
    },
  });
  if (!values.input || !values.output)
    throw new Error(
      'Usage: node scripts/optimize-models.mjs --input DIR --output DIR [--ratios .85,.6,.35] [--error .001] [--no-compress]',
    );
  await optimizeModels({
    input: resolve(values.input),
    output: resolve(values.output),
    ratios: values.ratios?.split(',').map(Number),
    error: values.error ? Number(values.error) : 0.001,
    compress: !values['no-compress'],
  });
}
