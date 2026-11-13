import * as T from 'three';
import type { CharacterAnimation } from '../models.js';
import { searchClipData } from './search-clip.js';
import { createTurnPose } from './turn.js';

interface Eyelids {
  readonly weights: number[];
  readonly indices: readonly number[];
}

/** Facial state is per actor and independent of mixers, activity and locomotion. */
export function createAutoBlink(root: T.Object3D, random = Math.random) {
  const bindings: Eyelids[] = [];
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    const names = object.morphTargetDictionary;
    const weights = object.morphTargetInfluences;
    if (!names || !weights) return;
    const indices = ['Blink_L', 'Blink_R', 'BlinkCurve_L', 'BlinkCurve_R'].map(
      (name) => names[name],
    );
    if (indices.every((index) => Number.isInteger(index))) bindings.push({ weights, indices });
  });
  if (!bindings.length) return undefined;
  const curve = [0, 0.35, 0.82, 1, 1, 0.64, 0.22, 0];
  let disposed = false;
  let enabled = true;
  let elapsed = 0;
  let time = -1;
  const nextInterval = () => 3 + Math.max(0, Math.min(1, random())) * 3;
  let interval = nextInterval();
  const apply = (value: number) => {
    for (const {
      weights,
      indices: [left, right, lc, rc],
    } of bindings) {
      weights[left] = weights[right] = value;
      weights[lc] = weights[rc] = 4 * value * (1 - value);
    }
  };
  const reset = () => {
    apply(0);
    elapsed = 0;
    time = -1;
    interval = nextInterval();
  };
  apply(0);
  return {
    update(delta: number) {
      if (disposed || !enabled || !Number.isFinite(delta) || delta < 0) return;
      if (delta > 0.5) {
        reset();
        return;
      }
      if (time < 0) {
        elapsed += delta;
        if (elapsed < interval) return;
        time = 0;
      }
      time += delta;
      if (time >= 7 / 30) {
        reset();
        return;
      }
      const position = time * 30;
      const i = Math.floor(position);
      const t = position - i;
      apply(curve[i] * (1 - t) + curve[i + 1] * t);
    },
    setEnabled(value: boolean) {
      if (disposed || enabled === value) return;
      enabled = value;
      reset();
    },
    dispose() {
      if (disposed) return;
      apply(0);
      bindings.length = 0;
      disposed = true;
    },
  };
}

