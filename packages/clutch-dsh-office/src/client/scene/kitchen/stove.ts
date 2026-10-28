import * as T from 'three';
import stoveBytes from '../../../../assets/models/kitchen/stove.glb?inline';
import { bundledAsset } from './asset.js';
import type { Models } from '../models.js';
import type { KitchenPalette } from './shared.js';

const loadStove = bundledAsset('stove', stoveBytes);

/** Origin: floor beneath the worktop center. Includes cabinets and two burners. */
export function buildStove(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'stove';
  const { white, wood, blue, metal, dark, green } = palette;
  models.box(root, [1.7, 0.8, 0.8], [0, 0.44, -0.03], white);
  models.box(root, [1.8, 0.09, 0.88], [0, 0.855, 0], wood);
  for (const x of [-0.55, 0, 0.55]) {
    models.box(root, [0.5, 0.65, 0.035], [x, 0.44, 0.4], blue);
    models.box(root, [0.22, 0.035, 0.06], [x, 0.66, 0.44], metal);
  }
  for (const x of [-0.4, 0.4]) {
    models.mesh(root, new T.CylinderGeometry(0.26, 0.26, 0.045, 24), dark, [x, 0.92, 0.05]);
    models.mesh(root, new T.CylinderGeometry(0.28, 0.18, 0.12, 24), metal, [x, 0.995, 0.05]);
    models.ball(root, 0.16, [x, 1.045, 0.05], green, [1, 0.25, 1]);
    models.box(root, [0.07, 0.05, 0.38], [x, 0.995, 0.43], dark);
  }
  return loadStove(models, root);
}
