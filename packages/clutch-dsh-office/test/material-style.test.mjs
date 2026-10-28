import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { materialGeometrySignature } from '../scripts/validate-material-revision.mjs';

function unpack(bytes) {
  const size = bytes.readUInt32LE(12);
  return { doc: JSON.parse(bytes.subarray(20, 20 + size)), bin: bytes.subarray(28 + size) };
}

function pack(doc, bin) {
  const json = Buffer.from(JSON.stringify(doc));
  const header = Buffer.alloc(20);
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(bin.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, binaryHeader, bin]);
}

test('material audit permits surface edits but detects changed shape, UVs and pivots', async () => {
  const bytes = await readFile(new URL('../assets/models/kitchen/stove.glb', import.meta.url));
  const initial = materialGeometrySignature(bytes);
  const material = unpack(bytes);
  material.doc.materials[0].pbrMetallicRoughness.roughnessFactor = 0.51;
  assert.equal(materialGeometrySignature(pack(material.doc, material.bin)), initial);
  const moved = unpack(bytes);
  moved.doc.nodes[0].translation = [0.1, 0, 0];
  assert.notEqual(materialGeometrySignature(pack(moved.doc, moved.bin)), initial);
  const changedPosition = unpack(bytes);
  const position =
    changedPosition.doc.accessors[changedPosition.doc.meshes[0].primitives[0].attributes.POSITION];
  const view = changedPosition.doc.bufferViews[position.bufferView];
  const bin = Buffer.from(changedPosition.bin);
  const offset = (view.byteOffset ?? 0) + (position.byteOffset ?? 0);
  bin.writeFloatLE(bin.readFloatLE(offset) + 0.1, offset);
  assert.notEqual(materialGeometrySignature(pack(changedPosition.doc, bin)), initial);
  const tableBytes = await readFile(new URL('../assets/models/kitchen/table.glb', import.meta.url));
  const tableSignature = materialGeometrySignature(tableBytes);
  const changedUv = unpack(tableBytes);
  const uvPrimitive = changedUv.doc.meshes
    .flatMap((m) => m.primitives)
    .find((p) => p.attributes.TEXCOORD_0 !== undefined);
  assert.ok(uvPrimitive, 'table has authored UVs to audit');
  const uv = changedUv.doc.accessors[uvPrimitive.attributes.TEXCOORD_0];
  const v = changedUv.doc.bufferViews[uv.bufferView];
  const uvBin = Buffer.from(changedUv.bin);
  uvBin[(v.byteOffset ?? 0) + (uv.byteOffset ?? 0)] ^= 1;
  assert.notEqual(materialGeometrySignature(pack(changedUv.doc, uvBin)), tableSignature);
});
