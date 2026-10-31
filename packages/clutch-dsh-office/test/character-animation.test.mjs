import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  createAutoBlink,
  createCharacterAnimation,
} from '../lib/client/scene/character/animation.js';
import { Models } from '../lib/client/scene/models.js';
import { validateAsset } from '../scripts/sync-asset.mjs';

const bytes = await readFile(new URL('../assets/models/character/deepseek.glb', import.meta.url));
const manifest = JSON.parse(
  await readFile(new URL('../assets/models/character/deepseek.manifest.json', import.meta.url)),
);
function rewrite(edit) {
  const size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size));
  edit(doc);
  const text = Buffer.from(JSON.stringify(doc));
  const json = Buffer.alloc(Math.ceil(text.length / 4) * 4, 32);
  text.copy(json);
  const binary = bytes.subarray(20 + size);
  const out = Buffer.alloc(20 + json.length + binary.length);
  out.writeUInt32LE(0x46546c67, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(json.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  json.copy(out, 20);
  binary.copy(out, 20 + json.length);
  return out;
}
function geometryOnly() {
  return rewrite((doc) => {
    for (const key of ['materials', 'images', 'textures', 'samplers']) delete doc[key];
    for (const mesh of doc.meshes) for (const p of mesh.primitives) delete p.material;
  });
}
async function actor(random = () => 0) {
  const buffer = geometryOnly();
  const gltf = await new GLTFLoader().parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    '',
  );
  const owner = new Models();
  owner.ownObject(gltf.scene);
  const animation = createCharacterAnimation(gltf.scene, gltf.animations, random);
  assert.ok(animation);
  owner.onDispose(() => animation.dispose());
  const meshes = [];
  gltf.scene.traverse((object) => {
    if (object.isSkinnedMesh) meshes.push(object);
  });
  gltf.scene.updateMatrixWorld(true);
  return { ...gltf, owner, animation, meshes, thigh: gltf.scene.getObjectByName('thigh.L') };
}
const blinkWeight = (a) =>
  a.meshes[0].morphTargetInfluences[a.meshes[0].morphTargetDictionary.Blink_L];
const pose = (a) =>
  a.meshes[0].skeleton.bones.flatMap((bone) => [
    ...bone.position.toArray(),
    ...bone.quaternion.toArray(),
    ...bone.scale.toArray(),
  ]);
const error = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

test('fridge search is independently keyed, stays planted, blends out and respects reduced motion', async () => {
  const a = await actor();
  const rest = pose(a);
  const foot = a.scene.getObjectByName(T.PropertyBinding.sanitizeNodeName('foot.L'));
  const footRest = foot.quaternion.clone();
  const snapshots = [];
  for (let i = 0; i < 150; i++) {
    a.animation.update(1 / 30, 0, false, true);
    if ([30, 60, 90].includes(i)) snapshots.push(pose(a));
  }
  assert.ok(error(snapshots[0], snapshots[1]) > 0.01);
  assert.ok(error(snapshots[1], snapshots[2]) > 0.01);
  assert.ok(error(foot.quaternion.toArray(), footRest.toArray()) < 1e-6);
  for (let i = 0; i < 15; i++) a.animation.update(1 / 30, 0, false, false);
  assert.ok(error(rest, pose(a)) < 1e-6);
  for (let i = 0; i < 45; i++) a.animation.update(1 / 30, 0, false, true);
  a.animation.update(1 / 30, 0, true, true);
  assert.ok(error(rest, pose(a)) < 1e-6);
  a.animation.pause();
  a.owner.dispose();
});

test('actual delivered skin blinks while standing, without activating a locomotion action', async () => {
  const a = await actor();
  const rest = pose(a);
  let peak = 0;
  for (let i = 0; i < 120; i++) {
    a.animation.update(1 / 30, 0, false);
    peak = Math.max(peak, blinkWeight(a));
    assert.ok(error(rest, pose(a)) < 1e-6);
  }
  assert.equal(a.meshes.length, 3);
  assert.ok(peak > 0.99);
  assert.equal(blinkWeight(a), 0);
  for (const mesh of a.meshes)
    assert.equal(mesh.morphTargetInfluences[mesh.morphTargetDictionary.Blink_R], 0);
  a.owner.dispose();
});

