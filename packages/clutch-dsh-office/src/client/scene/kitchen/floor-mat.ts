import * as T from 'three';
import floorMatBytes from '../../../../assets/models/kitchen/floor-mat.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const loadFloorMat = bundledAsset('floor-mat', floorMatBytes);

/** Independent walkable floor decoration, authored metric scale and textile PBR. */
export function buildFloorMat(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [1.35, 0.018, 0.77], [0, 0.009, 0], palette.blue);
  return loadFloorMat(models, fallback);
}
