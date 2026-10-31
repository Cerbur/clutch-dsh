import * as T from 'three';
import trashCanBytes from '../../../../assets/models/kitchen/trash-can.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  models.box(root, [0.5, 0.85, 0.6], [0, 0.425, -0.01], palette.white);
  models.box(root, [0.534, 0.11, 0.653], [0, 0.905, 0], palette.blue);
  models.box(root, [0.3, 0.035, 0.12], [0, 0.1, 0.266], palette.dark);
  return root;
}

const loadTrashCan = bundledAsset('trash-can', trashCanBytes);

/** Meter scale, Y-up/+Z front, floor center; retain authored PBR and local-X pivots. */
export function buildTrashCan(models: Models, palette: KitchenPalette): T.Group {
  return loadTrashCan(models, buildWhitebox(models, palette));
}
