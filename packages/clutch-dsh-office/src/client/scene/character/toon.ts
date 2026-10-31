import * as T from 'three';

const configured = new WeakSet<T.Material>();
const marker = 'office-character-cel-v1';
const output = '#include <opaque_fragment>';

/** Character-only three-band shading. Keep native skinning, morphs and textures. */
export function applyCharacterToon(scene: T.Object3D): void {
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
          `
          // ${marker}: fixed world-space art key follows the kitchen's upper/front softbox.
          vec3 celKey = normalize((viewMatrix * vec4(-0.45, 0.8, 0.55, 0.0)).xyz);
          float celNdotL = dot(normal, celKey);
          float celWidth = max(fwidth(celNdotL) * 1.5, 0.025);
          float celMid = smoothstep(0.02 - celWidth, 0.02 + celWidth, celNdotL);
          float celBright = smoothstep(0.55 - celWidth, 0.55 + celWidth, celNdotL);
          vec3 celShade = mix(vec3(0.46, 0.47, 0.66), vec3(0.79, 0.82, 0.94), celMid);
          celShade = mix(celShade, vec3(1.12, 1.10, 1.08), celBright);
          // A small bounded contribution keeps room occlusion readable without washing out bands.
          vec3 celRoom = clamp(totalDiffuse / max(diffuseColor.rgb, vec3(0.025)), vec3(0.3), vec3(1.2));
          float celRim = smoothstep(0.72, 0.9, 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0));
          outgoingLight = diffuseColor.rgb * (celShade * mix(vec3(1.0), celRoom, 0.12)
            + vec3(0.045, 0.065, 0.09) * celRim);
          ${output}
        `,
        );
      };
      material.customProgramCacheKey = function () {
        return (originalKey ?? cacheKey.call(this)) + '|' + marker;
      };
      // Authored color highlights stay; reconstructed normal noise must not fragment the bands.
      material.normalScale.set(0, 0);
      material.userData.characterShading = marker;
      configured.add(material);
      material.needsUpdate = true;
    }
  });
}