test('two real actors keep independent skeletons, expressions and gait; stop/reduced motion restore the bind pose', async () => {
  const a = await actor();
  const b = await actor(() => 1);
  const bind = pose(a);
  const other = pose(b);
  assert.notEqual(a.meshes[0].skeleton, b.meshes[0].skeleton);
  assert.notEqual(a.meshes[0].skeleton.bones[0], b.meshes[0].skeleton.bones[0]);
  assert.notEqual(a.meshes[0].morphTargetInfluences, b.meshes[0].morphTargetInfluences);
  let walking = 0,
    differentBlinks = false;
  const originalTimes = a.animations
    .find((clip) => clip.name === 'Walk_InPlace')
    .tracks[0].times.slice();
  for (let i = 0; i < 110; i++) {
    a.animation.update(1 / 30, 0.48, false);
    b.animation.update(1 / 30, 0, false);
    walking = Math.max(walking, error(bind, pose(a)));
    differentBlinks ||= blinkWeight(a) > 0.9 && blinkWeight(b) === 0;
  }
  assert.ok(walking > 0.05);
  assert.ok(differentBlinks);
  assert.ok(error(other, pose(b)) < 1e-6);
  assert.deepEqual(
    a.animations.find((clip) => clip.name === 'Walk_InPlace').tracks[0].times,
    originalTimes,
    'source clip is never shifted in place',
  );
  for (let i = 0; i < 10; i++) a.animation.update(1 / 30, 0, false);
  assert.ok(error(bind, pose(a)) < 1e-6, 'stop fades to neutral instead of freezing a lifted shoe');
  a.animation.update(1 / 30, 0.48, false);
  a.animation.update(1 / 30, 0.48, true);
  assert.ok(error(bind, pose(a)) < 1e-6);
  assert.equal(blinkWeight(a), 0);
  a.animation.pause();
  a.owner.dispose();
  a.animation.update(0.1, 0.48, false);
  assert.equal(blinkWeight(a), 0);
  b.owner.dispose();
});

test('walking uses the signed actual speed, while blink timing is unchanged by forward/reverse travel', async () => {
  const a = await actor();
  const b = await actor();
  for (let i = 0; i < 96; i++) {
    a.animation.update(1 / 30, 0.48, false);
    b.animation.update(1 / 30, -0.48, false);
    assert.equal(blinkWeight(a), blinkWeight(b));
  }
  assert.ok(error(pose(a), pose(b)) > 0.01);
  a.owner.dispose();
  b.owner.dispose();
});

test('real 3-primitive model exposes independent single-eye controls', async () => {
  const a = await actor();
  for (const mesh of a.meshes) {
    mesh.morphTargetInfluences[mesh.morphTargetDictionary.Blink_L] = 1;
    assert.equal(mesh.morphTargetInfluences[mesh.morphTargetDictionary.Blink_R], 0);
  }
  const blinking = createAutoBlink(a.scene, () => 0);
  assert.ok(blinking);
  blinking.dispose();
  for (const mesh of a.meshes) assert.ok(mesh.morphTargetInfluences.every((value) => value === 0));
  a.owner.dispose();
});

test('new character budget is revision-specific, and malformed skin or coupled blink clips are rejected', () => {
  assert.equal(validateAsset(manifest, bytes).triangles, 57002);
  assert.throws(
    () => validateAsset({ ...manifest, revision: '2026-10-27-r2' }, bytes),
    /Static|budget/,
  );
  for (const edit of [
    (doc) => doc.skins[0].joints.pop(),
    (doc) => (doc.meshes[0].extras.targetNames[0] = 'MissingEye'),
    (doc) => (doc.meshes[0].weights[0] = 1),
    (doc) => doc.meshes[0].primitives[0].targets.pop(),
    (doc) => {
      doc.animations.find((a) => a.name === 'Blink').channels[0].target = {
        node: doc.skins[0].joints[0],
        path: 'translation',
      };
    },
    (doc) => {
      doc.animations.find((a) => a.name === 'Walk_InPlace').channels[0].target = {
        node: 31,
        path: 'weights',
      };
    },
  ]) {
    const changed = rewrite(edit);
    const m = {
      ...manifest,
      bytes: changed.length,
      sha256: createHash('sha256').update(changed).digest('hex'),
    };
    assert.throws(() => validateAsset(m, changed), /skeletal/);
  }
});
