import * as T from 'three';
import wallBytes from '../../../../assets/models/kitchen/left-wall.glb?inline';
import type { Models } from '../models.js';
import { bundledAsset } from './asset.js';
import type { KitchenPalette } from './shared.js';

function buildWhitebox(models: Models, palette: KitchenPalette): T.Group {
  const root = new T.Group();
  root.name = 'left-wall-whitebox';
  models.box(root, [5, 3.5, 0.285], [0, 1.75, -0.0825], palette.wall);
  return root;
}

const loadLeftWall = bundledAsset('left-wall', wallBytes);

/** Authored along local X, then installed as the x-facing room wall by the scene. */
export function buildLeftWall(models: Models, palette: KitchenPalette): T.Group {
  return loadLeftWall(models, buildWhitebox(models, palette));
}
