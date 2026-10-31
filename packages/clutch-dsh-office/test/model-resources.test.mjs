import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { Models } from '../lib/client/scene/models.js';

function asset() {
  const group = new T.Group();
  const geometry = new T.BoxGeometry();
  const texture = new T.Texture();
  let closed = 0;
  texture.source.data = { close: () => closed++ };
  const material = new T.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  group.add(new T.Mesh(geometry, material), new T.Mesh(geometry, material));
  const disposed = { geometry: 0, material: 0, texture: 0 };
  for (const [key, value] of Object.entries({ geometry, material, texture }))
    value.addEventListener('dispose', () => disposed[key]++);
  return { group, disposed, closed: () => closed };
}

test('GLB shared resources and bitmap close once when a kitchen leaves the viewport', () => {
  const loaded = asset();
  const owner = new Models();
  assert.equal(owner.ownObject(loaded.group), true);
  owner.dispose();
  owner.dispose();
  assert.deepEqual(loaded.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(loaded.closed(), 1);
});

test('GLB arriving after teardown releases its resources without scheduling a frame', () => {
  let redraws = 0;
  const owner = new Models(() => redraws++);
  owner.dispose();
  const loaded = asset();
  assert.equal(owner.ownObject(loaded.group), false);
  owner.invalidate();
  assert.equal(redraws, 0);
  assert.deepEqual(loaded.disposed, { geometry: 1, material: 1, texture: 1 });
  assert.equal(loaded.closed(), 1);
});

test('shared skin bone textures and animation callbacks release exactly once, including late arrivals', () => {
  for (const late of [false, true]) {
    const owner = new Models();
    const group = new T.Group();
    const skeleton = new T.Skeleton([new T.Bone()]);
    skeleton.computeBoneTexture();
    let boneTextures = 0,
      callbacks = 0;
    skeleton.boneTexture.addEventListener('dispose', () => boneTextures++);
    const geometry = new T.BoxGeometry();
    const material = new T.MeshStandardMaterial();
    for (let i = 0; i < 3; i++) {
      const mesh = new T.SkinnedMesh(geometry, material);
      mesh.bind(skeleton);
      group.add(mesh);
    }
    if (late) owner.dispose();
    owner.onDispose(() => callbacks++);
    assert.equal(owner.ownObject(group), !late);
    owner.dispose();
    owner.dispose();
    assert.equal(callbacks, 1);
    assert.equal(boneTextures, 1);
  }
});
