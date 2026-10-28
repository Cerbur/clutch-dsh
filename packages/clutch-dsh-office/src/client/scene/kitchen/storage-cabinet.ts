import * as T from 'three';
import cabinetBytes from '../../../../assets/models/kitchen/storage-cabinet.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

const loadCabinet = bundledAsset('storage-cabinet', cabinetBytes);

/** Static delivered cart and props; the new single mesh has no independent wheel pivots. */
export function buildStorageCabinet(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  for (const x of [-0.45, 0.45]) {
    for (const z of [-0.27, 0.27]) {
      models.box(fallback, [0.045, 0.75, 0.045], [x, 0.5, z], palette.metal);
      const wheel = models.mesh(
        fallback,
        new T.CylinderGeometry(0.068, 0.068, 0.04, 12),
        palette.dark,
        [x, 0.068, z],
      );
      wheel.rotation.x = Math.PI / 2;
    }
  }
  for (const y of [0.19, 0.48, 0.87])
    models.box(fallback, [1.05, 0.06, 0.7], [0, y, 0], palette.wood);
  return loadCabinet(models, fallback);
}
