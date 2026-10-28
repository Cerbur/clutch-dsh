import * as T from 'three';
import bytes from '../../../../assets/models/kitchen/wall-plant.glb?inline';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_INSTANCE_GROUPS,
} from '../../../office/kitchen-layout.js';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

/** Clone object transforms only; both hanging pots share their room-owned PBR resources. */
function addPlants(root: T.Group, plant: T.Group): void {
  const instances = [plant, plant.clone(true)];
  for (const [i, key] of KITCHEN_INSTANCE_GROUPS['wall-plants'].entries()) {
    const instance = instances[i];
    instance.name = key;
    instance.position.fromArray(KITCHEN_PLACEMENT[key as keyof typeof KITCHEN_PLACEMENT]);
    instance.rotation.y = KITCHEN_ROTATION[key as keyof typeof KITCHEN_ROTATION] ?? 0;
    root.add(instance);
  }
}

const load = bundledAsset('wall-plants', bytes, (scene) => {
  const plant = new T.Group();
  plant.add(...scene.children);
  addPlants(scene, plant);
});

export function buildWallPlants(models: Models, palette: KitchenPalette): T.Group {
  const fallback = new T.Group();
  const plant = new T.Group();
  models.box(plant, [0.28, 0.22, 0.15], [0, 0.11, 0.075], palette.white);
  models.ball(plant, 0.14, [0, 0.35, 0.12], palette.green, [1.2, 1, 0.8]);
  addPlants(fallback, plant);
  return load(models, fallback);
}
