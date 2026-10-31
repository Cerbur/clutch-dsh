import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/black-utensil-rail.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const load = bundledAsset('black-utensil-rail', bytes);
export function buildBlackUtensilRail(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [0.82, 0.625123, 0.138354], [0, 0.3125615, 0.069177], palette.wood);
  return load(models, fallback);
}
