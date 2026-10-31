import * as T from 'three';
import { KITCHEN_PRACTICALS } from '../../office/kitchen-practicals.js';

const ID = 'office-window-pane-warm-v2';
const configured = new WeakSet<T.Material>();

/** Reviewed root-local pane mask; preserve the wooden frame, UVs and source PBR. */
export function configureWindowGlow(scene: T.Object3D): void {
  const g = KITCHEN_PRACTICALS.windowGlow;
  scene.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial) || configured.has(material)) continue;
      const compile = material.onBeforeCompile;
      const cache = material.customProgramCacheKey;
      const original = compile.toString();
      const defaultKey = cache === T.Material.prototype.customProgramCacheKey;
      material.onBeforeCompile = function (shader, renderer) {
        compile.call(this, shader, renderer);
        if (
          !shader.vertexShader.includes('#include <begin_vertex>') ||
          !shader.fragmentShader.includes('#include <emissivemap_fragment>')
        )
          throw new Error(ID + ': required material includes missing');
        const varying = 'varying vec3 vOfficeWindowPosition;\nvarying vec3 vOfficeWindowNormal;\n';
        shader.vertexShader =
          varying +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\nvOfficeWindowPosition = position;\nvOfficeWindowNormal = normal;',
          );
        shader.fragmentShader =
          varying +
          shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
          // ${ID}: only recessed panes emit; wood and source maps stay untouched.
          float officePane = step(abs(vOfficeWindowPosition.x), ${g.halfWidth.toFixed(6)})
            * step(${g.minHeight.toFixed(6)}, vOfficeWindowPosition.y)
            * step(vOfficeWindowPosition.y, ${g.maxHeight.toFixed(6)})
            * step(${g.minDepth.toFixed(6)}, vOfficeWindowPosition.z)
            * step(vOfficeWindowPosition.z, ${g.maxDepth.toFixed(6)})
            * smoothstep(0.85, 0.98, normalize(vOfficeWindowNormal).z);
          totalEmissiveRadiance += officePane * vec3(${g.color.join(', ')}) * ${g.intensity.toFixed(6)};`,
          );
      };
      material.customProgramCacheKey = function () {
        return (defaultKey ? original : cache.call(this)) + '|' + ID;
      };
      configured.add(material);
      material.needsUpdate = true;
    }
  });
}
