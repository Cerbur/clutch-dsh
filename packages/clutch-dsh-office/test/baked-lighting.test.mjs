import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as T from 'three';
import { Models } from '../lib/client/scene/models.js';
import {
  configureKitchenBake,
  applyKitchenBake,
  rejectKitchenBake,
  configureBakedKitchenMaterial,
  kitchenGeometrySignature,
  KITCHEN_BAKED_RECEIVERS,
} from '../lib/client/scene/baked-lighting.js';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  KITCHEN_INSTANCE_GROUPS,
} from '../lib/office/kitchen-layout.js';
import { geometrySignature, geometryOnlyGlb } from '../scripts/export-lighting-geometry.mjs';
test('late texture ownership is idempotent even after its room has been disposed', () => {
  const owner = new Models();
  let released = 0,
    closed = 0;
  const texture = new T.Texture({
    close() {
      closed++;
    },
  });
  texture.addEventListener('dispose', () => released++);
  assert.equal(owner.ownTexture(texture), true);
  assert.equal(owner.ownTexture(texture), true);
  owner.dispose();
  assert.equal(owner.ownTexture(texture), false);
  assert.equal(owner.ownTexture(texture), false);
  assert.equal(released, 1);
  assert.equal(closed, 1);
});
test('atlas decode failure leaves all source resources intact and records one realtime fallback', async (t) => {
  const f = await fixture(),
    warnings = mockWarnings(t),
    owner = new Models();
  owner.ownObject(f.roots[0]);
  bitmap(t);
  globalThis.createImageBitmap = async () => {
    throw new Error('cannot decode RGBM');
  };
  configureKitchenBake(f.bundle);
  await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
  assert.equal(f.roots[0].children[0].geometry, f.shared);
  assert.equal(f.roots[0].children[0].material, f.mat);
  assert.equal(warnings.length, 1);
  owner.dispose();
  configureKitchenBake(undefined);
});

