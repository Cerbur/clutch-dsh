import { advancePosition } from './actions.js';
import { KITCHEN_SPAWN, KITCHEN_TURN_POINT, kitchenFacing, turnToward } from './kitchen-layout.js';
import type { ActionPlan, Position } from './types.js';

interface Pose {
  readonly position: Position;
  readonly yaw: number;
}

export interface KitchenMotion extends Pose {
  readonly seat: 0 | 1;
  readonly destination: string;
  readonly returning: boolean;
  readonly route: readonly Pose[];
  readonly trail: readonly Pose[];
  readonly phase: 'idle' | 'turn' | 'walk' | 'retreat';
  readonly moving: boolean;
}

const hub: Pose = { position: KITCHEN_TURN_POINT, yaw: 0 };
const distance = (a: Position, b: Position) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const angle = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const key = (plan: ActionPlan) => `${plan.station}:${plan.target.join(',')}`;

/** A small authored corridor, not a general navigation graph. Each corner is a stop/turn. */
function outbound(plan: ActionPlan, seat: 0 | 1): Pose[] {
  const points: Position[] =
    plan.station === 'fridge'
      ? [plan.target]
      : [[KITCHEN_TURN_POINT[0], plan.target[1]], plan.target];
  const poses: Pose[] = [];
  let position = hub.position;
  for (const target of points) {
    if (distance(position, target) < 1e-8) continue;
    const yaw = Math.atan2(target[0] - position[0], target[1] - position[1]);
    poses.push({ position, yaw }, { position: target, yaw });
    position = target;
  }
  poses.push({ position, yaw: kitchenFacing(plan.station, seat) });
  return poses;
}

export function createKitchenMotion(seat: 0 | 1): KitchenMotion {
  const position = KITCHEN_SPAWN[seat];
  return {
    seat,
    position,
    yaw: 0,
    destination: '',
    returning: true,
    // Spawn enters the same safe left lane before choosing an outbound branch.
    route: [{ position, yaw: Math.PI }, { position: hub.position, yaw: Math.PI }, hub],
    trail: [hub],
    phase: 'turn',
    moving: false,
  };
}

/** Runtime and geometry tests share this deterministic, metre/second state machine. */
export function advanceKitchenMotion(
  previous: KitchenMotion,
  plan: ActionPlan,
  delta: number,
  reducedMotion = false,
): KitchenMotion {
  const destination = key(plan);
  if (reducedMotion) {
    return {
      seat: previous.seat,
      position: plan.target,
      yaw: kitchenFacing(plan.station, previous.seat),
      destination,
      returning: false,
      route: [],
      trail: [hub, ...outbound(plan, previous.seat)],
      phase: 'idle',
      moving: false,
    };
  }
  let route = [...previous.route];
  let trail = [...previous.trail];
  let returning = previous.returning;
  if (previous.destination !== destination && !returning) {
    // Undo the consumed prefix, including a partially completed turn or straight.
    // A second change while returning only updates the eventual destination.
    route = [...trail].reverse();
    returning = true;
  }
  const position = previous.position;
  const yaw = previous.yaw;
  for (;;) {
    const next = route[0];
    if (!next) {
      if (!returning)
        return { ...previous, destination, route, trail, returning, phase: 'idle', moving: false };
      returning = false;
      trail = [hub];
      route = outbound(plan, previous.seat);
      continue;
    }
    if (distance(position, next.position) < 1e-8 && Math.abs(angle(yaw, next.yaw)) < 1e-8) {
      route.shift();
      if (!returning) trail.push(next);
      continue;
    }
    const step = Math.min(0.06, Math.max(0, delta));
    const walking = distance(position, next.position) >= 1e-8;
    const nextPosition = walking ? advancePosition(position, next.position, step) : position;
    return {
      ...previous,
      destination,
      returning,
      route,
      trail,
      position: nextPosition,
      yaw: walking ? yaw : turnToward(yaw, next.yaw, step * 3.5),
      phase: walking
        ? (nextPosition[0] - position[0]) * Math.sin(yaw) +
            (nextPosition[1] - position[1]) * Math.cos(yaw) <
          0
          ? 'retreat'
          : 'walk'
        : 'turn',
      moving: distance(position, nextPosition) > 0,
    };
  }
}
