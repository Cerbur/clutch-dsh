import * as T from 'three';
import { KITCHEN_PRACTICALS } from '../../office/kitchen-practicals.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createCharacterShadowPass } from './character-shadow.js';
import { sampleIndirectEnvironment } from './indirect-environment.js';

/** Review-light translation; intensities are Three.js calibration values, not Blender watts. */
export const KITCHEN_LIGHTING = {
  id: 'kitchen-candy-indirect-s1-v1',
  background: '#222222',
  exposure: 1,
  environmentIntensity: 1,
  environment: {
    sigma: 0.065,
    size: 128,
    // Passive low-frequency room reflections. All values are linear radiance.
    base: [0.085, 0.083, 0.079],
    lobes: [
      { direction: [0, 1, 0], radiance: [0.12, 0.118, 0.112], exponent: 2 },
      { direction: [0, -1, 0], radiance: [0.055, 0.04, 0.025], exponent: 2 },
      { direction: [0.58, 0.25, 0.77], radiance: [0.4, 0.388, 0.364], exponent: 8 },
      { direction: [-0.7, 0.15, -0.7], radiance: [0.045, 0.033, 0.021], exponent: 4 },
    ],
  },
  target: [0, 1, 0],
  // PCF radius is in shadow texels, independently tunable from emitter size in meters.
  // near/far control perspective depth precision; bias is normalized depth, not meters.
  shadow: { bias: -0.00015, normalBias: 0.008, near: 0.5, far: 24 },
  areaLights: [
    {
      name: 'review-key-area',
      position: [5, 8, 7],
      size: 6,
      color: [1, 0.86, 0.75],
      watts: 950,
      intensity: 950 / (Math.PI * 6 * 6),
      shadowSize: 1024,
      shadowRadius: 8,
      shadowAngle: Math.PI / 5,
    },
    {
      name: 'review-fill-area',
      position: [-4, 5, 2],
      size: 5,
      color: [0.78, 0.85, 1],
      watts: 250,
      intensity: 250 / (Math.PI * 5 * 5),
      shadowSize: 512,
      shadowRadius: 4,
      shadowAngle: Math.PI / 3.6,
    },
    {
      name: 'review-rim-area',
      position: [3, 6, -5],
      size: 4,
      color: [1, 0.89, 0.78],
      watts: 250,
      intensity: 250 / (Math.PI * 4 * 4),
      shadowSize: 512,
      shadowRadius: 4,
      shadowAngle: Math.PI / 4,
    },
  ],
  // Broad low-energy front polish: no additional shadow map, shell diffuse stays Cycles-baked.
  frontFill: { position: [5, 4.5, 7], size: 5, color: [1, 0.94, 0.86], watts: 80 },
  dynamicShadow: { mapSize: 512, radius: 8, directFraction: 0.7 },
  practicals: KITCHEN_PRACTICALS,
  sourceBlender: {
    script: 'sync/evidence/2026-10-28-cycles-lighting/review_storage_sink_office.py',
    image: 'sync/evidence/2026-10-28-cycles-lighting/cycles-review.png',
    engine: 'CYCLES',
    device: 'CPU',
    samples: 20,
    viewTransform: 'Khronos PBR Neutral',
    exposureStops: 0,
    coordinateTransform: '(x,y,z) -> (x,z,-y)',
    target: [0, 0, 1],
    world: {
      color: [0.18, 0.18, 0.18],
      useNodes: true,
      nodeColor: [0.05, 0.05, 0.05],
      strength: 1,
      weight: 0,
      interpretation:
        'Official Blender 5.2.3 probe: new world already uses nodes; Background emits constant linear .05 at strength 1. Legacy world.color .18 is unused.',
    },
    areas: [
      { position: [5, -7, 8], watts: 950, size: 6, linearColor: [1, 0.86, 0.75] },
      { position: [-4, -2, 5], watts: 250, size: 5, linearColor: [0.78, 0.85, 1] },
      { position: [3, 5, 6], watts: 250, size: 4, linearColor: [1, 0.89, 0.78] },
    ],
    approximation:
      'Initial radiance P/(pi*area), no extra pi in the normalized LTC diffuse integral; source watts are not photometric calibration. LTC direct diffuse/specular share a fixed 16-tap Poisson PCF center-shadow projection from a zero-intensity spot per area. The frozen Cycles world remains .05. Stage1 runtime PMREM approximates passive directional room bounce for furniture; no extra Hemisphere or duplicated direct emitters. Partial emitter visibility and full Cycles GI are not reproduced.',
  },
} as const;