function geometry() {
  const value = new T.PlaneGeometry(1, 1);
  value.setAttribute(
    'color',
    new T.Float32BufferAttribute(Array(value.getAttribute('position').count * 3).fill(0.6), 3),
  );
  return value;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function fixture(ids = ['floor']) {
  const shared = geometry(),
    mat = new T.MeshStandardMaterial({ roughness: 0.58, metalness: 0.14 });
  const bytes = new TextEncoder().encode('frozen source bytes').buffer;
  const count = shared.index.count;
  const uv = new Uint8Array(count * 4 * ids.length),
    view = new DataView(uv.buffer);
  ids.forEach((_, i) => {
    for (let j = 0; j < count; j++) {
      view.setUint16((i * count + j) * 4, i ? 60000 : 1000, true);
      view.setUint16((i * count + j) * 4 + 2, 32000 + j, true);
    }
  });
  const diffuse = new Uint8Array(24),
    png = new DataView(diffuse.buffer);
  png.setUint32(0, 0x89504e47);
  png.setUint32(16, 4);
  png.setUint32(20, 4);
  const manifest = {
    schemaVersion: 1,
    revision: '2026-10-28-cycles-bake-r1',
    atlas: {
      encoding: 'RGBM',
      range: 8,
      width: 4,
      height: 4,
      file: 'diffuse.png',
      sha256: hash(diffuse),
    },
    uv: { file: 'uv.bin', bytes: uv.length, sha256: hash(uv) },
    layout: structuredClone({
      positions: KITCHEN_PLACEMENT,
      rotations: KITCHEN_ROTATION,
      scales: KITCHEN_SCALE,
    }),
    sources: ids.map((id) => ({
      id,
      assetId:
        'kitchen/' +
        (id.startsWith('chair') ? 'chair' : id.startsWith('wall-plant-') ? 'wall-plant' : id),
      sha256: hash(new Uint8Array(bytes)),
    })),
    instances: Object.fromEntries(
      ids.map((id, i) => [
        id,
        [
          {
            meshIndex: 0,
            vertexCount: count,
            offset: i * count * 4,
            geometrySignature: geometrySignature(shared),
          },
        ],
      ]),
    ),
  };
  const roots = ids.map((id) => {
    const root = new T.Group();
    root.name = id;
    root.add(new T.Mesh(shared, mat));
    return root;
  });
  return { bundle: { manifest, uv, diffuse }, roots, bytes, shared, mat };
}
async function compactFixture(ids = Object.keys(KITCHEN_PLACEMENT)) {
  const f = await fixture(ids);
  const { manifest, uv } = f.bundle;
  manifest.receiverIds = [...KITCHEN_BAKED_RECEIVERS].filter((id) => ids.includes(id));
  const chunks = [];
  let offset = 0;
  for (const [id, entries] of Object.entries(manifest.instances))
    for (const entry of entries) {
      entry.name = id + '_mesh';
      if (manifest.receiverIds.includes(id)) {
        const length = entry.vertexCount * 4;
        chunks.push(uv.slice(entry.offset, entry.offset + length));
        entry.offset = offset;
        offset += length;
      } else delete entry.offset;
    }
  f.bundle.uv = new Uint8Array(offset);
  offset = 0;
  for (const chunk of chunks) {
    f.bundle.uv.set(chunk, offset);
    offset += chunk.length;
  }
  manifest.uv = { ...manifest.uv, scope: 'receivers', bytes: offset, sha256: hash(f.bundle.uv) };
  return f;
}
function bitmap(t, promise) {
  let closed = 0;
  const result = {
    width: 4,
    height: 4,
    close() {
      closed++;
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  globalThis.createImageBitmap = async (blob, options) => {
    entered();
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(options, {
      imageOrientation: 'none',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    if (promise) await promise;
    return result;
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'createImageBitmap', previous);
    else delete globalThis.createImageBitmap;
  });
  const count = () => closed;
  count.ready = ready;
  return count;
}
function mockWarnings(t) {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  return warnings;
}
test('deferred provider stays idle until apply and shares one pending load across rooms', async (t) => {
  const f = await fixture(),
    warnings = mockWarnings(t),
    owners = [new Models(), new Models()],
    roots = [f.roots[0], f.roots[0].clone(true)];
  bitmap(t);
  let calls = 0,
    release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  configureKitchenBake(async () => {
    calls++;
    await pending;
    return f.bundle;
  });
  t.after(() => {
    for (const owner of owners) owner.dispose();
    configureKitchenBake(undefined);
  });
  await Promise.resolve();
  assert.equal(calls, 0);
  const jobs = owners.map((owner, i) => {
    owner.ownObject(roots[i]);
    return applyKitchenBake(owner, 'floor', roots[i], f.bytes);
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  for (const root of roots) assert.equal(root.children[0].geometry, f.shared);
  release();
  await Promise.all(jobs);
  for (const root of roots) assert.notEqual(root.children[0].geometry, f.shared);
  assert.notEqual(roots[0].children[0].material.lightMap, roots[1].children[0].material.lightMap);
  const later = new Models(),
    laterRoot = new T.Group();
  owners.push(later);
  laterRoot.add(new T.Mesh(f.shared, f.mat));
  later.ownObject(laterRoot);
  await applyKitchenBake(later, 'floor', laterRoot, f.bytes);
  assert.notEqual(laterRoot.children[0].geometry, f.shared);
  assert.equal(calls, 1);
  assert.equal(warnings.length, 0);
});
test('skipped, rejected and disabled rooms never start a deferred provider', async (t) => {
  const f = await fixture(),
    disposed = new Models(),
    rejected = new Models(),
    actor = new Models(),
    disabled = new Models();
  mockWarnings(t);
  let calls = 0;
  configureKitchenBake(async () => {
    calls++;
    return f.bundle;
  });
  t.after(() => {
    for (const owner of [disposed, rejected, actor, disabled]) owner.dispose();
    configureKitchenBake(undefined);
  });
  disposed.dispose();
  await applyKitchenBake(disposed, 'floor', f.roots[0], f.bytes);
  await applyKitchenBake(actor, 'deepseek', f.roots[0], f.bytes);
  rejectKitchenBake(rejected, 'missing source');
  await applyKitchenBake(rejected, 'floor', f.roots[0], f.bytes);
  configureKitchenBake(undefined);
  await applyKitchenBake(disabled, 'floor', f.roots[0], f.bytes);
  assert.equal(calls, 0);
  assert.equal(f.roots[0].children[0].geometry, f.shared);
});
for (const failure of ['rejection', 'synchronous throw', 'invalid bundle'])
  test('deferred provider caches ' + failure + ' and warns once per room', async (t) => {
    const f = await fixture(),
      warnings = mockWarnings(t),
      owners = [new Models(), new Models()];
    let calls = 0;
    configureKitchenBake(() => {
      calls++;
      if (failure === 'rejection') return Promise.reject(new Error('asset load failed'));
      if (failure === 'synchronous throw') throw new Error('asset load failed');
      return Promise.resolve({ ...f.bundle, uv: new Uint8Array(0) });
    });
    t.after(() => {
      for (const owner of owners) owner.dispose();
      configureKitchenBake(undefined);
    });
    assert.equal(calls, 0);
    for (const owner of owners) {
      await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
      await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
    }
    assert.equal(calls, 1);
    assert.equal(warnings.length, 2);
    for (const warning of warnings) assert.match(warning[1], /asset load failed|UV sidecar length/);
    assert.equal(f.roots[0].children[0].geometry, f.shared);
    assert.equal(f.roots[0].children[0].material, f.mat);
  });
test('legacy base64 bundle decodes eagerly and preserves exact UV bytes', async (t) => {
  const f = await fixture(),
    warnings = mockWarnings(t),
    owner = new Models(),
    decode = t.mock.method(globalThis, 'atob');
  bitmap(t);
  owner.ownObject(f.roots[0]);
  t.after(() => {
    owner.dispose();
    configureKitchenBake(undefined);
  });
  const encode = (bytes) => btoa(String.fromCharCode(...bytes));
  configureKitchenBake({
    manifest: encode(new TextEncoder().encode(JSON.stringify(f.bundle.manifest))),
    uv: encode(f.bundle.uv),
    diffuse: encode(f.bundle.diffuse),
  });
  assert.equal(decode.mock.callCount(), 3);
  await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
  assert.deepEqual(
    f.roots[0].children[0].geometry.attributes.uv1.array,
    new Uint16Array(f.bundle.uv.buffer),
  );
  assert.equal(warnings.length, 0);
});
test('geometry signatures match the exporter for indexed, interleaved and normalized original attributes', async () => {
  const indexed = geometry();
  assert.equal(await kitchenGeometrySignature(indexed), geometrySignature(indexed));
  const interleaved = new T.BufferGeometry();
  const buffer = new T.InterleavedBuffer(new Float32Array([1, 2, 3, 9, 4, 5, 6, 8, 7, 8, 9, 7]), 4);
  interleaved.setAttribute('position', new T.InterleavedBufferAttribute(buffer, 3, 0));
  interleaved.setAttribute(
    'uv',
    new T.Uint16BufferAttribute([0, 65535, 32768, 0, 65535, 32768], 2, true),
  );
  assert.equal(await kitchenGeometrySignature(interleaved), geometrySignature(interleaved));
});
test('baked shader replaces diffuse only after AO, decodes RGBM without pi, preserves original LTC specular and emissive', () => {
  const material = new T.MeshPhysicalMaterial({ roughness: 0.55, metalness: 0.15 });
  const atlas = new T.Texture();
  configureBakedKitchenMaterial(material, atlas, 8);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  const source = shader.fragmentShader;
  const ao = source.indexOf('#include <aomap_fragment>');
  const override = source.indexOf('reflectedLight.directDiffuse = vec3(0.0);');
  assert.ok(ao < override && override < source.indexOf('vec3 totalDiffuse'));
  assert.ok(source.includes('value.rgb * value.a * 8.00000000'));
  assert.ok(source.includes('officeSampleBakedDiffuse(vLightMapUv)'));
  assert.equal((source.match(/officeDecodeRGBM\(texture2D\(lightMap/g) ?? []).length, 4);
  assert.ok(
    source.includes('mix(mix(c00, c10, fraction.x), mix(c01, c11, fraction.x), fraction.y)'),
  );
  assert.ok(
    source.includes('reflectedLight.indirectDiffuse = officeBakedRGB * material.diffuseColor'),
  );
  assert.ok(source.includes('spotShadowMap[3]'));
  assert.ok(source.includes('mix(0.30000000, 1.0, kitchenAreaVisibility('));
  assert.equal(/reflectedLight\.(?:directSpecular|indirectSpecular)\s*=/.test(source), false);
  assert.ok(source.includes('totalSpecular + totalEmissiveRadiance'));
  assert.equal(material.roughness, 0.55);
  assert.equal(material.metalness, 0.15);
  assert.ok(material.customProgramCacheKey().includes('office-baked-diffuse-linear-r4/8/0.7'));
});
test('UV corners use private nonindexed clones, leave source attributes unchanged and own atlas exactly once', async (t) => {
  const f = await fixture();
  const closed = bitmap(t);
  mockWarnings(t);
  let redraws = 0;
  const owner = new Models(() => redraws++);
  owner.ownObject(f.roots[0]);
  const originalUV = [...f.shared.attributes.uv.array],
    originalIndex = [...f.shared.index.array];
  configureKitchenBake(f.bundle);
  await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
  const mesh = f.roots[0].children[0];
  assert.notEqual(mesh.geometry, f.shared);
  assert.equal(mesh.geometry.index, null);
  assert.notEqual(mesh.material, f.mat);
  assert.deepEqual([...f.shared.attributes.uv.array], originalUV);
  assert.deepEqual([...f.shared.index.array], originalIndex);
  assert.equal(f.shared.attributes.uv1, undefined);
  assert.equal(mesh.geometry.attributes.uv1.normalized, true);
  assert.equal(mesh.geometry.attributes.uv1.array[0], 1000);
  assert.equal(mesh.geometry.attributes.uv1.array[1], 32000);
  assert.equal(mesh.geometry.attributes.color.count, mesh.geometry.attributes.position.count);
  assert.equal(mesh.material.lightMap.flipY, false);
  assert.equal(mesh.material.lightMap.channel, 1);
  assert.equal(mesh.material.lightMap.colorSpace, T.NoColorSpace);
  assert.equal(mesh.material.lightMap.generateMipmaps, false);
  assert.equal(mesh.material.lightMap.minFilter, T.NearestFilter);
  assert.equal(mesh.material.lightMap.magFilter, T.NearestFilter);
  let textureDisposed = 0;
  mesh.material.lightMap.addEventListener('dispose', () => textureDisposed++);
  owner.dispose();
  owner.dispose();
  assert.equal(textureDisposed, 1);
  assert.equal(closed(), 1);
  assert.equal(redraws, 1);
  configureKitchenBake(undefined);
});
test('chair wrappers validate as occluders but stay realtime; shell waits for every static source', async (t) => {
  const f = await fixture(['chair-left', 'chair-right', 'floor']);
  bitmap(t);
  mockWarnings(t);
  const owner = new Models();
  const chairs = new T.Group();
  chairs.add(f.roots[0], f.roots[1]);
  owner.ownObject(chairs);
  owner.ownObject(f.roots[2]);
  configureKitchenBake(f.bundle);
  await applyKitchenBake(owner, 'chairs', chairs, f.bytes);
  assert.equal(f.roots[0].children[0].geometry, f.shared);
  await applyKitchenBake(owner, 'floor', f.roots[2], f.bytes);
  assert.equal(f.roots[0].children[0].geometry, f.shared);
  assert.equal(f.roots[1].children[0].geometry, f.shared);
  assert.equal(f.roots[0].children[0].material, f.mat);
  assert.equal(f.roots[1].children[0].material, f.mat);
  assert.equal(f.roots[0].children[0].material.lightMap, null);
  assert.notEqual(f.roots[2].children[0].geometry, f.shared);
  owner.dispose();
  configureKitchenBake(undefined);
});
test('all five shared wall plants validate as distinct occluders before the shell can commit', async (t) => {
  const ids = [
    'wall-plant-left',
    'wall-plant-right',
    'wall-plant-window-left',
    'wall-plant-window-middle',
    'wall-plant-window-right',
  ];
  assert.deepEqual(KITCHEN_INSTANCE_GROUPS['wall-plants'], ids);
  const f = await fixture([...ids, 'floor']);
  bitmap(t);
  const warnings = mockWarnings(t);
  const owner = new Models();
  t.after(() => {
    owner.dispose();
    configureKitchenBake(undefined);
  });
  const plants = new T.Group();
  const plantRoots = f.roots.slice(0, ids.length);
  const floor = f.roots.at(-1);
  for (const root of plantRoots) {
    root.position.fromArray(KITCHEN_PLACEMENT[root.name]);
    root.rotation.y = KITCHEN_ROTATION[root.name] ?? 0;
    root.scale.fromArray(KITCHEN_SCALE[root.name] ?? [1, 1, 1]);
    plants.add(root);
  }
  owner.ownObject(plants);
  owner.ownObject(floor);
  configureKitchenBake(f.bundle);
  await applyKitchenBake(owner, 'floor', floor, f.bytes);
  assert.equal(floor.children[0].geometry, f.shared, 'shell waits for the plant group');
  await applyKitchenBake(owner, 'wall-plants', plants, f.bytes);
  for (const root of plantRoots) {
    assert.equal(root.children[0].geometry, f.shared, root.name);
    assert.equal(root.children[0].material, f.mat, root.name);
    assert.equal(root.children[0].material.lightMap, null, root.name);
    assert.deepEqual(root.position.toArray(), [...KITCHEN_PLACEMENT[root.name]]);
    assert.equal(root.rotation.y, KITCHEN_ROTATION[root.name] ?? 0);
    assert.deepEqual(root.scale.toArray(), [...(KITCHEN_SCALE[root.name] ?? [1, 1, 1])]);
  }
  assert.notEqual(floor.children[0].geometry, f.shared);
  assert.ok(floor.children[0].material.lightMap);
  assert.equal(warnings.length, 0);
});
test('compact UV binds only the shell after all current sources validate without expanding occluders', async (t) => {
  const f = await compactFixture(),
    { manifest } = f.bundle,
    warnings = mockWarnings(t);
  bitmap(t);
  const expand = t.mock.method(f.shared, 'toNonIndexed');
  const cloneMaterial = t.mock.method(f.mat, 'clone');
  const owner = new Models();
  t.after(() => {
    owner.dispose();
    configureKitchenBake(undefined);
  });
  for (const root of f.roots) owner.ownObject(root);
  assert.equal(manifest.sources.length, Object.keys(KITCHEN_PLACEMENT).length);
  assert.equal(f.bundle.uv.length, f.shared.index.count * 4 * 3);
  configureKitchenBake(f.bundle);
  for (const [i, source] of manifest.sources.entries()) {
    await applyKitchenBake(owner, source.id, f.roots[i], f.bytes);
    if (i < manifest.sources.length - 1) assert.equal(expand.mock.callCount(), 0);
  }
  for (const [i, source] of manifest.sources.entries()) {
    const mesh = f.roots[i].children[0];
    if (manifest.receiverIds.includes(source.id)) {
      assert.notEqual(mesh.geometry, f.shared);
      assert.equal(mesh.geometry.index, null);
      assert.equal(mesh.geometry.attributes.uv1.array[0], i ? 60000 : 1000);
      assert.equal(mesh.geometry.attributes.uv1.array[1], 32000);
      assert.ok(mesh.material.lightMap);
    } else {
      assert.equal(mesh.geometry, f.shared, source.id);
      assert.equal(mesh.material, f.mat, source.id);
      assert.equal(mesh.geometry.attributes.uv1, undefined);
      assert.equal(mesh.material.lightMap, null);
      assert.equal('offset' in manifest.instances[source.id][0], false);
    }
  }
  assert.equal(expand.mock.callCount(), 3);
  assert.equal(cloneMaterial.mock.callCount(), 3);
  assert.equal(warnings.length, 0);
});
for (const invalid of ['source', 'geometry', 'primitive count'])
  test('compact occluder ' + invalid + ' mismatch prevents every receiver swap', async (t) => {
    const f = await compactFixture(['floor', 'table']),
      warnings = mockWarnings(t),
      owner = new Models();
    bitmap(t);
    t.after(() => {
      owner.dispose();
      configureKitchenBake(undefined);
    });
    for (const root of f.roots) owner.ownObject(root);
    if (invalid === 'geometry') {
      const changed = f.shared.clone();
      changed.attributes.position.setX(0, 17);
      f.roots[1].children[0].geometry = changed;
    }
    if (invalid === 'primitive count') f.roots[1].add(new T.Mesh(f.shared, f.mat));
    configureKitchenBake(f.bundle);
    await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
    await applyKitchenBake(
      owner,
      'table',
      f.roots[1],
      invalid === 'source' ? new TextEncoder().encode('changed occluder').buffer : f.bytes,
    );
    await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
    assert.equal(f.roots[0].children[0].geometry, f.shared);
    assert.equal(f.roots[0].children[0].material, f.mat);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][1], /source GLB hash|geometry signature|primitive count/);
  });
for (const [invalid, edit, reason] of [
  [
    'missing receiver offset',
    (m) => {
      delete m.instances.floor[0].offset;
    },
    /primitive UV records/,
  ],
  [
    'extra nonreceiver offset',
    (m) => {
      m.instances.table[0].offset = 0;
    },
    /primitive UV records/,
  ],
  [
    'unknown scope',
    (m) => {
      m.uv.scope = 'all';
    },
    /unsupported UV scope/,
  ],
  [
    'null scope',
    (m) => {
      m.uv.scope = null;
    },
    /unsupported UV scope/,
  ],
  [
    'implicit receivers',
    (m) => {
      delete m.receiverIds;
    },
    /explicit receiverIds/,
  ],
  [
    'invalid occluder signature',
    (m) => {
      m.instances.table[0].geometrySignature = 'bad';
    },
    /primitive UV records/,
  ],
  [
    'invalid occluder index',
    (m) => {
      m.instances.table[0].meshIndex = 1;
    },
    /primitive UV records/,
  ],
  [
    'invalid occluder count',
    (m) => {
      m.instances.table[0].vertexCount = 4;
    },
    /primitive UV records/,
  ],
])
  test('compact rejects ' + invalid + ' before committing', async (t) => {
    const f = await compactFixture(['floor', 'table']),
      warnings = mockWarnings(t),
      owner = new Models();
    t.after(() => {
      owner.dispose();
      configureKitchenBake(undefined);
    });
    edit(f.bundle.manifest);
    configureKitchenBake(f.bundle);
    await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
    assert.equal(f.roots[0].children[0].geometry, f.shared);
    assert.equal(f.roots[0].children[0].material, f.mat);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][1], reason);
  });
test('legacy UV still requires offsets for nonreceivers with an explicit shell selection', async (t) => {
  const f = await fixture(['floor', 'table']),
    warnings = mockWarnings(t),
    owner = new Models();
  t.after(() => {
    owner.dispose();
    configureKitchenBake(undefined);
  });
  f.bundle.manifest.receiverIds = ['floor'];
  delete f.bundle.manifest.instances.table[0].offset;
  configureKitchenBake(f.bundle);
  await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
  assert.equal(f.roots[0].children[0].geometry, f.shared);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][1], /invalid primitive UV records: table/);
});
for (const invalid of ['overlap', 'gap', 'negative', 'misaligned', 'out of bounds', 'trailing'])
  test('compact receiver UV rejects ' + invalid + ' spans', async (t) => {
    const f = await compactFixture(['floor', 'left-wall', 'table']),
      warnings = mockWarnings(t),
      owner = new Models();
    t.after(() => {
      owner.dispose();
      configureKitchenBake(undefined);
    });
    if (invalid === 'trailing') {
      f.bundle.uv = new Uint8Array([...f.bundle.uv, 0, 0, 0, 0]);
      f.bundle.manifest.uv.bytes = f.bundle.uv.length;
      f.bundle.manifest.uv.sha256 = hash(f.bundle.uv);
    } else {
      f.bundle.manifest.instances['left-wall'][0].offset = {
        overlap: 0,
        gap: 4,
        negative: -4,
        misaligned: 1,
        'out of bounds': 1000,
      }[invalid];
    }
    configureKitchenBake(f.bundle);
    await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
    assert.equal(f.roots[0].children[0].geometry, f.shared);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][1], /UV records|UV spans|UV sidecar/);
  });
