import type { Position, Station } from './types.js';

const COOKING_CENTER_Z = 0.15;
const TABLE_CENTER_Z = COOKING_CENTER_Z + 1;

export const KITCHEN_ROOM = { side: 5, centerZ: 0.5, wallHeight: 3.5 } as const;

/** Metric scene layout; only explicit scene sizing overrides change authored asset scale. */
export const KITCHEN_PLACEMENT = {
  floor: [0, 0, KITCHEN_ROOM.centerZ],
  'left-wall': [-2.375, 0, KITCHEN_ROOM.centerZ],
  'right-wall': [0, 0, -1.875],
  stove: [-1.7901838578129736, 0.0252, 0.6407950014610851],
  table: [1.45, 0, TABLE_CENTER_Z],
  refrigerator: [1.4, 0, -1.355],
  'storage-cabinet': [-1.715, 0.024499213707168, 2.6368660533428194],
  'sink-cabinet': [-0.75, 0.024960769226163, -1.4],
  'pendant-light': [1.95, KITCHEN_ROOM.wallHeight - 2.9, -1.48],
  'utensil-rail': [-2.307, 1.63, -0.36],
  'wall-cabinet': [-2.113, 1.86, -0.84],
  'range-hood': [-2.013, 0, 0.6362635881443585],
  'wall-shelf': [-0.3, 0.15, -1.813],
  'wall-art': [0.9, 2.79, -1.813],
  window: [-1.78, 1.8800518369674686, -1.808],
  'chair-left': [0.95, 0.025, TABLE_CENTER_Z + 0.88],
  'chair-right': [1.98, 0.025, TABLE_CENTER_Z + 0.88],
  rug: [-0.3798896241188049, 0.0255, 2.42],
  'floor-mat': [1.4, 0.0255, -0.37],
  'trash-can': [2.23, 0.025, -1.18],
  'whale-mitt': [-2.307, 1.43, 1.75],
  'wall-clock': [-2.307, 2.94, 2.62],
  'board-cloth': [-2.307, 1.12, -0.95],
  'wall-calendar': [2.26, 1.08, -1.807],
  'wall-plant-left': [-2.302, 2.18, 1.67],
  'wall-plant-right': [2.26, 2.15, -1.802],
  'wall-plant-window-left': [-2.12, 1.4, -1.802],
  'wall-plant-window-middle': [-1.78, 1.4, -1.802],
  'wall-plant-window-right': [-1.44, 1.4, -1.802],
  'spice-rack': [-2.307, 2.06, 2.45],
  'open-cubby': [-2.307, 1.86, -0.18],
  'black-utensil-rail': [-2.307, 1.35, 2.45],
  'wall-storage-box': [2.26, 1.65, -1.807],
} as const;

/** User-requested fit to the rear counter run, preserving the authored counter height. */
export const KITCHEN_SCALE: Partial<
  Record<keyof typeof KITCHEN_PLACEMENT, readonly [number, number, number]>
> = {
  'sink-cabinet': [1.8667534820395086, 1, 1.2303512683915283],
  'range-hood': [1.508635348167209, 1, 1],
  'board-cloth': [1.2, 1.2, 1.2],
  'utensil-rail': [0.45, 0.45, 0.45],
  'wall-plant-window-left': [0.85, 0.85, 0.85],
  'wall-plant-window-middle': [0.85, 0.85, 0.85],
  'wall-plant-window-right': [0.85, 0.85, 0.85],
};

export const KITCHEN_ROTATION = {
  'left-wall': Math.PI / 2,
  'utensil-rail': Math.PI / 2,
  stove: Math.PI / 2,
  'wall-cabinet': Math.PI / 2,
  'range-hood': Math.PI / 2,
  'whale-mitt': Math.PI / 2,
  'board-cloth': Math.PI / 2,
  'spice-rack': Math.PI / 2,
  'open-cubby': Math.PI / 2,
  'black-utensil-rail': Math.PI / 2,
  'wall-clock': Math.PI / 2,
  'wall-plant-left': Math.PI / 2,
} as const;

/** One parsed resource per group, with instance transforms owned by the scene. */
export const KITCHEN_INSTANCE_GROUPS: Readonly<Record<string, readonly string[]>> = {
  chairs: ['chair-left', 'chair-right'],
  'wall-plants': [
    'wall-plant-left',
    'wall-plant-right',
    'wall-plant-window-left',
    'wall-plant-window-middle',
    'wall-plant-window-right',
  ],
};

/** Stable delivery identity for repeated scene instances, shared by export and import. */
export function kitchenAssetName(id: string): string {
  if (id === 'chair-left' || id === 'chair-right') return 'chair';
  if (KITCHEN_INSTANCE_GROUPS['wall-plants'].includes(id)) return 'wall-plant';
  return id;
}

// Search seat 0 reaches the door; seat 1 waits to its left, facing the refrigerator.
// These are presentation stations, not certified reach/door interaction anchors.
export const KITCHEN_STATIONS = {
  cook: [
    [-0.82, 0.9614550859470928],
    [-0.82, 1.3614550859470929],
  ],
  search: [
    [1.4, -0.18],
    [0.1, -0.18],
  ],
  rest: [
    [-0.4, 0],
    [-0.4, 1.25],
  ],
} as const;

export const KITCHEN_SPAWN = [
  [-0.4, 0],
  [-0.4, 1.25],
] as const;

/** Full turns happen here, outside the narrow table/fridge passage. */
export const KITCHEN_TURN_POINT: Position = [-0.4, -0.18];

/** Final station facing; walking headings are owned by the motion phases. */
export function kitchenFacing(station: Station, seat: 0 | 1 = 0): number {
  if (station === 'fridge') return seat === 0 ? Math.PI : Math.atan2(1.3, -0.65);
  return station === 'stove' ? -Math.PI / 2 : 0;
}

/** Follow the shortest angular arc at the runtime's per-frame turn limit. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + Math.sign(delta) * Math.min(Math.abs(delta), maxStep);
}

/** Conservative sole footprint support; a thin mat is walkable, never a route obstacle.
 * The existing higher roaming/rug support is preserved. No skeletal IK is claimed.
 */
export function kitchenActorGroundY(position: Position, baseY: number, bobAllowance = 0): number {
  const mat = KITCHEN_PLACEMENT['floor-mat'];
  const soleReach = 0.35;
  const onMat =
    Math.abs(position[0] - mat[0]) <= 0.675 + soleReach &&
    Math.abs(position[1] - mat[2]) <= 0.385 + soleReach;
  return onMat ? Math.max(baseY, mat[1] + 0.018 + 0.001 + bobAllowance) : baseY;
}
