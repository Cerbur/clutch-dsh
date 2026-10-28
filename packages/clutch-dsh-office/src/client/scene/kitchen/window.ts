import * as T from 'three';
import windowBytes from '../../../../assets/models/kitchen/window.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const loadWindow = bundledAsset('window', windowBytes);

/** Opaque wall decoration, bottom-center origin; no opening or built-in height. */
export function buildWindow(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  models.box(fallback, [1.05, 0.744, 0.08], [0, 0.372, 0.04], palette.wood);
  models.box(fallback, [0.9, 0.6, 0.02], [0, 0.372, 0.09], palette.white);
  return loadWindow(models, fallback);
}