for (const invalid of ['source', 'geometry', 'layout', 'uv', 'atlas']) {
  test(
    invalid + ' mismatch leaves source models untouched and warns only once per room',
    async (t) => {
      const f = await fixture(),
        warnings = mockWarnings(t);
      bitmap(t);
      if (invalid === 'source') f.bundle.manifest.sources[0].sha256 = 'a'.repeat(64);
      if (invalid === 'geometry')
        f.bundle.manifest.instances.floor[0].geometrySignature = 'b'.repeat(64);
      if (invalid === 'layout') f.bundle.manifest.layout.positions.table[2] += 0.2;
      if (invalid === 'uv') f.bundle.uv[0] ^= 1;
      if (invalid === 'atlas') f.bundle.diffuse[1] ^= 1;
      const owner = new Models();
      owner.ownObject(f.roots[0]);
      configureKitchenBake(f.bundle);
      await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
      await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
      assert.equal(f.roots[0].children[0].geometry, f.shared);
      assert.equal(f.roots[0].children[0].material, f.mat);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0][0], /using realtime lighting/);
      owner.dispose();
      configureKitchenBake(undefined);
    },
  );
}
test('atlas completing after teardown closes bitmap and never swaps meshes or schedules frames', async (t) => {
  const f = await fixture();
  mockWarnings(t);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const closed = bitmap(t, pending);
  let redraws = 0;
  const owner = new Models(() => redraws++);
  owner.ownObject(f.roots[0]);
  configureKitchenBake(f.bundle);
  const job = applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
  await closed.ready;
  owner.dispose();
  release();
  await job;
  assert.equal(f.roots[0].children[0].geometry, f.shared);
  assert.equal(redraws, 0);
  assert.equal(closed(), 1);
  configureKitchenBake(undefined);
});
test('missing static asset invalidates pending room once; actor-owned models preserve layer0 and add layer1', async (t) => {
  const f = await fixture();
  const warnings = mockWarnings(t);
  const owner = new Models();
  configureKitchenBake(f.bundle);
  rejectKitchenBake(owner, 'missing stove');
  rejectKitchenBake(owner, 'missing sink');
  await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
  assert.equal(warnings.length, 1);
  const actor = new Models(() => {}, true);
  actor.ownObject(f.roots[0]);
  assert.equal(f.roots[0].children[0].layers.mask, 3);
  const group = new T.Group();
  const mesh = actor.mesh(group, geometry(), actor.material('#ffffff'), [0, 0, 0]);
  assert.equal(mesh.layers.mask, 3);
  actor.dispose();
  owner.dispose();
  configureKitchenBake(undefined);
});

