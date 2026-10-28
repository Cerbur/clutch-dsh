import type { ActionPlan, Activity, Position } from './types.js';
import { KITCHEN_STATIONS } from './kitchen-layout.js';

/** Kitchen theme policy. Future activity feeds use this same renderer-free seam. */
export function planAction(activity: Activity, seat: 0 | 1): ActionPlan {
  switch (activity) {
    case 'working':
    case 'editing':
      return { station: 'stove', pose: 'cook', target: KITCHEN_STATIONS.cook[seat] };
    case 'searching':
      return { station: 'fridge', pose: 'search', target: KITCHEN_STATIONS.search[seat] };
    case 'waiting':
      return { station: 'rest', pose: 'wait', target: KITCHEN_STATIONS.rest[seat] };
    case 'idle':
    case 'unknown':
      return { station: 'rest', pose: 'idle', target: KITCHEN_STATIONS.rest[seat] };
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
