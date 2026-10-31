import * as T from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import type { Models } from '../models.js';

interface Template {
  scene: T.Group;
  animations: readonly T.AnimationClip[];
}

/** One room owns immutable GPU data; each actor owns only its cloned skeleton/mixer. */
export function createCharacterTemplate(owner: Models, load: () => Promise<Template>) {
  let pending: Promise<Template | undefined> | undefined;
  return {
    async instantiate(actor: Models): Promise<Template | undefined> {
      if (owner.disposed || actor.disposed) return;
      pending ??= load()
        .then((template) => {
          if (!owner.ownObject(template.scene)) return;
          return template;
        })
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
      const template = await pending;
      if (!template || owner.disposed || actor.disposed) return;
      const scene = clone(template.scene) as T.Group;
      // SkeletonUtils clones per mesh, even when several meshes use one rig.
      // Rejoin those rigs within this actor only (never across actors).
      const sourceRigs: T.Skeleton[] = [];
      template.scene.traverse((object) => {
        if (object instanceof T.SkinnedMesh) sourceRigs.push(object.skeleton);
      });
      const rigs = new Map<T.Skeleton, T.Skeleton>();
      let rigIndex = 0;
      const skeletons = new Set<T.Skeleton>();
      scene.traverse((object) => {
        if (object instanceof T.Mesh) object.layers.enable(1);
        if (object instanceof T.SkinnedMesh) {
          const source = sourceRigs[rigIndex++];
          const shared = rigs.get(source);
          if (shared) {
            object.skeleton.dispose();
            object.skeleton = shared;
          } else rigs.set(source, object.skeleton);
          skeletons.add(object.skeleton);
        }
      });
      actor.onDispose(() => {
        for (const skeleton of skeletons) skeleton.dispose();
      });
      return { scene, animations: template.animations };
    },
  };
}