for (const selection of ['shell default', 'all-instance opt-in'])
  test('synthetic legacy all-UV delivery supports ' + selection, async (t) => {
    assert.deepEqual(KITCHEN_BAKED_RECEIVERS, ['floor', 'left-wall', 'right-wall']);
    const ids = Object.keys(KITCHEN_PLACEMENT),
      f = await fixture(ids),
      warnings = mockWarnings(t),
      owner = new Models();
    if (selection === 'all-instance opt-in') f.bundle.manifest.receiverIds = ids;
    const receivers = f.bundle.manifest.receiverIds ?? KITCHEN_BAKED_RECEIVERS;
    assert.equal(f.bundle.manifest.uv.scope, undefined);
    assert.equal(
      f.bundle.uv.length,
      f.shared.index.count * 4 * Object.keys(KITCHEN_PLACEMENT).length,
    );
    bitmap(t);
    t.after(() => {
      owner.dispose();
      configureKitchenBake(undefined);
    });
    for (const root of f.roots) owner.ownObject(root);
    configureKitchenBake(f.bundle);
    for (const [i, id] of ids.entries()) await applyKitchenBake(owner, id, f.roots[i], f.bytes);
    for (const [i, id] of ids.entries()) {
      const mesh = f.roots[i].children[0];
      if (receivers.includes(id)) {
        assert.notEqual(mesh.geometry, f.shared, id);
        assert.notEqual(mesh.material, f.mat, id);
        assert.ok(mesh.material.lightMap, id);
        assert.equal(mesh.geometry.attributes.uv1.array[0], i ? 60000 : 1000, id);
      } else {
        assert.equal(mesh.geometry, f.shared, id);
        assert.equal(mesh.material, f.mat, id);
      }
    }
    assert.equal(warnings.length, 0);
  });
