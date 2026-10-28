import * as T from 'three';
import sinkBytes from '../../../../assets/models/kitchen/sink-cabinet.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'sink-cabinet-whitebox';
  const { white, blue, metal, wood, green } = palette;
  models.box(root, [1.65, 0.8, 0.7], [0, 0.46, 0], blue);
  models.box(root, [1.69, 0.08, 0.74], [0, 0.9, 0], white);
  models.box(root, [1.46, 0.25, 0.42], [-0.05, 0.965, 0], metal);
  models.box(root, [1.2, 0.02, 0.28], [-0.05, 0.84, 0], white);
  models.mesh(root, new T.CylinderGeometry(0.025, 0.025, 0.48, 12), metal, [0.46, 1.15, -0.05]);
  models.box(root, [0.28, 0.03, 0.035], [0.34, 1.38, -0.05], metal);
  models.box(root, [0.54, 0.62, 0.035], [-0.48, 0.49, 0.37], white);
  models.box(root, [0.54, 0.62, 0.035], [0.1, 0.49, 0.37], white);
  models.box(root, [0.72, 0.62, 0.035], [0.43, 0.49, 0.37], blue);
  models.box(root, [0.46, 0.04, 0.36], [0.48, 0.965, 0.1], wood);
  models.ball(root, 0.1, [0.59, 1.03, 0.1], green);
  return root;
}

const loadSinkCabinet = bundledAsset('sink-cabinet', sinkBytes);

/** Original metric root; the current r2 is a single static assembly. */
export function buildSinkCabinet(models: Models, palette: KitchenPalette): T.Group {
  return loadSinkCabinet(models, buildWhitebox(models, palette));
}
