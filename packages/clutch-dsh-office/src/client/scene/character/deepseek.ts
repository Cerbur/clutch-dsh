import * as T from 'three';
import deepseekBytes from '../../../../assets/models/character/deepseek.glb?inline';
import { bundledAsset } from '../kitchen/asset.js';
import { buildWhaleGirl, type CharacterAppearance, type Models } from '../models.js';
import { createCharacterAnimation } from './animation.js';

/** Each actor parses an independent skeleton/morph state; byte transport is shared. */
export function buildDeepSeek(models: Models, seat: 0 | 1 | 2 | 3): CharacterAppearance {
  const fallback = buildWhaleGirl(models, (seat % 2) as 0 | 1);
  const appearance: CharacterAppearance = {
    root: new T.Group(),
    body: fallback.body,
    arm: fallback.arm,
    tail: fallback.tail,
  };
  const load = bundledAsset('deepseek', deepseekBytes, (scene, clips) => {
    appearance.body = scene.getObjectByName('body') ?? scene;
    appearance.arm = undefined;
    appearance.tail = undefined;
    appearance.animation = createCharacterAnimation(scene, clips);
    const animation = appearance.animation;
    if (animation) models.onDispose(() => animation.dispose());
  });
  appearance.root = load(models, fallback.root);
  return appearance;
}
