import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { runtimeModelPath } from './runtime-models.mjs';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  kitchenAssetName,
} from '../lib/office/kitchen-layout.js';

export const GEOMETRY_SIGNATURE_VERSION = 'three-attributes-sha256-v1';
const signatureAttributes = ['position', 'index', 'normal', 'uv', 'uv1', 'uv2', 'uv3'];

/** In-memory copy only: primitive count, accessors and embedded BIN bytes stay unchanged. */
export function geometryOnlyGlb(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2)
    throw new Error('Expected a GLB 2 delivery');
  const size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size));
  delete doc.materials;
  delete doc.images;
  delete doc.textures;
  delete doc.samplers;
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const result = Buffer.concat([bytes.subarray(0, 20), padded, bytes.subarray(20 + size)]);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(padded.length, 12);
  return result;
}

/**
 * Hash original local attributes, not world positions or expanded corners.
 * For each ordered slot: UTF-8 JSON descriptor + LF, then tightly packed raw
 * typed-array bytes in vertex/component order (little endian), then LF.
 * Missing slots hash [name,null]+LF. Material, UUID and interleaving are excluded.
 */
export function geometrySignature(geometry) {
  const hash = createHash('sha256').update(GEOMETRY_SIGNATURE_VERSION + '\n');
  for (const name of signatureAttributes) {
    const attribute = name === 'index' ? geometry.index : geometry.getAttribute(name);
    if (!attribute) {
      hash.update(JSON.stringify([name, null]) + '\n');
      continue;
    }
    const data = attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array;
    const values = new data.constructor(attribute.count * attribute.itemSize);
    const stride = attribute.isInterleavedBufferAttribute
      ? attribute.data.stride
      : attribute.itemSize;
    const offset = attribute.isInterleavedBufferAttribute ? attribute.offset : 0;
    for (let i = 0; i < attribute.count; i++)
      for (let j = 0; j < attribute.itemSize; j++)
        values[i * attribute.itemSize + j] = data[i * stride + offset + j];
    hash.update(
      JSON.stringify([
        name,
        data.constructor.name,
        attribute.itemSize,
        attribute.count,
        attribute.normalized,
      ]) + '\n',
    );
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    // Typed arrays are native endian. Make the contract independent of the host.
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
      for (let start = 0; start < bytes.length; start += values.BYTES_PER_ELEMENT)
        bytes.subarray(start, start + values.BYTES_PER_ELEMENT).reverse();
    }
    hash.update(bytes).update('\n');
  }
  return hash.digest('hex');
}

export async function exportInstanceGeometry(id, assetId, bytes, rootMatrix) {
  const stripped = geometryOnlyGlb(bytes);
  const { scene, parser } = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
      '',
    );
  const meshes = [];
  const geometries = new Set();
  const materials = new Set();
  try {
    scene.updateMatrixWorld(true);
    scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        materials.add(material);
      if (mesh.isSkinnedMesh || Object.keys(mesh.geometry.morphAttributes).length)
        throw new Error(`${id}: expected static geometry`);
      const mapping = parser.associations.get(mesh);
      if (!Number.isInteger(mapping?.meshes) || !Number.isInteger(mapping?.primitives))
        throw new Error(`${id}: missing source primitive identity`);
      const primitive = parser.json.meshes[mapping.meshes].primitives[mapping.primitives];
      if ((primitive.mode ?? 4) !== 4) throw new Error(`${id}: expected triangle primitives`);
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.index;
      const vertexCount = index ? index.count : position.count;
      if (vertexCount % 3) throw new Error(`${id}: incomplete triangle`);
      const worldMatrix = new Matrix4().multiplyMatrices(rootMatrix, mesh.matrixWorld);
      const positions = new Array(vertexCount * 3);
      const point = new Vector3();
      for (let corner = 0; corner < vertexCount; corner++) {
        point
          .fromBufferAttribute(position, index ? index.getX(corner) : corner)
          .applyMatrix4(worldMatrix);
        if (![point.x, point.y, point.z].every(Number.isFinite))
          throw new Error(`${id}: non-finite position`);
        point.toArray(positions, corner * 3);
      }
      let node = mesh;
      while (node && !Number.isInteger(parser.associations.get(node)?.nodes)) node = node.parent;
      meshes.push({
        // Zero-based runtime Mesh traversal ordinal, not the glTF mesh index.
        meshIndex: meshes.length,
        name: mesh.name,
        source: {
          nodeIndex: node ? parser.associations.get(node).nodes : null,
          meshIndex: mapping.meshes,
          primitiveIndex: mapping.primitives,
        },
        positions,
        vertexCount,
        geometrySignature: geometrySignature(mesh.geometry),
      });
    });
  } finally {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
  return { id, assetId, sha256: createHash('sha256').update(bytes).digest('hex'), meshes };
}

export async function exportLightingGeometry(output = '/tmp/office-bake/geometry.json') {
  const assetRoot = fileURLToPath(new URL('../assets/models/kitchen/', import.meta.url));
  const bytesByAsset = new Map();
  const instances = [];
  for (const [id, position] of Object.entries(KITCHEN_PLACEMENT)) {
    const name = kitchenAssetName(id);
    if (!bytesByAsset.has(name))
      bytesByAsset.set(
        name,
        await readFile(await runtimeModelPath(join(assetRoot, name + '.glb'))),
      );
    const matrix = new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), KITCHEN_ROTATION[id] ?? 0),
      new Vector3(...(KITCHEN_SCALE[id] ?? [1, 1, 1])),
    );
    instances.push(
      await exportInstanceGeometry(id, `kitchen/${name}`, bytesByAsset.get(name), matrix),
    );
  }
  const result = {
    schemaVersion: 1,
    coordinates: { unit: 'meter', up: '+Y', forward: '+Z', space: 'world' },
    geometrySignatureVersion: GEOMETRY_SIGNATURE_VERSION,
    layout: { positions: KITCHEN_PLACEMENT, rotations: KITCHEN_ROTATION, scales: KITCHEN_SCALE },
    instances,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result) + '\n');
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] ?? '/tmp/office-bake/geometry.json');
  const result = await exportLightingGeometry(output);
  process.stdout.write(
    JSON.stringify({
      output,
      instances: result.instances.length,
      meshes: result.instances.reduce((n, instance) => n + instance.meshes.length, 0),
      triangles: result.instances.reduce(
        (n, instance) => n + instance.meshes.reduce((s, mesh) => s + mesh.vertexCount / 3, 0),
        0,
      ),
    }) + '\n',
  );
}