function linearColor(rgb: readonly [number, number, number]): T.Color {
  return new T.Color().setRGB(...rgb, T.LinearSRGBColorSpace);
}

// LTC lookup textures belong to the shared Three.js library, not an individual room.
// Reinitializing per room would replace/leak them; renderer.dispose releases each context's copies.
let areaUniformsReady = false;

/** Three LTC softboxes with zero-energy shadow proxies; requires configureKitchenMaterial. */
export function createKitchenLightRig(scene: T.Scene): {
  characterShadow: T.SpotLight;
  dispose(): void;
} {
  if (!areaUniformsReady) {
    RectAreaLightUniformsLib.init();
    areaUniformsReady = true;
  }
  const root = new T.Group();
  root.name = KITCHEN_LIGHTING.id;
  // Diffuse bounce and reflections share the same PMREM; no duplicate Hemisphere term.
  const shadows: T.SpotLight[] = [];
  // Insertion order is part of area-shadow.ts's private three-light contract.
  for (const [index, spec] of KITCHEN_LIGHTING.areaLights.entries()) {
    const light = new T.RectAreaLight(
      linearColor(spec.color),
      spec.intensity,
      spec.size,
      spec.size,
    );
    light.name = spec.name;
    light.position.fromArray(spec.position);
    light.lookAt(...KITCHEN_LIGHTING.target);
    // A spot contributes no radiance: its shadow map only masks the paired LTC color.
    // One blurred center projection is an approximation to a large emitter's visibility.
    const proxy = new T.SpotLight(linearColor(spec.color), 0, 0, spec.shadowAngle, 0, 2);
    proxy.name = index === 0 ? 'warm-key' : spec.name + '-shadow';
    proxy.position.copy(light.position);
    proxy.target.position.set(...KITCHEN_LIGHTING.target);
    proxy.castShadow = true;
    proxy.shadow.mapSize.set(spec.shadowSize, spec.shadowSize);
    proxy.shadow.camera.near = KITCHEN_LIGHTING.shadow.near;
    proxy.shadow.camera.far = KITCHEN_LIGHTING.shadow.far;
    // Wide static PCF needs a small depth tolerance at curved triangle boundaries.
    // Keep the character-only projection's tighter bias for floor contacts.
    proxy.shadow.bias = -0.0004;
    proxy.shadow.normalBias = KITCHEN_LIGHTING.shadow.normalBias;
    proxy.shadow.radius = spec.shadowRadius;
    root.add(light, proxy, proxy.target);
    shadows.push(proxy);
  }

  const front = KITCHEN_LIGHTING.frontFill;
  const polish = new T.RectAreaLight(
    linearColor(front.color),
    front.watts / (Math.PI * front.size ** 2),
    front.size,
    front.size,
  );
  polish.name = 'front-polish-area';
  polish.position.set(...front.position);
  polish.lookAt(...KITCHEN_LIGHTING.target);
  root.add(polish);

  // Appended after the three shadowed softboxes and front polish. No extra shadow maps.
  for (const spec of KITCHEN_PRACTICALS.areas) {
    const practical = new T.RectAreaLight(
      linearColor(spec.color),
      spec.watts / (Math.PI * spec.width * spec.height),
      spec.width,
      spec.height,
    );
    practical.name = spec.name;
    practical.position.set(...spec.position);
    practical.lookAt(...spec.target);
    root.add(practical);
  }
  const bulb = KITCHEN_PRACTICALS.pendant;
  const glow = new T.PointLight(
    linearColor(bulb.color),
    bulb.watts / (4 * Math.PI),
    bulb.distance,
    2,
  );
  glow.name = bulb.name;
  glow.position.set(...bulb.position);
  glow.castShadow = false;
  root.add(glow);

  // A separate key projection contains only layer-1 Session characters. Static
  // Cycles diffuse never gets the old center-of-area furniture shadow multiplied in.
  const key = KITCHEN_LIGHTING.areaLights[0];
  const actorShadow = new T.SpotLight(linearColor(key.color), 0, 0, key.shadowAngle, 0, 2);
  actorShadow.name = 'review-character-shadow';
  actorShadow.position.set(...key.position);
  actorShadow.target.position.set(...KITCHEN_LIGHTING.target);
  actorShadow.castShadow = true;
  actorShadow.shadow.autoUpdate = false;
  actorShadow.shadow.needsUpdate = false;
  actorShadow.shadow.camera.layers.set(1);
  actorShadow.shadow.camera.near = KITCHEN_LIGHTING.shadow.near;
  actorShadow.shadow.camera.far = KITCHEN_LIGHTING.shadow.far;
  actorShadow.shadow.mapSize.set(
    KITCHEN_LIGHTING.dynamicShadow.mapSize,
    KITCHEN_LIGHTING.dynamicShadow.mapSize,
  );
  actorShadow.shadow.bias = KITCHEN_LIGHTING.shadow.bias;
  actorShadow.shadow.normalBias = KITCHEN_LIGHTING.shadow.normalBias;
  actorShadow.shadow.radius = KITCHEN_LIGHTING.dynamicShadow.radius;
  root.add(actorShadow, actorShadow.target);
  shadows.push(actorShadow);
  scene.add(root);
  let disposed = false;
  return {
    characterShadow: actorShadow,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      for (const proxy of shadows) proxy.shadow.dispose();
      root.clear();
    },
  };
}

