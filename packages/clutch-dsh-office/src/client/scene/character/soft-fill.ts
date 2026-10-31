import * as T from 'three';

const configured = new WeakSet<T.Material>();
const marker = 'office-character-soft-fill-v1';
const output = '#include <opaque_fragment>';

/** Lift the character's diffuse response without changing the room or source art. */
export function applyCharacterSoftFill(scene: T.Object3D): void {
  scene.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial) || configured.has(material)) continue;
      const compile = material.onBeforeCompile;
      const cacheKey = material.customProgramCacheKey;
      const originalKey =
        cacheKey === T.Material.prototype.customProgramCacheKey ? compile.toString() : undefined;
      material.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer);
        if (!shader.fragmentShader.includes(output))
          throw new Error(marker + ': missing output chunk');
        shader.fragmentShader = shader.fragmentShader.replace(
          output,
          `// ${marker}: texture/vertex-color matched fill, before tone mapping.
          // Keep native specular, normal detail and the room's shadow contrast.
          outgoingLight += totalDiffuse * 0.25 + diffuseColor.rgb * 0.22;
          ${output}`,
        );
      };
      material.customProgramCacheKey = function () {
        return (originalKey ?? cacheKey.call(this)) + '|' + marker;
      };
      configured.add(material);
      material.needsUpdate = true;
    }
  });
}
