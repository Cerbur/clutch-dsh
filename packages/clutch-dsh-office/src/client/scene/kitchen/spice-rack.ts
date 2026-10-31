import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/spice-rack.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const load = bundledAsset('spice-rack', bytes);
export function buildSpiceRack(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [0.74, 0.703457, 0.269506], [0, 0.3517285, 0.134753], palette.wood);
  return load(models, fallback);
}
