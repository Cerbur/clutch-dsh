import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { Models } from '../models.js';
import { applyKitchenBake, rejectKitchenBake } from '../baked-lighting.js';
import { loadAssetBytes, withAssetSlot, type AssetBytes } from '../asset-bytes.js';
import { limitObjectTextures } from '../texture-budget.js';
import { kitchenTextureSize } from '../render-budget.js';

const lifetimes = new WeakMap<Models, AbortController>();
function lifetime(models: Models): AbortSignal {
  let controller = lifetimes.get(models);
  if (!controller) {
    controller = new AbortController();
    lifetimes.set(models, controller);
    const dispose = models.dispose;
    const abort = controller;
    models.dispose = function () {
      abort.abort();
      dispose.call(this);
    };
    if (models.disposed) controller.abort();
  }
  return controller.signal;
}

/** Per-asset byte cache; each room owns its parsed geometry, materials and bitmaps. */
export function bundledAsset(
  name: string,
  asset: AssetBytes,
  afterLoad?: (scene: T.Group, animations: readonly T.AnimationClip[]) => void,
) {
  return (models: Models, fallback: T.Group): T.Group => {
    const root = new T.Group();
    root.name = name;
    fallback.name = `${name}-whitebox`;
    root.userData.assetState = 'loading';
    root.add(fallback);
    const signal = lifetime(models);
    void withAssetSlot(signal, async () => {
      const bytes = await loadAssetBytes(asset, signal);
      signal.throwIfAborted();
      const { scene, animations = [] } = await new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .parseAsync(bytes, '');
      try {
        await limitObjectTextures(scene, {
          maxSize: kitchenTextureSize(name),
          disposed: () => models.disposed,
        });
      } catch (error) {
        models.ownObject(scene);
        throw error;
      }
      if (!models.ownObject(scene)) {
        return;
      }
      scene.name = `${name}-asset`;
      afterLoad?.(scene, animations);
      root.remove(fallback);
      models.releaseFallbackGeometry(fallback);
      root.add(scene);
      root.userData.assetState = 'ready';
      void applyKitchenBake(
        models,
        name,
        scene,
        bytes,
        typeof asset === 'string' ? undefined : asset,
      );
      models.invalidate();
    }).catch((error: unknown) => {
      if (models.disposed) return;
      root.userData.assetState = 'fallback';
      if (name !== 'deepseek') rejectKitchenBake(models, error);
      console.warn(`Office: ${name} asset unavailable; using the whitebox.`, error);
      models.invalidate();
    });
    return root;
  };
}
