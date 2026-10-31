import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/wall-storage-box.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const load = bundledAsset('wall-storage-box', bytes);
export function buildWallStorageBox(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [0.38, 0.301498, 0.180226], [0, 0.150749, 0.090113], palette.wood);
  return load(models, fallback);
}
