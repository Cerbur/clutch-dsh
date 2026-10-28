import * as T from 'three';
import shelfBytes from '../../../../assets/models/kitchen/wall-shelf.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import { plant, type KitchenPalette } from './shared.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  for (const y of [1.8592, 2.3]) {
    models.box(root, [1.6, 0.09, 0.5], [0, y - 0.045, 0.25], palette.wood);
  }
  for (let i = 0; i < 4; i++) {
    models.mesh(root, new T.CylinderGeometry(0.15, 0.12, 0.05, 16), palette.white, [
      0.3,
      1.8842 + i * 0.05,
      0.25,
    ]);
  }
  plant(models, root, palette, [-0.5, 2.4, 0.25]);
  models.ball(root, 0.18, [0.45, 2.48, 0.25], palette.blue, [1.2, 0.8, 0.8]);
  return root;
}

const loadWallShelf = bundledAsset('wall-shelf', shelfBytes);

/** Rear-envelope ground projection; installation height is already authored. */
export function buildWallShelf(models: Models, palette: KitchenPalette): T.Group {
  return loadWallShelf(models, buildWhitebox(models, palette));
}