/** One skeleton/mixer per parsed actor; no looped Blink track is put in the mixer. */
export function createCharacterAnimation(
  root: T.Object3D,
  clips: readonly T.AnimationClip[],
  random = Math.random,
): CharacterAnimation | undefined {
  const clip = clips.find((item) => item.name === 'Walk_InPlace');
  const blink = createAutoBlink(root, random);
  if (!clip || !blink) {
    blink?.dispose();
    return undefined;
  }
  const mixer = new T.AnimationMixer(root);
  const walkClip = clip.clone();
  const start = Math.min(...walkClip.tracks.map((track) => track.times[0]));
  // The Blender bake uses STEP samples; interpolate them for variable RAF/gait rates.
  for (const track of walkClip.tracks) {
    track.shift(-start);
    track.setInterpolation(T.InterpolateLinear);
  }
  walkClip.resetDuration();
  const turnPose = createTurnPose(root);
  // Quaternion interpolation can dip the authored sole between baked frames.
  // Track only the rest-pose sole band, keeping the scene-owned floor offset external.
  const baseY = root.position.y;
  const sole: { mesh: T.SkinnedMesh; index: number }[] = [];
  let soleHasMorph = false;
  const point = new T.Vector3();
  const inverse = new T.Matrix4();
  root.updateMatrixWorld(true);
  inverse.copy(root.matrixWorld).invert();
  root.traverse((object) => {
    if (!(object instanceof T.SkinnedMesh)) return;
    const geometry: T.BufferGeometry = object.geometry;
    const positions = geometry.getAttribute('position');
    const indices = geometry.index;
    const visited = new Set<number>();
    // GLTF primitives can share a full vertex buffer. Only the vertices used by
    // this primitive are visible; face primitives must not probe the body's feet.
    const count = indices?.count ?? positions.count;
    for (let offset = 0; offset < count; offset++) {
      const index = indices ? indices.getX(offset) : offset;
      if (visited.has(index)) continue;
      visited.add(index);
      object.getVertexPosition(index, point).applyMatrix4(object.matrixWorld).applyMatrix4(inverse);
      if (point.y >= 0.015) continue;
      sole.push({ mesh: object, index });
      // The adopted eyelids never move a sole vertex. Retain idle grounding for
      // other valid rigs whose expressions do affect the support band.
      soleHasMorph ||= (geometry.morphAttributes.position ?? []).some(
        (morph) =>
          morph.getX(index) !== (geometry.morphTargetsRelative ? 0 : positions.getX(index)) ||
          morph.getY(index) !== (geometry.morphTargetsRelative ? 0 : positions.getY(index)) ||
          morph.getZ(index) !== (geometry.morphTargetsRelative ? 0 : positions.getZ(index)),
      );
    }
  });
  const ground = () => {
    root.position.y = baseY;
    root.updateMatrixWorld(true);
    inverse.copy(root.matrixWorld).invert();
    let minimum = 0;
    for (const { mesh, index } of sole) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      minimum = Math.min(minimum, point.y);
    }
    root.position.y = baseY - minimum;
    root.updateMatrixWorld(true);
  };
  const walk = mixer.clipAction(walkClip);
  walk.play().setEffectiveWeight(0);
  // A separate low-amplitude copy of the authored in-place gait supplies pivot
  // steps without advancing the walking action or moving the character root.
  const turnClip = new T.AnimationClip('Turn_Steps', walkClip.duration, walkClip.tracks);
  const turn = mixer.clipAction(turnClip);
  turn.play().setEffectiveWeight(0);
  const search = mixer.clipAction(
    new T.AnimationClip(
      searchClipData.name,
      searchClipData.duration,
      searchClipData.tracks.map((track) => {
        const name = track.name.slice(0, -'.quaternion'.length);
        const bone = root.getObjectByName(T.PropertyBinding.sanitizeNodeName(name));
        if (!bone) throw new Error('Missing search animation bone: ' + name);
        return new T.QuaternionKeyframeTrack(bone.uuid + '.quaternion', track.times, track.values);
      }),
    ),
  );
  search.play().setEffectiveWeight(0);
  let searchWeight = 0;
  let wasSearching = false;
  let weight = 0;
  let disposed = false;
  let poseDirty = true;
  let turnAmount = 0;
  let turnRate = 0;
  const stopPose = () => {
    turnPose.restore();
    turnAmount = 0;
    turnRate = 0;
    turn.setEffectiveWeight(0);
    turn.time = 0;
    searchWeight = 0;
    wasSearching = false;
    search.setEffectiveWeight(0);
    search.time = 0;
    weight = 0;
    walk.setEffectiveWeight(0);
    mixer.update(0);
    walk.time = 0;
    root.position.y = baseY;
    poseDirty = true;
  };
  return {
    // Small authored steps: 1.5 cycles/sec; turning and the route stay unchanged.
    walkSpeed: 0.48,
    update(delta, speed, reducedMotion, searching = false, angularVelocity = 0) {
      if (disposed) return;
      blink.setEnabled(!reducedMotion);
      if (reducedMotion) {
        stopPose();
        return;
      }
      const moving = Math.abs(speed) > 1e-4;
      const turning = Number.isFinite(angularVelocity) && Math.abs(angularVelocity) > 1e-4;
      const wasTurning = turnAmount !== 0;
      turnPose.restore();
      const turnTarget = turning ? T.MathUtils.clamp(angularVelocity / 2.2, -1, 1) : 0;
      const turnFade = Math.max(0, delta) / 0.16;
      turnAmount += T.MathUtils.clamp(turnTarget - turnAmount, -turnFade, turnFade);
      if (turning) {
        if (!wasTurning) turn.time = angularVelocity > 0 ? 0 : turnClip.duration / 2;
        turnRate = Math.min(2.2, Math.abs(angularVelocity) / (Math.PI / 2));
      }
      // Include the previous weights so the final fade frame still restores bind
      // pose. Stable idle needs only the independent blink timer, not skin probes.
      const updatePose =
        poseDirty || weight > 0 || searchWeight > 0 || moving || searching || wasTurning || turning;
      const activeSearch = searching && !moving && !turning;
      if (activeSearch && !wasSearching && searchWeight === 0) search.time = 0;
      wasSearching = activeSearch;
      const searchFade = Math.max(0, delta) / 0.3;
      searchWeight += T.MathUtils.clamp(
        (activeSearch ? 1 : 0) - searchWeight,
        -searchFade,
        searchFade,
      );
      search.setEffectiveWeight(searchWeight);
      search.setEffectiveTimeScale(searchWeight > 0 ? 1 : 0);
      const target = moving ? 1 : 0;
      const fade = Math.max(0, delta) / 0.12;
      weight += T.MathUtils.clamp(target - weight, -fade, fade);
      walk.setEffectiveWeight(weight);
      walk.setEffectiveTimeScale(moving ? speed / 0.32 : 0);
      turn.setEffectiveWeight(Math.abs(turnAmount) * 0.45 * (1 - weight) * (1 - searchWeight));
      turn.setEffectiveTimeScale(turnAmount !== 0 ? turnRate : 0);
      if (updatePose) mixer.update(delta);
      if (turnAmount === 0) turn.time = 0;
      if (searchWeight === 0) search.time = 0;
      if (!moving && weight === 0) walk.time = 0;
      blink.update(delta);
      turnPose.apply(turnAmount * (1 - searchWeight));
      if (updatePose || soleHasMorph) ground();
      poseDirty = false;
    },
    pause() {
      if (disposed) return;
      blink.setEnabled(false);
      stopPose();
    },
    dispose() {
      if (disposed) return;
      turnPose.restore();
      blink.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      root.position.y = baseY;
      disposed = true;
    },
  };
}
