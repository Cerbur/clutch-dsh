import type { Camera, Object3D, Scene, SpotLight, WebGLRenderer } from 'three';

/** Queue a layer-1 pass inside Three's shadow stage, when its render state is live. */
export function createCharacterShadowPass(
  renderer: Pick<WebGLRenderer, 'shadowMap'>,
  scene: Scene,
  proxy: SpotLight,
): { update(camera: Camera): void; dispose(): void } {
  const shadowMap = renderer.shadowMap;
  const original = shadowMap.render;
  let requested: Camera | undefined;
  let passCamera: Camera | undefined;
  let disposed = false;
  proxy.shadow.autoUpdate = false;
  proxy.shadow.needsUpdate = false;

  const render: typeof shadowMap.render = function (lights, renderScene, camera) {
    if (!disposed && renderScene === scene) {
      // Even an initially empty room needs a cleared map before setupLights samples it.
      const source = requested ?? (proxy.shadow.map === null ? camera : undefined);
      if (source) {
        if (!passCamera || passCamera.constructor !== source.constructor)
          passCamera = source.clone();
        else passCamera.copy(source, false);
        passCamera.layers.set(1);
        const needsUpdate = shadowMap.needsUpdate;
        shadowMap.needsUpdate = true;
        proxy.shadow.needsUpdate = true;
        try {
          original.call(shadowMap, [proxy], scene, passCamera);
          requested = undefined;
        } finally {
          shadowMap.needsUpdate = needsUpdate;
          // The subsequent normal pass must never repaint this map with static casters.
          proxy.shadow.needsUpdate = false;
        }
      }
    }
    if (!disposed && renderScene === scene && (shadowMap.autoUpdate || shadowMap.needsUpdate)) {
      // These cached maps still shade moving characters with furniture occlusion.
      // Never bake a character's old position into them; its dedicated map above
      // supplies the moving key shadow on baked receivers instead.
      const dynamicCasters: Object3D[] = [];
      scene.traverse((object) => {
        if (object.castShadow && object.layers.isEnabled(1)) {
          dynamicCasters.push(object);
          object.castShadow = false;
        }
      });
      try {
        original.call(shadowMap, lights, renderScene, camera);
      } finally {
        for (const object of dynamicCasters) object.castShadow = true;
      }
    } else original.call(shadowMap, lights, renderScene, camera);
  };
  shadowMap.render = render;

  return {
    update(camera) {
      if (disposed) return;
      if (shadowMap.render !== render)
        throw new Error('Kitchen character shadow stage was replaced');
      requested = camera;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      requested = undefined;
      if (shadowMap.render === render) shadowMap.render = original;
    },
  };
}
