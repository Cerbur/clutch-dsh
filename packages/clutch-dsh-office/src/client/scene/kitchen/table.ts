import * as T from 'three';
import type { Models } from '../models.js';
import type { KitchenPalette } from './shared.js';
import tableBytes from '../../../../assets/models/kitchen/table.glb?inline';
import { bundledAsset } from './asset.js';

/** Origin: floor beneath the preparation table center. Includes board and props. */
function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'table';
  const { blue, wood, white, yellow } = palette;
  models.box(root, [1.8, 0.75, 1.05], [0, 0.45, 0], blue);
  models.box(root, [1.921, 0.12, 1.197], [0, 0.906, 0], wood);
  models.box(root, [0.6, 0.04, 0.36], [-0.15, 0.98, 0], white);
  for (const x of [-0.3, -0.1, 0.07]) models.ball(root, 0.075, [x, 1.05, 0], yellow);
  models.mesh(root, new T.CylinderGeometry(0.15, 0.11, 0.2, 16), white, [0.67, 1.06, -0.01]);
  return root;
}

const loadTable = bundledAsset('table', tableBytes);

/** Keep authored metric scale and the work_surface / prep_anchor hierarchy. */
export function buildTable(models: Models, palette: KitchenPalette): T.Group {
  return loadTable(models, buildWhitebox(models, palette));
}
