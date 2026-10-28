import * as T from 'three';
import hoodBytes from '../../../../assets/models/kitchen/range-hood.glb?inline';
import { bundledAsset } from './asset.js';
import type { Models } from '../models.js';
import type { KitchenPalette } from './shared.js';

const loadHood = bundledAsset('range-hood', hoodBytes);

/** Floor-projection origin; the delivery already includes its installation height. */
export function buildRangeHood(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [1.06, 0.18, 0.63], [0, 1.82, 0.015], palette.metal);
  models.box(fallback, [0.55, 0.85, 0.35], [0, 2.335, -0.12], palette.metal);
  return loadHood(models, fallback);
}
