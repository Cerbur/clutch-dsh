import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Models } from '../src/client/scene/models.js';
import { createKitchenLighting } from '../src/client/scene/lighting.js';
import { createKitchenCamera, resizeKitchenCamera } from '../src/client/scene/camera.js';
import { configureWindowGlow } from '../src/client/scene/window-glow.js';
import { configureKitchenBake, applyKitchenBake } from '../src/client/scene/baked-lighting.js';
import manifest from '../assets/lighting/kitchen/manifest.json?inline';
import uv from '../assets/lighting/kitchen/uv.bin?inline';
import diffuse from '../assets/lighting/kitchen/diffuse.png?inline';
import {
  KITCHEN_PLACEMENT,
  KITCHEN_ROTATION,
  KITCHEN_SCALE,
  kitchenAssetName,
} from '../src/office/kitchen-layout.js';

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
document.body.append(renderer.domElement);
const scene = new T.Scene();
const lighting = createKitchenLighting(scene, renderer);
const camera = createKitchenCamera();
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.3, 0.5);
controls.update();
const quality = document.querySelector<HTMLSelectElement>('#quality')!;
const view = document.querySelector<HTMLSelectElement>('#view')!;
const metrics = document.querySelector<HTMLOutputElement>('#metrics')!;
const bakeLabel = document.createElement('label');
bakeLabel.innerHTML = '<input id="bake" type="checkbox">Production bake (medium only)';
document.querySelector('header')!.append(bakeLabel);
const bake = document.querySelector<HTMLInputElement>('#bake')!;
bake.onchange = () => void load();
let owner = new Models(),
  room = new T.Group(),
  serial = 0,
  bytes = 0,
  loadMs = 0,
  loading = false;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const originalMaterials = new Map<T.Mesh, T.Material | T.Material[]>();
async function load() {
  const token = ++serial,
    start = performance.now(),
    selectedQuality = quality.value,
    useBake = bake.checked && selectedQuality === 'medium';
  let nextBytes = 0;
  const nextMaterials = new Map<T.Mesh, T.Material | T.Material[]>();
  loading = true;
  metrics.textContent = 'Loading…';
  scene.remove(room);
  owner.dispose();
  owner = new Models();
  room = new T.Group();
  scene.add(room);
  originalMaterials.clear();
  bytes = 0;
  const nextOwner = owner,
    nextRoom = room;
  configureKitchenBake(useBake ? { manifest, uv, diffuse } : undefined);
  const cache = new Map<string, T.Group>();
  const sourceBytes = new Map<string, ArrayBuffer>();
  for (const [id, position] of Object.entries(KITCHEN_PLACEMENT)) {
    if (token !== serial) return;
    const name = kitchenAssetName(id);
    let asset = cache.get(name);
    if (!asset) {
      const data = await fetch(`/${selectedQuality}/${name}.glb`).then((r) => {
        if (!r.ok) throw Error(name);
        return r.arrayBuffer();
      });
      nextBytes += data.byteLength;
      const gltf = await loader.parseAsync(data, '');
      asset = gltf.scene;
      if (token !== serial) {
        const abandoned = new Models();
        abandoned.dispose();
        abandoned.ownObject(asset);
        return;
      }
      nextOwner.ownObject(asset);
      cache.set(name, asset);
      sourceBytes.set(name, data);
      if (name === 'window') configureWindowGlow(asset);
    }
    const root = asset.clone(true);
    root.position.set(...position);
    root.rotation.y = KITCHEN_ROTATION[id] ?? 0;
    root.scale.set(...(KITCHEN_SCALE[id] ?? [1, 1, 1]));
    nextRoom.add(root);
    if (useBake) await applyKitchenBake(nextOwner, id, root, sourceBytes.get(name)!);
    root.traverse((o) => {
      if (o instanceof T.Mesh) nextMaterials.set(o, o.material);
    });
  }
  if (token !== serial) return;
  for (const [mesh, material] of nextMaterials) originalMaterials.set(mesh, material);
  bytes = nextBytes;
  loadMs = performance.now() - start;
  loading = false;
  renderer.shadowMap.needsUpdate = true;
  if (!useBake) apply();
}
const debugMaterials: T.Material[] = [];
function apply() {
  debugMaterials.splice(0).forEach((m) => m.dispose());
  const wire = document.querySelector<HTMLInputElement>('#wire')!.checked;
  const unlit = document.querySelector<HTMLInputElement>('#unlit')!.checked;
  const noNormal = document.querySelector<HTMLInputElement>('#normal')!.checked;
  const noShadow = document.querySelector<HTMLInputElement>('#shadow')!.checked;
  for (const [mesh, source] of originalMaterials) {
    mesh.receiveShadow = !noShadow;
    mesh.castShadow = !noShadow;
    const materials = (Array.isArray(source) ? source : [source]).map((source) => {
      const old = source as T.MeshStandardMaterial;
      const m = unlit
        ? new T.MeshBasicMaterial({ map: old.map, color: old.color, side: old.side })
        : old.clone();
      m.wireframe = wire;
      if (noNormal && m instanceof T.MeshStandardMaterial) m.normalScale.set(0, 0);
      if (!unlit) {
        m.onBeforeCompile = old.onBeforeCompile;
        m.customProgramCacheKey = old.customProgramCacheKey;
      }
      debugMaterials.push(m);
      return m;
    });
    mesh.material = Array.isArray(source) ? materials : materials[0];
  }
  renderer.shadowMap.needsUpdate = true;
}
quality.onchange = () =>
  void load().catch((e) => {
    metrics.textContent = String(e);
  });