/** Passive bounce enclosure, captured once per room; LTC owns direct emitter highlights. */
export function createKitchenReflectionStudio(): { scene: T.Scene; dispose(): void } {
  const scene = new T.Scene();
  const geometry = new T.SphereGeometry(20, 48, 24);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    colors.set(
      sampleIndirectEnvironment(
        [positions.getX(i), positions.getY(i), positions.getZ(i)],
        KITCHEN_LIGHTING.environment,
      ),
      i * 3,
    );
  }
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  const room = new T.Mesh(
    geometry,
    new T.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      side: T.BackSide,
      toneMapped: false,
    }),
  );
  room.name = 'passive-room-bounce-enclosure';
  room.position.set(...KITCHEN_LIGHTING.target);
  scene.add(room);
  let disposed = false;
  return {
    scene,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.traverse((object) => {
        if (object instanceof T.Mesh) {
          object.geometry.dispose();
          (object.material as T.Material).dispose();
        }
      });
      scene.clear();
    },
  };
}

/** Owns the one-time room-bounce capture, PMREM and shadow targets for one WebGL context. */
export function createKitchenLighting(
  scene: T.Scene,
  renderer: T.WebGLRenderer,
): { updateCharacterShadows(camera: T.Camera): void; dispose(): void } {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.NeutralToneMapping;
  renderer.toneMappingExposure = KITCHEN_LIGHTING.exposure;
  renderer.setClearColor(KITCHEN_LIGHTING.background, 1);
  const studio = createKitchenReflectionStudio();
  let generator: T.PMREMGenerator | undefined;
  let environment: T.WebGLRenderTarget;
  try {
    generator = new T.PMREMGenerator(renderer);
    environment = generator.fromScene(studio.scene, KITCHEN_LIGHTING.environment.sigma, 0.1, 100, {
      size: KITCHEN_LIGHTING.environment.size,
      position: new T.Vector3(...KITCHEN_LIGHTING.target),
    });
  } finally {
    studio.dispose();
    generator?.dispose();
  }
  // Build the rig before attaching the texture, so setup failure cannot leave a live PMREM behind.
  let rig: ReturnType<typeof createKitchenLightRig>;
  try {
    rig = createKitchenLightRig(scene);
  } catch (error) {
    environment.dispose();
    throw error;
  }
  const previousEnvironment = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  const previousRotation = scene.environmentRotation.clone();
  scene.environment = environment.texture;
  scene.environmentIntensity = KITCHEN_LIGHTING.environmentIntensity;
  scene.environmentRotation.set(0, 0, 0);
  const characterShadows = createCharacterShadowPass(renderer, scene, rig.characterShadow);
  let disposed = false;
  return {
    updateCharacterShadows(camera) {
      characterShadows.update(camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      characterShadows.dispose();
      rig.dispose();
      if (scene.environment === environment.texture) {
        scene.environment = previousEnvironment;
        scene.environmentIntensity = previousIntensity;
        scene.environmentRotation.copy(previousRotation);
      }
      environment.dispose();
    },
  };
}
