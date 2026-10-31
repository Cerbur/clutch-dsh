import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';
import { inflateSync } from 'node:zlib';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { inspectGlb, validateAsset, ASSET_RULES } from '../scripts/sync-asset.mjs';
import { geometryOnlyGlb } from '../scripts/export-lighting-geometry.mjs';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  KITCHEN_STATIONS,
} from '../lib/office/kitchen-layout.js';

// An explicit candidate path permits geometry review before importing a delivery.
// It never substitutes a candidate for the installed-manifest/importer acceptance.
const candidate = process.env.OFFICE_STOVE_REFINED_GLB;
const revision = '2026-10-29-refined-r1';
const height = 0.8915539979934692;
const halfWidth = 1.6235548318476112;
const depth = 0.9996259421448968;
const anchors = {
  work_surface: [0, height, 0],
  cook_anchor: [-0.3206600844860077, 0.8937187194824219, 0.015284470282495022],
  burner_left: [-0.3206600844860077, 0.8937187194824219, 0.015284470282495022],
  burner_right: [0.40964606404304504, 0.8937187194824219, 0.015284470282495022],
  front_anchor: [0, 0, 0.4998129606246948],
  join_right: [1.704795002937317, 0.8911539912223816, 0],
  counter_back_left: [-1.6235548257827759, height, -0.4998129606246948],
  counter_front_left: [-1.6235548257827759, height, 0.4998129606246948],
};
const capMin = [-2.2779968239212955, 0.9157540108680725, -1.0640000014762316];
const capMax = [-1.302370891704651, 0.9166539813995361, -0.9850535302619373];

