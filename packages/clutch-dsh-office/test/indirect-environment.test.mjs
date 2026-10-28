import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleIndirectEnvironment } from '../lib/client/scene/indirect-environment.js';
import { KITCHEN_LIGHTING, createKitchenLightRig } from '../lib/client/scene/lighting.js';
import * as T from 'three';

test('passive environment is scale invariant and provides warm ground plus a broad neutral front reflection', () => {
  const profile = KITCHEN_LIGHTING.environment;
  const sample = (d) => sampleIndirectEnvironment(d, profile);
  assert.deepEqual(sample([1, 2, 3]), sample([2, 4, 6]));
  const front = sample([0.58, 0.25, 0.77]);
  const back = sample([-0.58, -0.25, -0.77]);
  assert.ok(front[0] > back[0] * 2);
  assert.ok(front[2] / front[0] > 0.85, 'front reflection remains nearly neutral, not orange');
  const floor = sample([0, -1, 0]);
  assert.ok(floor[0] > floor[2], 'timber bounce is warm');
  const nearFront = sample([0.75, 0.25, 0.65]);
  assert.ok(nearFront[0] > front[0] * 0.7, 'highlight source is broad');
  assert.throws(() => sample([0, 0, 0]), /direction/);
});

test('full-sphere passive radiance stays bounded and keeps directional contrast without adding lights or shadow targets', () => {
  let max = 0,
    min = Infinity;
  for (let j = 0; j <= 40; j++)
    for (let i = 0; i < 80; i++) {
      const polar = (Math.PI * j) / 40,
        azimuth = (2 * Math.PI * i) / 80;
      const rgb = sampleIndirectEnvironment(
        [Math.sin(polar) * Math.cos(azimuth), Math.cos(polar), Math.sin(polar) * Math.sin(azimuth)],
        KITCHEN_LIGHTING.environment,
      );
      assert.ok(rgb.every((v) => Number.isFinite(v) && v >= 0 && v <= 0.65));
      max = Math.max(max, ...rgb);
      min = Math.min(min, ...rgb);
    }
  assert.ok(max / min > 3);
  assert.equal(KITCHEN_LIGHTING.environment.size, 128);
  assert.equal(KITCHEN_LIGHTING.exposure, 1);
  const scene = new T.Scene(),
    rig = createKitchenLightRig(scene);
  assert.equal(scene.getObjectsByProperty('isRectAreaLight', true).length, 4);
  assert.equal(scene.getObjectsByProperty('isSpotLight', true).length, 4);
  assert.equal(scene.getObjectsByProperty('isHemisphereLight', true).length, 0);
  rig.dispose();
});