for (const id of ['wire', 'unlit', 'normal', 'shadow'])
  document.querySelector<HTMLInputElement>('#' + id)!.onchange = apply;
view.onchange = () => {
  const views: Record<string, { p: number[]; t: number[]; z: number }> = {
    review: { p: [8, 7, 8.5], t: [0, 1.3, 0.5], z: 1 },
    front: { p: [0, 5, 12], t: [0, 1.3, 0.5], z: 1 },
    right: { p: [12, 5, 0], t: [0, 1.3, 0.5], z: 1 },
    back: { p: [-8, 7, -8.5], t: [0, 1.3, 0.5], z: 1 },
    window: { p: [4, 4, 6], t: [-1.3, 2, -1.5], z: 3 },
    hood: { p: [4, 4, 6], t: [-1.9, 2, 0.6], z: 3 },
    edge: { p: [8, 3, 8.5], t: [2.5, -0.1, 1], z: 3 },
  };
  const v = views[view.value];
  camera.position.fromArray(v.p);
  controls.target.fromArray(v.t);
  camera.zoom = v.z;
  camera.updateProjectionMatrix();
  controls.update();
};
function resize() {
  renderer.setSize(innerWidth, innerHeight - 110);
  resizeKitchenCamera(camera, innerWidth / (innerHeight - 110));
}
addEventListener('resize', resize);
resize();
let frames = 0,
  timing = performance.now();
function draw(now: number) {
  requestAnimationFrame(draw);
  renderer.render(scene, camera);
  frames++;
  if (now - timing > 750) {
    if (!loading)
      metrics.textContent = JSON.stringify(
        {
          quality: quality.value,
          triangles: renderer.info.render.triangles,
          drawCalls: renderer.info.render.calls,
          sourceMiB: +(bytes / 1048576).toFixed(2),
          loadMs: +loadMs.toFixed(1),
          fps: +((frames * 1000) / (now - timing)).toFixed(1),
          frameMs: +((now - timing) / frames).toFixed(2),
          loadedAssets: new Set(Object.keys(KITCHEN_PLACEMENT).map(kitchenAssetName)).size,
        },
        null,
        0,
      );
    frames = 0;
    timing = now;
  }
}
requestAnimationFrame(draw);
void load().catch((e) => {
  metrics.textContent = String(e);
});
addEventListener('pagehide', () => {
  owner.dispose();
  controls.dispose();
  lighting.dispose();
  debugMaterials.forEach((m) => m.dispose());
  renderer.dispose();
});
