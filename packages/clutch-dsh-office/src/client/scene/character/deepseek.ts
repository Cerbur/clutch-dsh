import * as T from 'three';
import deepseekBytes from '../../../../assets/models/character/deepseek.glb?inline';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildWhaleGirl, type CharacterAppearance, Models } from '../models.js';
import { loadAssetBytes, withAssetSlot } from '../asset-bytes.js';
import { limitObjectTextures } from '../texture-budget.js';
import { createCharacterTemplate } from './template.js';
import { createCharacterAnimation } from './animation.js';
import { applyCharacterSoftFill } from './soft-fill.js';

const templates = new WeakMap<Models, ReturnType<typeof createCharacterTemplate>>();

/** Shared room template with independent skeletal/morph/animation state. */
export function buildDeepSeek(
  models: Models,
  seat: 0 | 1 | 2 | 3,
  owner = models,
): CharacterAppearance {
  let template = templates.get(owner);
  if (!template) {
    const controller = new AbortController();
    owner.onDispose(() => controller.abort());
    template = createCharacterTemplate(owner, () =>
      withAssetSlot(controller.signal, async () => {
        const bytes = await loadAssetBytes(deepseekBytes, controller.signal);
        controller.signal.throwIfAborted();
        const gltf = await new GLTFLoader().parseAsync(bytes, '');
        try {
          await limitObjectTextures(gltf.scene, { disposed: () => owner.disposed });
          applyCharacterSoftFill(gltf.scene);
          return gltf;
        } catch (error) {
          const cleanup = new Models();
          cleanup.ownObject(gltf.scene);
          cleanup.dispose();
          throw error;
        }
      }),
    );
    templates.set(owner, template);
  }
  const fallbackModels = new Models(() => models.invalidate(), true);
  models.onDispose(() => fallbackModels.dispose());
  const fallback = buildWhaleGirl(fallbackModels, (seat % 2) as 0 | 1);
  const appearance: CharacterAppearance = {
    root: new T.Group(),
    body: fallback.body,
    arm: fallback.arm,
    tail: fallback.tail,
  };
  const root = appearance.root;
  root.name = 'deepseek';
  root.userData.assetState = 'loading';
  root.add(fallback.root);
  void template
    .instantiate(models)
    .then((instance) => {
      if (!instance || models.disposed || owner.disposed) return;
      const { scene, animations: clips } = instance;
      appearance.body = scene.getObjectByName('body') ?? scene;
      appearance.arm = undefined;
      appearance.tail = undefined;
      appearance.animation = createCharacterAnimation(scene, clips);
      const animation = appearance.animation;
      if (animation) models.onDispose(() => animation.dispose());
      root.remove(fallback.root);
      fallbackModels.dispose();
      root.add(scene);
      root.userData.assetState = 'ready';
      models.invalidate();
    })
    .catch((error: unknown) => {
      if (models.disposed) return;
      root.userData.assetState = 'fallback';
      console.warn('Office: deepseek asset unavailable; using the whitebox.', error);
      models.invalidate();
    });
  return appearance;
}
