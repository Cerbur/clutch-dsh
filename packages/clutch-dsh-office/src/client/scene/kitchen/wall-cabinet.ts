import * as T from 'three';
import cabinetBytes from '../../../../assets/models/kitchen/wall-cabinet.glb?inline';
import { bundledAsset } from './asset.js';
import type { Models } from '../models.js';
import type { KitchenPalette } from './shared.js';

const loadCabinet = bundledAsset('wall-cabinet', cabinetBytes);

/** Cabinet-bottom origin: mounting height belongs to the scene placement. */
export function buildWallCabinet(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [1.05, 1.05, 0.4], [0, 0.525, 0], palette.blue);
  for (const x of [-0.26, 0.26]) {
    models.box(fallback, [0.5, 1.01, 0.03], [x, 0.525, 0.2], palette.blue);
    models.ball(fallback, 0.035, [x / 3, 0.2, 0.235], palette.wood);
  }
  return loadCabinet(models, fallback);
}
