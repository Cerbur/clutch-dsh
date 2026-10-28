import * as T from 'three';
import { KITCHEN_ROOM } from '../../../office/kitchen-layout.js';
import type { Models } from '../models.js';
import type { KitchenPalette } from './shared.js';
import floorBytes from '../../../../assets/models/kitchen/floor.glb?inline';
import { bundledAsset } from './asset.js';

/** Procedural surface retained only until the bundled floor is ready. */
function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'floor';
  const { wood, white, wall } = palette;
  models.box(root, [KITCHEN_ROOM.side + 0.2, 0.22, KITCHEN_ROOM.side + 0.2], [0, -0.15, 0], wood);
  models.box(root, [KITCHEN_ROOM.side, 0.05, KITCHEN_ROOM.side], [0, 0, 0], white);
  // Geometry tile joints keep the whitebox independent of external textures.
  for (let x = -2.4; x < KITCHEN_ROOM.side / 2; x += 0.6)
    models.box(root, [0.012, 0.005, KITCHEN_ROOM.side - 0.1], [x, 0.028, 0], wall);
  for (let z = -2.4; z < KITCHEN_ROOM.side / 2; z += 0.6)
    models.box(root, [KITCHEN_ROOM.side - 0.1, 0.005, 0.012], [0, 0.029, z], wall);
  return root;
}

const loadFloor = bundledAsset('floor-surface', floorBytes);

/** Unit-scale floor surface; the independently loaded rug belongs to the scene. */
export function buildFloor(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'floor';
  root.add(loadFloor(models, buildWhitebox(models, palette)));
  return root;
}
