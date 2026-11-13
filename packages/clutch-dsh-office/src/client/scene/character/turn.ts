import * as T from 'three';

/** Actor-local anticipation on top of the mixer's pose, never accumulated frame to frame. */
export function createTurnPose(root: T.Object3D) {
  root.updateMatrixWorld(true);
  const up = new T.Vector3(0, 1, 0).applyQuaternion(root.getWorldQuaternion(new T.Quaternion()));
  const parts = [
    { name: 'head', angle: 0.13 },
    { name: 'chest', angle: 0.06 },
    { name: 'tail_01', angle: -0.08 },
  ].flatMap(({ name, angle }) => {
    const bone = root.getObjectByName(T.PropertyBinding.sanitizeNodeName(name));
    if (!bone) return [];
    return [
      {
        bone,
        angle,
        axis: up.clone().applyQuaternion(bone.getWorldQuaternion(new T.Quaternion()).invert()),
        pose: bone.quaternion.clone(),
      },
    ];
  });
  const offset = new T.Quaternion();
  let applied = false;
  return {
    restore() {
      if (!applied) return;
      for (const { bone, pose } of parts) bone.quaternion.copy(pose);
      applied = false;
    },
    apply(amount: number) {
      if (amount === 0) return;
      for (const { bone, angle, axis, pose } of parts) {
        pose.copy(bone.quaternion);
        bone.quaternion.multiply(offset.setFromAxisAngle(axis, angle * amount));
      }
      applied = true;
    },
  };
}

/** Signed shortest-arc angular speed; a zero-time or invalid frame cannot invent a turn. */
export function turnVelocity(previousYaw: number, yaw: number, delta: number): number {
  if (
    !Number.isFinite(previousYaw) ||
    !Number.isFinite(yaw) ||
    !Number.isFinite(delta) ||
    delta <= 0
  )
    return 0;
  return Math.atan2(Math.sin(yaw - previousYaw), Math.cos(yaw - previousYaw)) / delta;
}
