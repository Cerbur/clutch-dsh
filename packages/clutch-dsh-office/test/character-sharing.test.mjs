import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { Models } from '../lib/client/scene/models.js';
import { createCharacterTemplate } from '../lib/client/scene/character/template.js';

test('concurrent characters share GPU assets but never skeletons or morph state; teardown is safe', async () => {
  const room = new Models();
  const bone = new T.Bone();
  const geometry = new T.BoxGeometry();
  geometry.morphAttributes.position = [geometry.attributes.position.clone()];
  const texture = new T.Texture();
  let closes = 0,
    releases = 0,
    parses = 0;
  texture.source.data = {
    close() {
      closes++;
    },
  };
  const material = new T.MeshStandardMaterial({ map: texture });
  geometry.addEventListener('dispose', () => releases++);
  const mesh = new T.SkinnedMesh(geometry, material);
  mesh.add(bone);
  mesh.bind(new T.Skeleton([bone]));
  const scene = new T.Group();
  scene.add(mesh);
  for (let i = 0; i < 2; i++) {
    const part = new T.SkinnedMesh(geometry, material);
    part.bind(mesh.skeleton);
    scene.add(part);
  }
  const template = createCharacterTemplate(room, async () => {
    parses++;
    return { scene, animations: [] };
  });
  const owners = Array.from({ length: 4 }, () => new Models(() => {}, true));
  const instances = await Promise.all(owners.map((owner) => template.instantiate(owner)));
  assert.equal(parses, 1);
  const meshes = instances.map((instance) => instance.scene.children[0]);
  for (const item of meshes) {
    assert.equal(item.geometry, geometry);
    assert.equal(item.material, material);
    assert.ok(item.layers.isEnabled(1));
  }
  assert.equal(new Set(meshes.map((item) => item.skeleton)).size, 4);
  for (const instance of instances)
    assert.equal(new Set(instance.scene.children.map((part) => part.skeleton)).size, 1);
  meshes[0].skeleton.bones[0].position.x = 5;
  meshes[0].morphTargetInfluences[0] = 1;
  assert.equal(meshes[1].skeleton.bones[0].position.x, 0);
  assert.equal(meshes[1].morphTargetInfluences[0], 0);
  owners[0].dispose();
  assert.equal(releases, 0);
  assert.equal(closes, 0);
  owners.forEach((owner) => owner.dispose());
  room.dispose();
  room.dispose();
  assert.equal(releases, 1);
  assert.equal(closes, 1);
});

test('late template delivery releases resources and never attaches to a disposed actor', async () => {
  const room = new Models(),
    actor = new Models();
  let finish,
    released = 0;
  const scene = new T.Group();
  const geometry = new T.BoxGeometry();
  geometry.addEventListener('dispose', () => released++);
  scene.add(new T.Mesh(geometry, new T.MeshStandardMaterial()));
  const template = createCharacterTemplate(
    room,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = template.instantiate(actor);
  await Promise.resolve();
  actor.dispose();
  room.dispose();
  finish({ scene, animations: [] });
  assert.equal(await pending, undefined);
  assert.equal(released, 1);
});
