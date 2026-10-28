import * as T from 'three';
import pendantBytes from '../../../../assets/models/kitchen/pendant-light.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';
import { KITCHEN_LIGHTING } from '../lighting.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'pendant-light-whitebox';
  const { dark, white, blue, metal } = palette;
  models.mesh(root, new T.CylinderGeometry(0.018, 0.018, 0.55, 10), dark, [0, 2.62, 0]);
  models.mesh(root, new T.CylinderGeometry(0.055, 0.055, 0.08, 12), white, [0, 2.88, 0]);
  models.ball(root, 0.25, [0, 2.34, 0], blue, [0.86, 0.75, 1]);
  models.ball(root, 0.2, [0, 2.27, 0.08], white, [0.9, 0.55, 0.82]);
  for (const x of [-0.1, 0.1]) models.ball(root, 0.022, [x, 2.4, 0.215], dark, [0.8, 1.25, 0.45]);
  models.ball(root, 0.07, [-0.19, 2.3, 0], blue, [1.8, 0.55, 0.35]);
  models.ball(root, 0.07, [0.19, 2.3, 0], blue, [1.8, 0.55, 0.35]);
  models.mesh(root, new T.CylinderGeometry(0.012, 0.012, 0.13, 8), metal, [0, 2.82, 0]);
  return root;
}

function addKitchenGlow(scene: T.Group): void {
  const anchor = scene.getObjectByName('light_anchor');
  if (!anchor || anchor.getObjectByName('pendant-light-glow')) return;
  const { color, intensity, distance } = KITCHEN_LIGHTING.pendant;
  const light = new T.PointLight(color, intensity, distance, 2);
  light.name = 'pendant-light-glow';
  light.castShadow = false;
  anchor.add(light);
}

const loadPendant = bundledAsset('pendant-light', pendantBytes, addKitchenGlow);

/** Metric floor-projection root; visible suspension begins around y=2.16. */
export function buildPendantLight(models: Models, palette: KitchenPalette): T.Group {
  return loadPendant(models, buildWhitebox(models, palette));
}
