import * as T from 'three';

/** Exact review-script camera, converted from Blender Z-up to glTF/Three Y-up. */
export const KITCHEN_CAMERA = {
  position: [8, 7, 8.5],
  target: [0, 1.3, 0.5],
  orthoScale: 8.1,
  near: 0.1,
  far: 80,
} as const;

export function createKitchenCamera(): T.OrthographicCamera {
  const half = KITCHEN_CAMERA.orthoScale / 2;
  const camera = new T.OrthographicCamera(
    -half,
    half,
    half,
    -half,
    KITCHEN_CAMERA.near,
    KITCHEN_CAMERA.far,
  );
  camera.position.set(...KITCHEN_CAMERA.position);
  camera.lookAt(...KITCHEN_CAMERA.target);
  camera.updateMatrixWorld();
  return camera;
}

/** Preserve review framing; narrow cards expand vertically instead of cropping the room. */
export function resizeKitchenCamera(camera: T.OrthographicCamera, aspect: number): void {
  const half = KITCHEN_CAMERA.orthoScale / 2;
  const vertical = half / Math.min(1, Math.max(aspect, 0.01));
  camera.left = -vertical * aspect;
  camera.right = vertical * aspect;
  camera.top = vertical;
  camera.bottom = -vertical;
  camera.updateProjectionMatrix();
}
