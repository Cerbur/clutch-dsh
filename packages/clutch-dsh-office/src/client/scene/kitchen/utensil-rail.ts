import * as T from 'three';
import railBytes from '../../../../assets/models/kitchen/utensil-rail.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const loadRail = bundledAsset('utensil-rail', railBytes);

/** Wall-plane origin at the rail axis; authored hanging geometry extends down. */
export function buildUtensilRail(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  const orange = models.material('#db8c30', 0.42);
  const bar = models.mesh(
    fallback,
    new T.CylinderGeometry(0.035, 0.035, 0.94, 12),
    orange,
    [0, 0, 0.08],
  );
  bar.rotation.z = Math.PI / 2;
  for (const x of [-0.43, 0.43]) {
    const mount = models.mesh(fallback, new T.CylinderGeometry(0.07, 0.07, 0.04, 12), orange, [
      x,
      0,
      0.025,
    ]);
    mount.rotation.x = Math.PI / 2;
  }
  for (const x of [-0.25, 0, 0.25]) {
    models.box(fallback, [0.025, 0.4, 0.025], [x, -0.25, 0.13], palette.wood);
    models.ball(fallback, 0.07, [x, -0.49, 0.13], palette.wood, [0.8, 1.2, 0.3]);
  }
  return loadRail(models, fallback);
}
