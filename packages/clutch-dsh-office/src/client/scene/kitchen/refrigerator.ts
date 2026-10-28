import * as T from 'three';
import refrigeratorBytes from '../../../../assets/models/kitchen/refrigerator.glb?inline';
import type { Models } from '../models.js';
import { plant, type KitchenPalette } from './shared.js';
import { bundledAsset } from './asset.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'refrigerator-whitebox';
  const { blue, white, metal, dark } = palette;
  models.box(root, [1.05, 1.95, 0.98], [0, 1, 0], blue);
  models.box(root, [0.99, 1.12, 0.04], [0, 1.39, 0.51], white);
  models.box(root, [0.99, 0.65, 0.04], [0, 0.44, 0.51], blue);
  models.box(root, [0.055, 0.38, 0.07], [-0.36, 1.47, 0.56], metal);
  models.ball(root, 0.19, [0.1, 1.42, 0.56], blue, [1, 0.65, 0.16]);
  for (const x of [0.03, 0.17]) models.ball(root, 0.018, [x, 1.45, 0.6], dark);
  plant(models, root, palette, [0, 2.07, 0]);
  return root;
}

const loadRefrigerator = bundledAsset('refrigerator', refrigeratorBytes);

/** Authored in meters, Y-up/+Z front, origin at the floor beneath its center. */
export function buildRefrigerator(models: Models, palette: KitchenPalette): T.Group {
  return loadRefrigerator(models, buildWhitebox(models, palette));
}
