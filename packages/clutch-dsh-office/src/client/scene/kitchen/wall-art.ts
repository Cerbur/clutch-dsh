import * as T from 'three';
import artBytes from '../../../../assets/models/kitchen/wall-art.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  models.box(root, [0.64, 0.64, 0.06], [0, 0, 0.03], palette.wood);
  models.box(root, [0.53, 0.53, 0.01], [0, 0, 0.065], palette.white);
  models.ball(root, 0.17, [0, 0, 0.075], palette.blue, [1.2, 0.75, 0.1]);
  models.ball(root, 0.015, [-0.1, 0.02, 0.094], palette.dark);
  return root;
}

const loadWallArt = bundledAsset('wall-art', artBytes);

/** Wall-plane center, with no built-in installation height or normalization. */
export function buildWallArt(models: Models, palette: KitchenPalette): T.Group {
  return loadWallArt(models, buildWhitebox(models, palette));
}
