import * as T from 'three';
import rugBytes from '../../../../assets/models/kitchen/rug.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  models.ball(root, 0.5, [-0.1, 0.013, 0], palette.blue, [1.4, 0.026, 0.94]);
  models.ball(root, 0.2, [0.6, 0.013, 0], palette.blue, [1, 0.065, 1.5]);
  models.ball(root, 0.025, [-0.5, 0.026, 0.15], palette.dark, [1, 0.08, 1]);
  return root;
}

const loadRug = bundledAsset('rug', rugBytes);

/** Underside footprint center, head -X/tail +X; keep the authored 26 mm thickness. */
export function buildRug(models: Models, palette: KitchenPalette): T.Group {
  return loadRug(models, buildWhitebox(models, palette));
}
