import * as T from 'three';
import { KITCHEN_ROOM } from '../../../office/kitchen-layout.js';
import type { Models } from '../models.js';
import type { KitchenPalette } from './shared.js';
import wallBytes from '../../../../assets/models/kitchen/right-wall.glb?inline';
import { bundledAsset } from './asset.js';

const loadRightWall = bundledAsset('right-wall', wallBytes);

/** Wall only; the separate wall-shelf asset owns its own decorations. */
export function buildRightWall(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(
    fallback,
    [KITCHEN_ROOM.side, KITCHEN_ROOM.wallHeight, 0.285],
    [0, KITCHEN_ROOM.wallHeight / 2, -0.0825],
    palette.wall,
  );
  return loadRightWall(models, fallback);
}