function close(actual, expected, label, tolerance = 1e-6) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual}, expected ${expected} ± ${tolerance}`,
  );
}
function closeVector(actual, expected, label, tolerance) {
  actual.forEach((value, i) => close(value, expected[i], `${label}[${i}]`, tolerance));
}
function transform(id) {
  return new T.Matrix4().compose(
    new T.Vector3(...KITCHEN_PLACEMENT[id]),
    new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), KITCHEN_ROTATION[id] ?? 0),
    new T.Vector3(...(KITCHEN_SCALE[id] ?? [1, 1, 1])),
  );
}
let loading;
function asset() {
  return (loading ??= (async () => {
    const bytes = await readFile(
      candidate ?? new URL('../assets/models/kitchen/stove.glb', import.meta.url),
    );
    const facts = inspectGlb(bytes);
    const jsonLength = bytes.readUInt32LE(12);
    const doc = JSON.parse(bytes.subarray(20, 20 + jsonLength));
    const stripped = geometryOnlyGlb(bytes);
    const { scene } = await new GLTFLoader().parseAsync(
      stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
      '',
    );
    scene.updateMatrixWorld(true);
    const meshes = [];
    scene.traverse((object) => {
      if (object.isMesh) meshes.push(object);
    });
    return { bytes, doc, facts, scene, meshes, binStart: 28 + jsonLength };
  })());
}
after(async () => {
  if (!loading) return;
  const loaded = await loading.catch(() => null);
  for (const mesh of loaded?.meshes ?? []) {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      material.dispose();
  }
});
function points(mesh) {
  const position = mesh.geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) =>
    new T.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld),
  );
}
function ray(mesh, origin, direction) {
  return new T.Raycaster(
    new T.Vector3(...origin),
    new T.Vector3(...direction),
    0,
    3,
  ).intersectObject(mesh, true)[0]?.point;
}

test('refined stove has three drawing batches and independent 40k/4MiB ceilings', async () => {
  const { facts, bytes, doc, meshes } = await asset();
  for (const key of ['meshes', 'materials', 'primitives', 'images'])
    assert.equal(facts[key], 3, key);
  assert.equal(meshes.length, 3, 'no hidden editable parts are exported');
  assert.ok(bytes.length <= 4 * 1024 * 1024, `${bytes.length} bytes exceed 4MiB`);
  assert.ok(
    facts.triangles > 0 && facts.triangles <= 40000,
    `${facts.triangles} triangles exceed 40000`,
  );
  assert.equal(doc.animations?.length ?? 0, 0);
  assert.equal(doc.skins?.length ?? 0, 0);
  for (const mesh of doc.meshes)
    for (const primitive of mesh.primitives) assert.equal(primitive.targets, undefined);
});

test(
  'installed refined manifest and importer independently describe the actual GLB',
  { skip: candidate ? 'candidate geometry review; installed delivery not substituted' : false },
  async () => {
    const { bytes, facts } = await asset();
    const manifest = JSON.parse(
      await readFile(new URL('../assets/models/kitchen/stove.manifest.json', import.meta.url)),
    );
    assert.equal(manifest.revision, revision);
    const verified = validateAsset(manifest, bytes);
    assert.equal(verified.triangles, facts.triangles);
    const rule = ASSET_RULES['kitchen/stove'].revisions[revision];
    assert.ok(rule, 'refined revision must not fall back to the legacy movable stove rule');
    for (const key of ['meshes', 'materials', 'primitives', 'images'])
      assert.equal(rule[key], 3, key);
    assert.equal(manifest.capabilities.staticAssembly, true);
    for (const key of ['semanticHinges', 'animationClips', 'rigged', 'emissiveFlames', 'cookware'])
      assert.equal(manifest.capabilities[key], false, key);
    const required = [
      '灶台总成',
      '灶台静态总成',
      '转角接缝台面',
      '烤箱烟色玻璃',
      ...Object.keys(anchors),
    ];
    for (const name of required) {
      assert.ok(rule.nodes.includes(name), `importer requires ${name}`);
      assert.ok(manifest.requiredNodes.includes(name), `manifest requires ${name}`);
    }
    for (const [name, expected] of Object.entries(anchors))
      closeVector(manifest.anchors[name], expected, name);
    close(manifest.countertop.width, 2 * halfWidth, 'declared countertop length');
    close(manifest.countertop.depth, depth, 'declared countertop depth');
  },
);

test('refined semantic meshes and historical installation anchors survive without hinges', async () => {
  const { scene, doc } = await asset();
  assert.equal(new Set(doc.nodes.map((node) => node.name)).size, doc.nodes.length);
  assert.ok(scene.getObjectByName('灶台总成'));
  for (const name of ['灶台静态总成', '转角接缝台面', '烤箱烟色玻璃']) {
    const mesh = scene.getObjectByName(name);
    assert.equal(mesh?.isMesh, true, name);
    assert.ok(mesh.geometry.index.count >= 3, `${name} has real geometry`);
  }
  for (const [name, expected] of Object.entries(anchors)) {
    const node = scene.getObjectByName(name);
    assert.ok(node, name);
    closeVector(node.getWorldPosition(new T.Vector3()).toArray(), expected, name);
  }
  for (const name of ['左柜门', '右柜门', '左抽屉', '右抽屉', '烤箱门', '蓝色火焰', '炒锅'])
    assert.equal(scene.getObjectByName(name), undefined, `${name} is not an articulated part`);
});

test('refined indexed geometry has finite attributes, valid indices and no zero-area triangles', async () => {
  const { meshes } = await asset();
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.index;
    assert.equal(position.itemSize, 3);
    assert.ok(position.count > 0);
    assert.equal(index.count % 3, 0, mesh.name);
    for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
      assert.equal(attribute.count, position.count, `${mesh.name}/${name} vertex count`);
      const components = ['getX', 'getY', 'getZ', 'getW'].slice(0, attribute.itemSize);
      for (let i = 0; i < attribute.count; i++)
        for (const component of components)
          assert.ok(Number.isFinite(attribute[component](i)), `${mesh.name}/${name}/${i}`);
    }
    const vertices = points(mesh);
    let degenerate = 0;
    for (let i = 0; i < index.count; i += 3) {
      const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (const value of indices)
        assert.ok(Number.isInteger(value) && value >= 0 && value < position.count, mesh.name);
      const [a, b, c] = indices.map((value) => vertices[value]);
      const doubleArea = b.clone().sub(a).cross(c.clone().sub(a)).length();
      if (doubleArea < 1e-12) degenerate++;
    }
    assert.equal(degenerate, 0, `${mesh.name}: zero-area or sub-1e-12 m² cross products`);
  }
});

test('refined normals are finite unit vectors and agree with nontrivial face winding', async () => {
  const { meshes } = await asset();
  for (const mesh of meshes) {
    const normal = mesh.geometry.getAttribute('normal');
    assert.ok(normal, mesh.name);
    const matrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const normals = Array.from({ length: normal.count }, (_, i) => {
      const n = new T.Vector3().fromBufferAttribute(normal, i);
      close(n.length(), 1, `${mesh.name}/normal/${i}`, 1e-4);
      return n.applyMatrix3(matrix).normalize();
    });
    const vertices = points(mesh);
    const index = mesh.geometry.index;
    let reversed = 0;
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const [a, b, c] = ids.map((id) => vertices[id]);
      const face = b.clone().sub(a).cross(c.clone().sub(a));
      // Tiny bevel slivers are covered by the degeneracy gate. Averaging allows
      // authored smooth/weighted corner normals instead of requiring flat shading.
      if (face.length() < 1e-9) continue;
      const average = ids.reduce((sum, id) => sum.add(normals[id]), new T.Vector3());
      if (face.normalize().dot(average.normalize()) < -0.01) reversed++;
    }
    assert.equal(reversed, 0, `${mesh.name}: normals oppose triangle winding`);
  }
});

test('actual countertop spans the long run and both physical burners retain anchor X/Z', async () => {
  const { scene } = await asset();
  const main = scene.getObjectByName('灶台静态总成');
  const slab = points(main).filter((p) => p.y >= height - 0.061 && p.y <= height + 1e-6);
  assert.ok(slab.length > 0);
  const bounds = new T.Box3().setFromPoints(slab);
  close(bounds.min.x, -halfWidth, 'actual countertop left end');
  close(bounds.max.x, halfWidth, 'actual countertop right end');
  close(bounds.min.z, -depth / 2, 'actual countertop back');
  close(bounds.max.z, depth / 2, 'actual countertop front');
  for (const x of [-1.59, -1.3, -0.9, -0.4, 0, 0.4, 0.9, 1.3, 1.59]) {
    const hit = ray(main, [x, 1.5, -0.46], [0, -1, 0]);
    assert.ok(hit, `continuous countertop at X=${x}`);
    close(hit.y, height, `worktop surface at X=${x}`);
  }
  for (const name of ['burner_left', 'burner_right']) {
    const [x, , z] = anchors[name];
    const center = ray(main, [x, 1.5, z], [0, -1, 0]);
    assert.ok(center && center.y > height + 0.09 && center.y < height + 0.13, name);
    for (const [dx, dz] of [
      [0.07, 0],
      [0, 0.07],
    ]) {
      const a = ray(main, [x + dx, 1.5, z + dz], [0, -1, 0]);
      const b = ray(main, [x - dx, 1.5, z - dz], [0, -1, 0]);
      assert.ok(a && b && a.y > height + 0.09 && b.y > height + 0.09, `${name} disk`);
      close(a.y, b.y, `${name} disk centered on historical anchor`, 2e-5);
    }
  }
});

test('merged cabinet contains matching real door panels, recessed reveals and mirrored handles', async () => {
  const { scene } = await asset();
  const main = scene.getObjectByName('灶台静态总成');
  const vertices = points(main);
  for (const center of [-1.164, 1.164]) {
    const region = vertices.filter(
      (p) => Math.abs(p.x - center) < 0.405 && p.y > 0.1 && p.y < 0.64 && p.z > 0.449 && p.z < 0.51,
    );
    assert.ok(region.length > 0, `door geometry at ${center}`);
    const box = new T.Box3().setFromPoints(region);
    close((box.min.x + box.max.x) / 2, center, 'measured door center', 2e-5);
    close(box.max.x - box.min.x, 0.777, 'measured door width', 2e-5);
    close(box.max.y - box.min.y, 0.517, 'measured door height', 2e-5);
  }
  for (const y of [0.14, 0.2, 0.3, 0.379, 0.49, 0.6, 0.68, 0.727, 0.78]) {
    for (const dx of [-0.36, -0.3, -0.15, 0, 0.15, 0.3, 0.36]) {
      const left = ray(main, [-1.164 + dx, y, 1], [0, 0, -1]);
      const right = ray(main, [1.164 - dx, y, 1], [0, 0, -1]);
      assert.ok(left && right && left.z > 0.47 && right.z > 0.47, `front panel ${dx}/${y}`);
      close(left.z, right.z, `mirror surface ${dx}/${y}`, 2e-5);
    }
  }
  for (const center of [-1.164, 1.164]) {
    const front = (x, y) => ray(main, [x, y, 1], [0, 0, -1])?.z;
    assert.ok(front(center, 0.65) < 0.46, 'real door/drawer reveal is recessed');
    assert.ok(front(center, 0.727) > 0.53, 'drawer has a projecting pull');
    const knobX = center - Math.sign(center) * 0.295;
    assert.ok(front(knobX, 0.49) > 0.53, 'door knob is on the inner opening edge');
  }
});

test('old seam cap retains its exact world-space cuboid, all six faces and outward winding', async () => {
  const { scene } = await asset();
  const cap = scene.getObjectByName('转角接缝台面');
  const vertices = points(cap).map((p) => p.applyMatrix4(transform('stove')));
  const box = new T.Box3().setFromPoints(vertices);
  closeVector(box.min.toArray(), capMin, 'cap world min', 1e-7);
  closeVector(box.max.toArray(), capMax, 'cap world max', 1e-7);
  const corners = [];
  for (const x of [capMin[0], capMax[0]])
    for (const y of [capMin[1], capMax[1]])
      for (const z of [capMin[2], capMax[2]]) corners.push(new T.Vector3(x, y, z));
  const cornerIds = vertices.map((p) => {
    const id = corners.findIndex((corner) => p.distanceTo(corner) < 1e-7);
    assert.ok(id >= 0, 'cap vertices remain on the eight original corners');
    return id;
  });
  assert.equal(new Set(cornerIds).size, 8);
  const index = cap.geometry.index;
  assert.equal(index.count, 36, 'original twelve cap triangles');
  const edges = new Map();
  const faces = new Map();
  let volume = 0;
  const center = box.getCenter(new T.Vector3());
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const [a, b, c] = ids.map((id) => vertices[id].clone().sub(center));
    const face = b.clone().sub(a).cross(c.clone().sub(a));
    assert.ok(face.dot(a.clone().add(b).add(c)) > 0, 'cap triangle faces outward');
    const plane = [0, 1, 2].flatMap((axis) =>
      [capMin[axis], capMax[axis]].flatMap((value, side) =>
        ids.every((id) => Math.abs(vertices[id].getComponent(axis) - value) < 1e-7)
          ? [`${axis}/${side}`]
          : [],
      ),
    );
    assert.equal(plane.length, 1, 'each cap triangle stays on an original face');
    faces.set(plane[0], (faces.get(plane[0]) ?? 0) + face.length() / 2);
    volume += a.dot(b.clone().cross(c)) / 6;
    for (let edge = 0; edge < 3; edge++) {
      const from = cornerIds[ids[edge]],
        to = cornerIds[ids[(edge + 1) % 3]];
      const key = [Math.min(from, to), Math.max(from, to)].join('/');
      const value = edges.get(key) ?? { count: 0, winding: 0 };
      value.count++;
      value.winding += from < to ? 1 : -1;
      edges.set(key, value);
    }
  }
  for (const [edge, value] of edges) {
    assert.equal(value.count, 2, `closed cap edge ${edge}`);
    assert.equal(value.winding, 0, `consistent cap edge ${edge}`);
  }
  assert.equal(faces.size, 6);
  const dimensions = capMax.map((value, axis) => value - capMin[axis]);
  for (const [plane, area] of faces) {
    const axis = Number(plane[0]);
    close(
      area,
      dimensions[(axis + 1) % 3] * dimensions[(axis + 2) % 3],
      `cap face ${plane} area`,
      1e-10,
    );
  }
  close(
    volume,
    (capMax[0] - capMin[0]) * (capMax[1] - capMin[1]) * (capMax[2] - capMin[2]),
    'cap volume',
    1e-10,
  );
});

test('refined replacement preserves runtime placement, scale and both cook stations', async () => {
  assert.deepEqual(KITCHEN_PLACEMENT.stove, [-1.7901838578129736, 0.0252, 0.6407950014610851]);
  assert.equal(KITCHEN_ROTATION.stove, Math.PI / 2);
  assert.deepEqual(KITCHEN_SCALE.stove ?? [1, 1, 1], [1, 1, 1]);
  assert.deepEqual(KITCHEN_PLACEMENT['sink-cabinet'], [-0.75, 0.024960769226163, -1.4]);
  assert.deepEqual(KITCHEN_SCALE['sink-cabinet'], [1.8667534820395086, 1, 1.2303512683915283]);
  assert.deepEqual(KITCHEN_PLACEMENT['range-hood'], [-2.013, 0, 0.6362635881443585]);
  assert.deepEqual(
    KITCHEN_PLACEMENT['storage-cabinet'],
    [-1.715, 0.024499213707168, 2.6368660533428194],
  );
  assert.deepEqual(KITCHEN_PLACEMENT.table, [1.45, 0, 1.15]);
  assert.deepEqual(KITCHEN_PLACEMENT['chair-left'], [0.95, 0.025, 2.03]);
  assert.deepEqual(KITCHEN_PLACEMENT['chair-right'], [1.98, 0.025, 2.03]);
  assert.deepEqual(KITCHEN_STATIONS.cook, [
    [-0.82, 0.9614550859470928],
    [-0.82, 1.3614550859470929],
  ]);
  const { scene } = await asset();
  const body = new T.Box3().setFromPoints(
    points(scene.getObjectByName('灶台静态总成')).map((p) => p.applyMatrix4(transform('stove'))),
  );
  close(body.min.z, -0.997, 'body still clears sink handles');
  assert.ok(
    KITCHEN_STATIONS.cook.every(([x]) => x > body.max.x),
    'stations stay in front',
  );
});

test('smoked glass is isolated from opaque cabinet and embedded atlas data decodes', async () => {
  const { doc, bytes, binStart, scene } = await asset();
  const materialFor = (name) => {
    const node = doc.nodes.find((item) => item.name === name);
    const primitives = doc.meshes[node.mesh].primitives;
    assert.equal(primitives.length, 1, name);
    return primitives[0].material;
  };
  const glassIndex = materialFor('烤箱烟色玻璃');
  const mainIndex = materialFor('灶台静态总成');
  const capIndex = materialFor('转角接缝台面');
  assert.equal(new Set([glassIndex, mainIndex, capIndex]).size, 3);
  const glass = doc.materials[glassIndex];
  assert.equal(glass.alphaMode, 'BLEND');
  const alpha = glass.pbrMetallicRoughness.baseColorFactor[3];
  assert.ok(alpha > 0 && alpha < 1);
  for (const id of [mainIndex, capIndex]) {
    assert.equal(doc.materials[id].alphaMode ?? 'OPAQUE', 'OPAQUE');
    assert.equal(doc.materials[id].pbrMetallicRoughness.baseColorFactor?.[3] ?? 1, 1);
  }
  const glassBox = new T.Box3().setFromObject(scene.getObjectByName('烤箱烟色玻璃'), true);
  close(glassBox.getSize(new T.Vector3()).x, 1.123, 'oven glass width');
  close(glassBox.getSize(new T.Vector3()).y, 0.3, 'oven glass height');
  const main = doc.materials[mainIndex];
  const textures = [
    main.pbrMetallicRoughness.baseColorTexture,
    main.pbrMetallicRoughness.metallicRoughnessTexture,
    main.normalTexture,
  ];
  assert.equal(new Set(textures.map((texture) => doc.textures[texture.index].source)).size, 3);
  for (const image of doc.images) {
    assert.equal(image.uri, undefined);
    assert.equal(image.mimeType, 'image/png');
    const view = doc.bufferViews[image.bufferView];
    assert.equal(view.buffer, 0);
    const start = binStart + (view.byteOffset ?? 0);
    assert.ok(start + view.byteLength <= bytes.length);
    const png = bytes.subarray(start, start + view.byteLength);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    const width = png.readUInt32BE(16),
      imageHeight = png.readUInt32BE(20);
    assert.ok(width > 0 && width <= 1024 && imageHeight > 0 && imageHeight <= 1024);
    assert.equal(png[24], 8, '8-bit atlas');
    assert.equal(png[28], 0, 'non-interlaced atlas');
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[png[25]];
    assert.ok(channels, 'supported PNG color type');
    const compressed = [];
    let ended = false;
    for (let offset = 8; offset + 12 <= png.length;) {
      const length = png.readUInt32BE(offset);
      assert.ok(offset + 12 + length <= png.length, 'PNG chunk fits embedded image');
      const type = png.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length));
      offset += 12 + length;
      if (type === 'IEND') {
        ended = true;
        break;
      }
    }
    assert.ok(ended && compressed.length > 0, 'complete embedded PNG');
    const stride = width * channels + 1;
    const pixels = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: stride * imageHeight,
    });
    assert.equal(pixels.length, stride * imageHeight);
    for (let row = 0; row < imageHeight; row++)
      assert.ok(pixels[row * stride] <= 4, 'PNG row filter');
  }
});