test('invalid receiver selection cannot silently enable a stale or nonexistent instance', async (t) => {
  const f = await fixture(),
    warnings = mockWarnings(t);
  f.bundle.manifest.receiverIds = ['not-a-source'];
  const owner = new Models();
  owner.ownObject(f.roots[0]);
  configureKitchenBake(f.bundle);
  await applyKitchenBake(owner, 'floor', f.roots[0], f.bytes);
  assert.equal(f.roots[0].children[0].geometry, f.shared);
  assert.equal(warnings.length, 1);
  owner.dispose();
  configureKitchenBake(undefined);
});
test('RGBM white/black edge decodes each neighboring texel before mixing instead of squaring the edge weight', () => {
  const atlas = new T.Texture({ width: 2, height: 2 });
  const material = new T.MeshStandardMaterial();
  configureBakedKitchenMaterial(material, atlas, 8);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.deepEqual(shader.uniforms.officeBakeAtlasSize.value.toArray(), [2, 2]);
  const source = shader.fragmentShader;
  const body = source.slice(
    source.indexOf('vec3 officeSampleBakedDiffuse('),
    source.indexOf('void main()'),
  );
  assert.equal((body.match(/officeDecodeRGBM\(texture2D/g) ?? []).length, 4);
  for (const name of ['c00', 'c10', 'c01', 'c11'])
    assert.match(
      body,
      new RegExp('vec3 ' + name + ' = officeDecodeRGBM\\(texture2D\\(lightMap, clamp'),
    );
  assert.ok(body.includes('base = floor(pixel)'));
  assert.ok(body.includes('fraction = fract(pixel)'));
  assert.ok(body.includes('vec2(1.5, 1.5)'));
  const decodeBody = source.match(
    /vec3 officeDecodeRGBM\(vec4 value\) { return value.rgb \* value.a \* ([\d.]+); }/,
  );
  assert.ok(decodeBody);
  const range = Number(decodeBody[1]),
    multiplier = 32 / 255,
    white = 1 / (multiplier * range);
  const correctHalfEdge = white * multiplier * range * 0.5;
  const oldHalfEdge = white * 0.5 * ((multiplier + 1 / 255) * 0.5) * range;
  assert.equal(correctHalfEdge, 0.5);
  assert.ok(oldHalfEdge < 0.26);
});
async function actualScene() {
  const manifest = JSON.parse(
    await readFile(new URL('../assets/lighting/kitchen/manifest.json', import.meta.url), 'utf8'),
  );
  const uv = new Uint8Array(
    await readFile(new URL('../assets/lighting/kitchen/uv.bin', import.meta.url)),
  );
  const diffuse = new Uint8Array(
    await readFile(new URL('../assets/lighting/kitchen/diffuse.png', import.meta.url)),
  );
  const cache = new Map(),
    instances = [];
  for (const source of manifest.sources) {
    let asset = cache.get(source.assetId);
    if (!asset) {
      const raw = await readFile(
        new URL('../assets/models/' + source.assetId + '.glb', import.meta.url),
      );
      const stripped = geometryOnlyGlb(raw);
      const { scene } = await new GLTFLoader().parseAsync(
        stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
        '',
      );
      asset = { scene, bytes: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) };
      cache.set(source.assetId, asset);
    }
    const root = asset.scene.clone(true),
      meshes = [];
    root.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    instances.push({
      id: source.id,
      root,
      meshes,
      bytes: asset.bytes,
      originals: meshes.map((mesh) => ({ geometry: mesh.geometry, material: mesh.material })),
    });
  }
  return { bundle: { manifest, uv, diffuse }, instances };
}
test('all current real sources and primitives validate, while only the three shell instances get private bake geometry', async (t) => {
  const f = await actualScene(),
    warnings = mockWarnings(t);
  const old = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  globalThis.createImageBitmap = async () => ({
    width: f.bundle.manifest.atlas.width,
    height: f.bundle.manifest.atlas.height,
    close() {},
  });
  t.after(() =>
    old
      ? Object.defineProperty(globalThis, 'createImageBitmap', old)
      : delete globalThis.createImageBitmap,
  );
  assert.equal(f.instances.length, Object.keys(KITCHEN_PLACEMENT).length);
  assert.equal(f.bundle.manifest.uv.scope, 'receivers');
  assert.deepEqual(f.bundle.manifest.receiverIds, [...KITCHEN_BAKED_RECEIVERS]);
  assert.equal(f.bundle.uv.byteLength, 20832);
  assert.equal(f.bundle.manifest.uv.bytes, f.bundle.uv.byteLength);
  assert.equal(
    f.bundle.manifest.atlas.width * f.bundle.manifest.atlas.height * 4,
    16 * 1024 * 1024,
  );
  assert.equal(
    f.instances.reduce((n, instance) => n + instance.meshes.length, 0),
    Object.values(f.bundle.manifest.instances).reduce((n, meshes) => n + meshes.length, 0),
  );
  const owner = new Models();
  t.after(() => {
    owner.dispose();
    configureKitchenBake(undefined);
  });
  for (const instance of f.instances) owner.ownObject(instance.root);
  configureKitchenBake(f.bundle);
  for (const [i, instance] of f.instances.entries()) {
    await applyKitchenBake(owner, instance.id, instance.root, instance.bytes);
    if (i < f.instances.length - 1)
      for (const check of f.instances)
        check.meshes.forEach((mesh, j) => assert.equal(mesh.geometry, check.originals[j].geometry));
  }
  const privateInstances = new Set();
  for (const instance of f.instances)
    instance.meshes.forEach((mesh, i) => {
      if (KITCHEN_BAKED_RECEIVERS.includes(instance.id)) {
        privateInstances.add(instance.id);
        assert.equal(typeof f.bundle.manifest.instances[instance.id][i].offset, 'number');
        assert.notEqual(mesh.geometry, instance.originals[i].geometry);
        assert.notEqual(mesh.material, instance.originals[i].material);
        assert.equal(mesh.geometry.index, null);
        assert.equal(mesh.geometry.getAttribute('uv1').normalized, true);
        assert.ok(mesh.material.lightMap);
      } else {
        assert.equal('offset' in f.bundle.manifest.instances[instance.id][i], false);
        assert.equal(mesh.geometry, instance.originals[i].geometry, instance.id);
        assert.equal(mesh.material, instance.originals[i].material, instance.id);
        assert.equal(mesh.material.lightMap, null, instance.id);
        assert.equal(mesh.geometry.getAttribute('uv1'), undefined, instance.id);
      }
    });
  assert.deepEqual([...privateInstances].sort(), [...KITCHEN_BAKED_RECEIVERS].sort());
  assert.equal(warnings.length, 0);
});
