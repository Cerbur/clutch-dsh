import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/board-cloth.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const load = bundledAsset('board-cloth', bytes);

/** Static wall decoration; authored bottom/rear-plane origin, no live clock/calendar. */
export function buildBoardCloth(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [0.32, 0.5, 0.08], [0, 0.25, 0.04], palette.wood);
  return load(models, fallback);
}
