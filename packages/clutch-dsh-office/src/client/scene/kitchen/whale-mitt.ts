import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/whale-mitt.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const load = bundledAsset('whale-mitt', bytes);

/** Static wall decoration; authored bottom/rear-plane origin, no live clock/calendar. */
export function buildWhaleMitt(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [0.25, 0.36, 0.05], [0, 0.18, 0.025], palette.wood);
  return load(models, fallback);
}
