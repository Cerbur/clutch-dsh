import { KITCHEN_PLACEMENT } from './kitchen-layout.js';

type Vec3 = readonly [number, number, number];
function offset(id: keyof typeof KITCHEN_PLACEMENT, delta: Vec3): Vec3 {
  const p = KITCHEN_PLACEMENT[id];
  return [p[0] + delta[0], p[1] + delta[1], p[2] + delta[2]];
}

/** Shared Three/Cycles practical emitters. Colors are linear; watts are scene calibration. */
export const KITCHEN_PRACTICALS = {
  id: 'kitchen-warm-practicals-v3',
  areas: [
    {
      name: 'hood-task-warm',
      position: offset('range-hood', [0, 1.69, 0]),
      target: offset('range-hood', [-0.15, 0.92, 0]),
      width: 1.12,
      height: 0.26,
      color: [1, 0.53, 0.22],
      watts: 26,
    },
    {
      name: 'shelf-task-warm',
      position: offset('wall-shelf', [-0.02, 1.79, 0.24]),
      target: offset('wall-shelf', [-0.02, 0.77, 0.12]),
      width: 1.22,
      height: 0.12,
      color: [1, 0.55, 0.24],
      watts: 22,
    },
    {
      name: 'window-warm',
      // Emit from the recessed pane, facing into the room. A light in front of
      // the timber frame turned its lower rail pink and overlit the blue cabinet.
      position: offset('window', [0, 0.372, 0.105]),
      target: offset('window', [0, 0.372, 1.1]),
      width: 0.78,
      height: 0.46,
      color: [1, 0.78, 0.48],
      watts: 8,
    },
  ],
  // Raycast-reviewed panes sit at depth .097m; frame fronts start beyond .15m.
  windowGlow: {
    halfWidth: 0.425,
    minHeight: 0.135,
    maxHeight: 0.635,
    minDepth: 0.09,
    maxDepth: 0.105,
    color: [1, 0.78, 0.48],
    intensity: 0.32,
  },
  pendant: {
    name: 'pendant-light-glow',
    // Authored light_anchor minus7cm: just below the opaque whale underside.
    position: offset(
      'pendant-light',
      [0.000724425131920725, 2.1427041816711427, 0.021539948880672455],
    ),
    color: [1, 0.57, 0.25],
    watts: 16,
    distance: 1.6,
    radius: 0.12,
  },
} as const;
