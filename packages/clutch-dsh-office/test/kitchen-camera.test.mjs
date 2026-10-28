import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createKitchenCamera, resizeKitchenCamera } from '../lib/client/scene/camera.js';

test('review camera matches the converted Blender pose and lower elevation', () => {
  const camera = createKitchenCamera();
  assert.deepEqual(camera.position.toArray(), [8, 7, 8.5]);
  const forward = camera.getWorldDirection(new T.Vector3());
  const expected = new T.Vector3(-8, -5.7, -8).normalize();
  assert.ok(forward.distanceTo(expected) < 1e-12);
  assert.ok(
    Math.abs(
      (Math.atan2(-forward.y, Math.hypot(forward.x, forward.z)) * 180) / Math.PI - 26.7395860993,
    ) < 1e-9,
  );
  assert.equal(camera.top - camera.bottom, 8.1);
  const target = new T.Vector3(0, 1.3, 0.5).project(camera);
  assert.ok(Math.abs(target.x) < 1e-12 && Math.abs(target.y) < 1e-12);
});

test('resizing keeps square-review framing without stretching or clipping shell corners', () => {
  const camera = createKitchenCamera();
  for (const aspect of [0.5, 1, 16 / 9, 2.5]) {
    resizeKitchenCamera(camera, aspect);
    assert.ok(
      Math.abs((camera.right - camera.left) / (camera.top - camera.bottom) - aspect) < 1e-12,
    );
    assert.ok(camera.top - camera.bottom >= 8.1);
    for (const x of [-2.6, 2.6])
      for (const z of [-2.1, 3.1])
        for (const y of [-0.26, 3.5]) {
          const projected = new T.Vector3(x, y, z).project(camera);
          // Front upper corners are imaginary; check even this enclosing box fits.
          assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
        }
    const center = new T.Vector3(0, 1.3, 0.5);
    const x = center
      .clone()
      .add(new T.Vector3(1, 0, 0))
      .project(camera);
    const z = center
      .clone()
      .add(new T.Vector3(0, 0, 1))
      .project(camera);
    assert.ok(Math.abs(Math.hypot(x.x * aspect, x.y) - Math.hypot(z.x * aspect, z.y)) < 1e-12);
  }
});
