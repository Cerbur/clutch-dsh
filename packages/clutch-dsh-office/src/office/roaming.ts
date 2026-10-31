import type { Position } from './types.js';
import { advancePosition } from './actions.js';
import { turnToward } from './kitchen-layout.js';

// A shared aisle graph inside the existing furniture clearance envelope.
export const ROAM_SCALE = 0.75;
export const ROAM_CLEARANCE = 0.75;
export const ROAM_POINTS: readonly Position[] = [
  [-0.4, -0.05],
  [-0.4, 0.775],
  [-0.4, 1.55],
  [-0.4, 2.325],
  [0.43, -0.05],
  [1.26, -0.05],
];
const edges: readonly (readonly number[])[] = [[1, 4], [0, 2], [1, 3], [2], [0, 5], [4]];
export interface RoamingMotion {
  readonly node: number;
  readonly target: number;
  readonly position: Position;
  readonly yaw: number;
  readonly wait: number;
  readonly moving: boolean;
  readonly seed: number;
}
export function createRoamingMotion(seat: number): RoamingMotion {
  const node = [0, 1, 2, 5][seat % 4];
  return {
    node,
    target: node,
    position: ROAM_POINTS[node],
    yaw: 0,
    wait: 1 + seat * 0.7,
    moving: false,
    seed: (seat + 1) * 173,
  };
}
/** Seeded choices, shared target reservations and swept centre clearance prevent passing through peers. */
export function advanceRoamingMotion(
  previous: RoamingMotion,
  others: readonly RoamingMotion[],
  delta: number,
  reduced = false,
  speed = 0.48,
): RoamingMotion {
  const dt = Math.min(0.06, Math.max(0, delta));
  if (reduced) return { ...previous, moving: false };
  if (previous.node === previous.target) {
    if (previous.wait > 0) return { ...previous, wait: previous.wait - dt, moving: false };
    const seed = (previous.seed * 1664525 + 1013904223) >>> 0;
    const choices = edges[previous.node].filter(
      (n) =>
        !others.some(
          (p) =>
            p.node === n ||
            p.target === n ||
            Math.hypot(ROAM_POINTS[n][0] - p.position[0], ROAM_POINTS[n][1] - p.position[1]) <
              ROAM_CLEARANCE,
        ),
    );
    if (!choices.length) return { ...previous, seed, wait: 0.8, moving: false };
    return { ...previous, seed, target: choices[seed % choices.length], moving: false };
  }
  const target = ROAM_POINTS[previous.target];
  const desired = Math.atan2(target[0] - previous.position[0], target[1] - previous.position[1]);
  const yaw = turnToward(previous.yaw, desired, dt * 2.2);
  if (Math.abs(Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw))) > 0.03)
    return { ...previous, yaw, moving: false };
  const position = advancePosition(previous.position, target, dt, speed);
  if (
    others.some(
      (p) => Math.hypot(position[0] - p.position[0], position[1] - p.position[1]) < ROAM_CLEARANCE,
    )
  )
    return { ...previous, yaw, moving: false };
  const arrived = Math.hypot(position[0] - target[0], position[1] - target[1]) < 1e-6;
  return {
    ...previous,
    position,
    yaw,
    moving: !arrived,
    node: arrived ? previous.target : previous.node,
    wait: arrived ? 1.5 + (previous.seed % 25) / 10 : 0,
  };
}
