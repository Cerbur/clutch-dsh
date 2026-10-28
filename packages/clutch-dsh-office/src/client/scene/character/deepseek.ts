import * as T from 'three';
import deepseekBytes from '../../../../assets/models/character/deepseek.glb?inline';
import { bundledAsset } from '../kitchen/asset.js';
import { buildWhaleGirl, type CharacterAppearance, type Models } from '../models.js';

/** Static delivered character with a procedural fallback until the GLB is parsed. */
export function buildDeepSeek(models: Models, seat: 0 | 1): CharacterAppearance {
  const fallback = buildWhaleGirl(models, seat);
  const appearance: CharacterAppearance = {
    root: new T.Group(),
    body: fallback.body,
    arm: fallback.arm,
    tail: fallback.tail,
  };
  const load = bundledAsset('deepseek', deepseekBytes, (scene) => {
    appearance.body = scene.getObjectByName('body') ?? scene;
    appearance.arm = undefined;
    appearance.tail = undefined;
  });
  appearance.root = load(models, fallback.root);
  return appearance;
}
