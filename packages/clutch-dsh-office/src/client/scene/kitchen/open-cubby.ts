import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/open-cubby.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const load = bundledAsset('open-cubby', bytes);
export function buildOpenCubby(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [0.22, 0.73738, 0.157793], [0, 0.36869, 0.0788965], palette.wood);
  return load(models, fallback);
}
