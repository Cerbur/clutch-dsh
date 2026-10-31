import * as T from 'three';
import chairBytes from '../../../../assets/models/kitchen/chair.glb?inline';
import { KITCHEN_PLACEMENT } from '../../../office/kitchen-layout.js';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

/** Clone only the object tree: both seats share their owner's geometry and PBR. */
function addChairs(root: T.Group, chair: T.Group): void {
  const instances = [chair, chair.clone(true)];
  for (const [i, key] of (['chair-left', 'chair-right'] as const).entries()) {
    const instance = instances[i];
    instance.name = key;
    instance.position.fromArray(KITCHEN_PLACEMENT[key]);
    root.add(instance);
  }
}

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  const chair = new T.Group();
  models.mesh(chair, new T.CylinderGeometry(0.26, 0.26, 0.08, 20), palette.wood, [0, 0.53, 0]);
  models.mesh(chair, new T.CylinderGeometry(0.23, 0.23, 0.05, 20), palette.blue, [0, 0.595, 0]);
  for (const x of [-0.17, 0.17]) {
    for (const z of [-0.17, 0.17]) {
      models.box(chair, [0.06, 0.49, 0.06], [x, 0.245, z], palette.wood);
    }
  }
  addChairs(root, chair);
  return root;
}

const loadChairs = bundledAsset('chairs', chairBytes, (scene) => {
  // bundledAsset has registered the parsed resources exactly once before this callback.
  const chair = new T.Group();
  chair.add(...scene.children);
  addChairs(scene, chair);
});

/** One embedded GLB and one parse per room; placement belongs to each child seat. */
export function buildChairs(models: Models, palette: KitchenPalette): T.Group {
  return loadChairs(models, buildWhitebox(models, palette));
}
