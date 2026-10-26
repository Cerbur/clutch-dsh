import type { ActionPlan, Activity, Position } from './types.js';

/** Kitchen theme policy. Future activity feeds use this same renderer-free seam. */
export function planAction(activity: Activity, seat: 0 | 1): ActionPlan {
  const x = seat === 0 ? -1.35 : 0.05;
  switch (activity) {
    case 'working':
    case 'editing':
      return { station: 'stove', pose: 'cook', target: [x, -0.55] };
    case 'searching':
      return { station: 'fridge', pose: 'search', target: [1.55, seat === 0 ? 0.1 : 1.05] };
    case 'waiting':
      return { station: 'rest', pose: 'wait', target: [x, 0.7] };
    case 'idle':
    case 'unknown':
      return { station: 'rest', pose: 'idle', target: [x, 0.7] };
  }
}

/** Time-based movement, independent of frame rate; clamps to avoid overshoot. */
export function advancePosition(current: Position, target: Position, delta: number): Position {
  const dx = target[0] - current[0];
  const dz = target[1] - current[1];
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return target;
  const scale = Math.min(1, (Math.max(0, delta) * 1.3) / distance);
  return [current[0] + dx * scale, current[1] + dz * scale];
}
