import * as T from 'three';

/** Fixed-camera HDR color cache with exact per-frame multisample occlusion depth. */
export function createKitchenStaticFrame(
  renderer: T.WebGLRenderer,
  scene: T.Scene,
  camera: T.Camera,
  updateShadows: () => void,
) {
  // Keep the original renderer on devices without renderable half-float color;
  // never silently switch to clipped 8-bit lighting or a lower resolution.
  if (!renderer.extensions.has('EXT_color_buffer_float')) {
    let released = false;
    return {
      invalidate() {},
      render() {
        if (!released) {
          updateShadows();
          renderer.render(scene, camera);
        }
      },
      dispose() {
        released = true;
      },
    };
  }
  const size = new T.Vector2();
  const gl = renderer.getContext();
  const samples = gl.getParameter(gl.SAMPLES) as number;
  const target = new T.WebGLRenderTarget(1, 1, {
    type: T.HalfFloatType,
    minFilter: T.NearestFilter,
    magFilter: T.NearestFilter,
    depthTexture: new T.DepthTexture(1, 1, T.UnsignedIntType),
    samples: 0,
  });
  target.texture.name = 'office-static-linear-color';
  const material = new T.ShaderMaterial({
    uniforms: { colorMap: { value: target.texture }, depthMap: { value: target.depthTexture } },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D colorMap;
      uniform sampler2D depthMap;
      varying vec2 vUv;
      void main() {
        if (texture2D(depthMap, vUv).r >= 1.0) discard;
        gl_FragColor = texture2D(colorMap, vUv);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
    blending: T.NoBlending,
  });
  const quad = new T.Mesh(new T.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const copyScene = new T.Scene();
  copyScene.add(quad);
  const copyCamera = new T.Camera();
  let dirty = true;
  let disposed = false;
  const depthMaterials = new Map<T.Material, T.MeshDepthMaterial>();
  function depthMaterial(source: T.Material): T.MeshDepthMaterial {
    let depth = depthMaterials.get(source);
    if (!depth) {
      const surface = source as T.MeshStandardMaterial;
      depth = new T.MeshDepthMaterial({
        side: source.side,
        alphaTest: source.alphaTest,
        map: source.alphaTest > 0 ? surface.map : null,
        alphaMap: surface.alphaMap,
        displacementMap: surface.displacementMap,
        displacementScale: surface.displacementScale,
        displacementBias: surface.displacementBias,
        colorWrite: false,
        depthTest: source.depthTest,
        depthWrite: source.depthWrite,
        polygonOffset: source.polygonOffset,
        polygonOffsetFactor: source.polygonOffsetFactor,
        polygonOffsetUnits: source.polygonOffsetUnits,
      });
      depthMaterials.set(source, depth);
    }
    return depth;
  }

  function meshes() {
    const dynamic: T.Mesh[] = [],
      fixed: T.Mesh[] = [];
    scene.traverse((object) => {
      if (!(object instanceof T.Mesh) || !object.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (
        object.layers.isEnabled(1) ||
        materials.some((m) => m.userData.officeBakedLighting || m.transparent)
      )
        dynamic.push(object);
      else fixed.push(object);
    });
    return { dynamic, fixed };
  }

  return {
    invalidate() {
      dirty = true;
    },
    render() {
      if (disposed) return;
      let loading = false;
      scene.traverse((object) => {
        if (object.userData.assetState === 'loading') loading = true;
      });
      if (loading) {
        // Do not allocate/rebuild a full-size MSAA cache for each arriving GLB.
        dirty = true;
        updateShadows();
        renderer.render(scene, camera);
        return;
      }
      renderer.getDrawingBufferSize(size);
      if (size.x !== target.width || size.y !== target.height) {
        target.setSize(size.x, size.y);
        dirty = true;
      }
      const previousTarget = renderer.getRenderTarget();
      const autoClear = renderer.autoClear;
      const background = scene.background;
      const { dynamic, fixed } = meshes();
      const actors = dynamic.filter((mesh) => mesh.layers.isEnabled(1));
      const receivers = dynamic.filter((mesh) => !mesh.layers.isEnabled(1));
      const transparent = receivers.filter((mesh) =>
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some((m) => m.transparent),
      );
      const originals = fixed.map((mesh) => mesh.material);
      let capture: T.WebGLRenderTarget | undefined;
      try {
        if (dirty) {
          const used = new Set(
            fixed.flatMap((mesh) =>
              Array.isArray(mesh.material) ? mesh.material : [mesh.material],
            ),
          );
          for (const [source, depth] of depthMaterials) {
            if (!used.has(source)) {
              depth.dispose();
              depthMaterials.delete(source);
            }
          }
          // Clear the actor map while capturing the empty room. Static shadow maps
          // still see every furniture caster, including the baked shell.
          for (const mesh of actors) mesh.visible = false;
          updateShadows();
          // MSAA storage is transient: retain only resolved HDR color and a
          // background mask between frames, rather than four multisample copies.
          capture = target.clone();
          capture.samples = samples;
          renderer.setRenderTarget(capture);
          renderer.autoClear = true;
          renderer.render(scene, camera);
          // Oven glass must blend once against the final scene, not be baked into
          // the opaque cache. First populate static maps with all static casters.
          if (transparent.length) {
            for (const mesh of transparent) mesh.visible = false;
            renderer.render(scene, camera);
            for (const mesh of transparent) mesh.visible = true;
          }
          for (const mesh of actors) mesh.visible = true;
          renderer.setRenderTarget(previousTarget);
          renderer.initRenderTarget(target);
          renderer.copyTextureToTexture(capture.texture, target.texture);
          renderer.copyTextureToTexture(capture.depthTexture!, target.depthTexture!);
          capture.dispose();
          capture = undefined;
          dirty = false;
        }
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = true;
        renderer.render(copyScene, copyCamera);
        scene.background = null;
        renderer.autoClear = false;
        // Rebuild exact multisample depth with cheap depth-only geometry. A resolved
        // depth texture loses per-sample coverage and can reject coplanar shell pixels.
        for (const mesh of dynamic) mesh.visible = false;
        for (const mesh of fixed)
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(depthMaterial)
            : depthMaterial(mesh.material);
        renderer.render(scene, camera);
        for (const mesh of dynamic) mesh.visible = true;
        fixed.forEach((mesh, i) => {
          mesh.material = originals[i];
          mesh.visible = false;
        });
        updateShadows();
        renderer.render(scene, camera);
      } finally {
        for (const mesh of actors) mesh.visible = true;
        for (const mesh of receivers) mesh.visible = true;
        for (const mesh of fixed) mesh.visible = true;
        fixed.forEach((mesh, i) => {
          mesh.material = originals[i];
        });
        scene.background = background;
        renderer.autoClear = autoClear;
        renderer.setRenderTarget(previousTarget);
        capture?.dispose();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      target.dispose();
      quad.geometry.dispose();
      material.dispose();
      for (const depth of depthMaterials.values()) depth.dispose();
      depthMaterials.clear();
      copyScene.clear();
    },
  };
}
