import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { configureKitchenMaterial } from '../lib/client/scene/area-shadow.js';
import { Models } from '../lib/client/scene/models.js';

test('packed candy surface loads as physical PBR and shares three image sources through disposal', async (t) => {
  const bytes = await readFile(
    new URL('../assets/models/kitchen/refrigerator.glb', import.meta.url),
  );
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis });
  t.after(() => {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else delete globalThis.self;
  });
  // Image decoding is verified independently in Blender and the real browser.
  // Keep the actual glTF extension, sampler, shader-hook and ownership paths here.
  let decoded = 0,
    closed = 0;
  const loader = new GLTFLoader();
  loader.register((parser) => {
    parser.textureLoader = {
      load(_url, onLoad) {
        decoded++;
        const texture = new T.Texture({
          width: 4,
          height: 4,
          close() {
            closed++;
          },
        });
        queueMicrotask(() => onLoad(texture));
        return texture;
      },
    };
    return { name: 'TEST_EMBEDDED_IMAGE_DECODER' };
  });
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  const materials = new Set();
  gltf.scene.traverse((object) => {
    if (object.isMesh) materials.add(object.material);
  });
  assert.equal(materials.size, 1);
  const [material] = materials;
  assert.ok(material.isMeshPhysicalMaterial);
  assert.equal(material.clearcoat, 0.15);
  assert.equal(material.clearcoatRoughness, 1);
  assert.equal(material.clearcoatMap, material.roughnessMap);
  assert.equal(material.clearcoatRoughnessMap, material.roughnessMap);
  assert.equal(material.metalnessMap, material.roughnessMap);
  assert.equal(material.aoMap, null, 'packed R has no AO consumer');
  assert.equal(decoded, 3, 'coating adds no image download/decoder');
  configureKitchenMaterial(material);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /kitchenAreaVisibility/);
  assert.match(shader.fragmentShader, /clearcoat_pars_fragment/);
  const owner = new Models();
  owner.ownObject(gltf.scene);
  const textures = new Set([material.map, material.normalMap, material.roughnessMap]);
  let released = 0;
  for (const texture of textures) texture.addEventListener('dispose', () => released++);
  owner.dispose();
  owner.dispose();
  assert.equal(released, 3);
  assert.equal(closed, 3);
});

// Regression for the semantic-mask bug found in the first sample candidate.
// The generated surface PNG uses RGB8/Sub rows; inspect its actual authored texels.
test('candy coat excludes metallic handles and preserves their original roughness', async () => {
  const { inflateSync } = await import('node:zlib');
  const bytes = await readFile(
    new URL('../assets/models/kitchen/refrigerator.glb', import.meta.url),
  );
  const jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength);
  const material = doc.materials[0];
  const image =
    doc.images[doc.textures[material.pbrMetallicRoughness.metallicRoughnessTexture.index].source];
  const view = doc.bufferViews[image.bufferView];
  const png = bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
  const width = png.readUInt32BE(16),
    height = png.readUInt32BE(20);
  assert.equal(png[24], 8);
  assert.equal(png[25], 2);
  const idats = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT')
      idats.push(png.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const packed = inflateSync(Buffer.concat(idats));
  assert.equal(packed.length, height * (width * 3 + 1));
  let metallic = 0,
    coated = 0;
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1);
    assert.equal(packed[start], 1, 'surface authoring uses Sub filtering');
    const row = Buffer.from(packed.subarray(start + 1, start + 1 + width * 3));
    for (let i = 3; i < row.length; i++) row[i] = (row[i] + row[i - 3]) & 255;
    for (let i = 0; i < row.length; i += 3) {
      if (row[i + 2] > 25) {
        metallic++;
        assert.equal(row[i], 0, 'no clearcoat on authored metallic handles');
        assert.equal(row[i + 1], 110, 'original handle roughness .43 remains');
      }
      if (row[i] > 127) {
        coated++;
        assert.equal(row[i + 2], 0, 'coat only on dielectric paint');
        assert.ok(row[i + 1] >= 67 && row[i + 1] <= 86, 'paint has bounded enamel/toy roughness');
      }
    }
  }
  assert.ok(metallic > 20000, 'metal region was preserved, not erased');
  assert.ok(coated > 400000, 'paint sample was not replaced with an empty mask');
});
