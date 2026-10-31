import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { WebGLLights } from 'three/src/renderers/webgl/WebGLLights.js';
import {
  KITCHEN_LIGHTING,
  createKitchenLightRig,
  createKitchenReflectionStudio,
  createKitchenLighting,
} from '../lib/client/scene/lighting.js';

function trackDisposals(resources) {
  const counts = resources.map(() => 0);
  resources.forEach((resource, i) => resource.addEventListener('dispose', () => counts[i]++));
  return counts;
}

function shadowResources(scene, withBlurTarget = true) {
  const resources = [];
  scene.traverse((object) => {
    if (!object.isSpotLight || !object.castShadow) return;
    object.shadow.map = new T.WebGLRenderTarget(8, 8);
    object.shadow.mapPass = withBlurTarget ? new T.WebGLRenderTarget(8, 8) : null;
    resources.push(object.shadow.map);
    if (object.shadow.mapPass) resources.push(object.shadow.mapPass);
  });
  return resources;
}

function captureResources(scene) {
  const resources = [];
  scene.traverse((object) => {
    if (object.isMesh) resources.push(object.geometry, object.material);
  });
  return resources;
}

test('review softboxes face their target and retain Blender linear colors; zero-energy center proxies keep stable renderer ordering', () => {
  const scene = new T.Scene();
  const rig = createKitchenLightRig(scene);
  const areas = scene.getObjectsByProperty('isRectAreaLight', true);
  assert.equal(areas.length, 7);
  for (const [i, light] of areas.slice(0, 3).entries()) {
    const source = KITCHEN_LIGHTING.sourceBlender.areas[i];
    const [x, y, z] = source.position;
    assert.deepEqual(light.position.toArray(), [x, z, -y]);
    assert.equal(light.width, source.size);
    assert.equal(light.height, source.size);
    assert.deepEqual(light.color.toArray(), source.linearColor);
    const direction = new T.Vector3(0, 0, -1).applyQuaternion(light.quaternion);
    const expected = new T.Vector3(0, 1, 0).sub(light.position).normalize();
    assert.ok(direction.distanceTo(expected) < 1e-12);
    assert.equal(light.castShadow, false);
    assert.equal(light.intensity, source.watts / (Math.PI * source.size ** 2));
  }
  const lights = [];
  scene.traverse((object) => {
    if (object.isLight) lights.push(object);
  });
  assert.deepEqual(
    lights.filter((light) => light.castShadow).map((light) => light.name),
    ['warm-key', 'review-fill-area-shadow', 'review-rim-area-shadow', 'review-character-shadow'],
  );
  assert.equal(lights.length, 12);
  assert.equal(
    lights.some((light) => light.isDirectionalLight),
    false,
  );
  const proxies = lights.filter((light) => light.isSpotLight);
  proxies.slice(0, 3).forEach((proxy, i) => {
    assert.equal(proxy.intensity, 0);
    assert.equal(proxy.map, null);
    assert.deepEqual(proxy.position.toArray(), areas[i].position.toArray());
    assert.deepEqual(proxy.color.toArray(), areas[i].color.toArray());
    assert.equal(proxy.shadow.normalBias, KITCHEN_LIGHTING.shadow.normalBias);
    assert.equal(proxy.shadow.bias, KITCHEN_LIGHTING.shadow.bias);
    assert.equal(proxy.shadow.camera.near, KITCHEN_LIGHTING.shadow.near);
    assert.equal(proxy.shadow.camera.far, KITCHEN_LIGHTING.shadow.far);
    assert.equal(proxy.shadow.radius, KITCHEN_LIGHTING.areaLights[i].shadowRadius);
    assert.equal(proxy.shadow.mapSize.x, i === 0 ? 1024 : 512);
  });
  scene.updateMatrixWorld(true);
  const rendererLights = WebGLLights({ has: () => true });
  rendererLights.setup(lights);
  assert.equal(rendererLights.state.spotShadow.length, 4);
  assert.equal(rendererLights.state.spot.length, 4);
  assert.equal(rendererLights.state.spotLightMap.length, 0);
  assert.equal(rendererLights.state.rectArea.length, 7);
  assert.equal(rendererLights.state.point.length, 1);
  assert.equal(rendererLights.state.pointShadow.length, 0);
  assert.equal(rendererLights.state.directional.length, 0);
  proxies.slice(0, 3).forEach((proxy, i) => {
    assert.equal(rendererLights.state.spotLightMatrix[i], proxy.shadow.matrix);
    assert.deepEqual(rendererLights.state.spot[i].color.toArray(), [0, 0, 0]);
    assert.deepEqual(
      rendererLights.state.rectArea[i].color.toArray(),
      areas[i].color.clone().multiplyScalar(areas[i].intensity).toArray(),
    );
  });
  const front = scene.getObjectByName('front-polish-area');
  assert.equal(areas[3], front);
  assert.equal(front.castShadow, false);
  assert.deepEqual(front.position.toArray(), KITCHEN_LIGHTING.frontFill.position);
  assert.equal(front.intensity, 80 / (Math.PI * 25));
  assert.equal(proxies.length, 4, 'front polish allocates no shadow target');
  const actorShadow = scene.getObjectByName('review-character-shadow');
  assert.equal(actorShadow.intensity, 0);
  assert.equal(actorShadow.shadow.camera.layers.mask, 2);
  assert.equal(actorShadow.shadow.autoUpdate, false);
  assert.equal(actorShadow.shadow.needsUpdate, false);
  assert.equal(actorShadow.shadow.mapSize.x, 512);
  assert.equal(actorShadow.shadow.radius, 8);
  assert.equal(rendererLights.state.spotLightMatrix[3], actorShadow.shadow.matrix);
  assert.equal(scene.getObjectsByProperty('isHemisphereLight', true).length, 0);
  const practicals = KITCHEN_LIGHTING.practicals;
  assert.deepEqual(
    areas.slice(4).map((light) => light.name),
    ['hood-task-warm', 'shelf-task-warm', 'window-warm'],
  );
  practicals.areas.forEach((spec, i) => {
    const light = areas[i + 4];
    assert.equal(light.castShadow, false);
    assert.deepEqual(light.position.toArray(), spec.position);
    assert.equal(light.width, spec.width);
    assert.equal(light.height, spec.height);
    assert.equal(light.intensity, spec.watts / (Math.PI * spec.width * spec.height));
    assert.deepEqual(light.color.toArray(), spec.color);
    const direction = new T.Vector3(0, 0, -1).applyQuaternion(light.quaternion);
    const expected = new T.Vector3(...spec.target).sub(light.position).normalize();
    assert.ok(direction.distanceTo(expected) < 1e-12);
  });
  const points = lights.filter((light) => light.isPointLight);
  assert.equal(points.length, 1, 'the rig owns exactly one pendant bulb');
  const bulb = points[0];
  assert.equal(bulb.name, practicals.pendant.name);
  assert.equal(bulb.castShadow, false);
  assert.deepEqual(bulb.position.toArray(), practicals.pendant.position);
  assert.deepEqual(bulb.color.toArray(), practicals.pendant.color);
  assert.ok(bulb.color.r > bulb.color.g && bulb.color.g > bulb.color.b);
  assert.ok(bulb.intensity > 0);
  assert.equal(bulb.intensity, practicals.pendant.watts / (4 * Math.PI));
  assert.equal(bulb.distance, practicals.pendant.distance);
  assert.equal(bulb.decay, 2);
  // setup sorts the real scene light list; setupView must preserve each type's pairing.
  assert.deepEqual(
    lights.filter((light) => light.isRectAreaLight),
    areas,
  );
  assert.deepEqual(
    lights.filter((light) => light.isSpotLight),
    proxies,
  );
  const camera = new T.PerspectiveCamera();
  camera.position.set(8, 7, 8.5);
  camera.lookAt(0, 1.3, 0.5);
  camera.updateMatrixWorld(true);
  rendererLights.setupView(lights, camera);
  areas.forEach((light, i) => {
    const uniform = rendererLights.state.rectArea[i];
    assert.deepEqual(
      uniform.color.toArray(),
      light.color.clone().multiplyScalar(light.intensity).toArray(),
    );
    assert.ok(
      uniform.position.distanceTo(
        light.getWorldPosition(new T.Vector3()).applyMatrix4(camera.matrixWorldInverse),
      ) < 1e-12,
    );
    assert.ok(Math.abs(uniform.halfWidth.length() - light.width / 2) < 1e-12);
    assert.ok(Math.abs(uniform.halfHeight.length() - light.height / 2) < 1e-12);
  });
  proxies.forEach((proxy, i) => {
    assert.equal(rendererLights.state.spotLightMatrix[i], proxy.shadow.matrix);
  });
  assert.deepEqual(
    rendererLights.state.point[0].color.toArray(),
    bulb.color.clone().multiplyScalar(bulb.intensity).toArray(),
  );
  assert.ok(
    rendererLights.state.point[0].position.distanceTo(
      bulb.getWorldPosition(new T.Vector3()).applyMatrix4(camera.matrixWorldInverse),
    ) < 1e-12,
  );
  // Another room must reuse the LTC library rather than replace its shared textures.
  const lookups = ['LTC_HALF_1', 'LTC_HALF_2', 'LTC_FLOAT_1', 'LTC_FLOAT_2'].map(
    (name) => T.UniformsLib[name],
  );
  assert.ok(lookups.every((lookup) => lookup.isDataTexture));
  const lookupDisposed = trackDisposals(lookups);
  const other = createKitchenLightRig(new T.Scene());
  ['LTC_HALF_1', 'LTC_HALF_2', 'LTC_FLOAT_1', 'LTC_FLOAT_2'].forEach((name, i) =>
    assert.equal(T.UniformsLib[name], lookups[i]),
  );
  other.dispose();
  other.dispose();
  rig.dispose();
  assert.deepEqual(lookupDisposed, [0, 0, 0, 0], 'room teardown retains shared LTC textures');
});

test('lighting teardown releases primary and optional blur targets once, without a presentation ground, retaining scene assets', () => {
  const scene = new T.Scene();
  const asset = new T.Group();
  scene.add(asset);
  const rig = createKitchenLightRig(scene);
  assert.equal(scene.getObjectByName('diorama-shadow-receiver'), undefined);
  assert.equal(scene.getObjectsByProperty('isMesh', true).length, 0);
  const resources = shadowResources(scene);
  const disposed = trackDisposals(resources);
  rig.dispose();
  rig.dispose();
  assert.deepEqual(disposed, Array(8).fill(1));
  assert.deepEqual(scene.children, [asset]);
});

test('passive reflection capture supplies finite directional radiance and releases its geometry/material once', () => {
  const studio = createKitchenReflectionStudio();
  assert.equal(studio.scene.children.length, 1);
  const room = studio.scene.getObjectByName('passive-room-bounce-enclosure');
  assert.equal(room.material.side, T.BackSide);
  assert.equal(room.material.vertexColors, true);
  assert.equal(room.geometry.type, 'SphereGeometry');
  assert.equal(studio.scene.getObjectsByProperty('isLight', true).length, 0);
  const colors = room.geometry.getAttribute('color');
  assert.ok(colors.count > 100);
  assert.ok([...colors.array].every((v) => Number.isFinite(v) && v > 0.05 && v < 0.65));
  assert.ok(Math.max(...colors.array) - Math.min(...colors.array) > 0.3);
  assert.equal(room.material.toneMapped, false);
  assert.equal(KITCHEN_LIGHTING.sourceBlender.world.useNodes, true);
  assert.deepEqual(KITCHEN_LIGHTING.sourceBlender.world.nodeColor, [0.05, 0.05, 0.05]);
  assert.equal(KITCHEN_LIGHTING.sourceBlender.world.strength, 1);
  const disposed = trackDisposals(captureResources(studio.scene));
  studio.dispose();
  studio.dispose();
  assert.deepEqual(disposed, Array(2).fill(1));
  assert.equal(studio.scene.children.length, 0);
});

function rendererStub() {
  return {
    shadowMap: { render() {} },
    compile() {},
    setClearColor(color, alpha) {
      this.clear = [color, alpha];
    },
  };
}

test('context setup releases the capture immediately; teardown restores previous environment and frees owned targets', (t) => {
  const scene = new T.Scene();
  const asset = new T.Group();
  const previous = new T.Texture();
  scene.add(asset);
  scene.environment = previous;
  scene.environmentIntensity = 0.7;
  scene.environmentRotation.set(0.1, 0.2, 0.3);
  const rotation = scene.environmentRotation.clone();
  const renderer = rendererStub();
  const environment = new T.WebGLRenderTarget(8, 8);
  const targetDisposed = trackDisposals([environment]);
  let captureDisposed;
  const capture = t.mock.method(
    T.PMREMGenerator.prototype,
    'fromScene',
    (studio, sigma, near, far, options) => {
      captureDisposed = trackDisposals(captureResources(studio));
      assert.deepEqual(options.position.toArray(), [0, 1, 0]);
      assert.equal(options.size, 128);
      return environment;
    },
  );
  const generatorDispose = t.mock.method(T.PMREMGenerator.prototype, 'dispose', () => {});
  const lighting = createKitchenLighting(scene, renderer);
  assert.equal(capture.mock.callCount(), 1);
  assert.equal(generatorDispose.mock.callCount(), 1);
  assert.deepEqual(captureDisposed, Array(2).fill(1));
  assert.equal(scene.environment, environment.texture);
  assert.equal(scene.environmentIntensity, 1);
  assert.deepEqual(scene.environmentRotation.toArray(), [0, 0, 0, 'XYZ']);
  assert.equal(renderer.toneMapping, T.NeutralToneMapping);
  assert.equal(renderer.toneMappingExposure, 1);
  assert.equal(renderer.outputColorSpace, T.SRGBColorSpace);
  assert.equal(renderer.shadowMap.type, T.PCFSoftShadowMap);
  assert.deepEqual(renderer.clear, ['#222222', 1]);
  assert.deepEqual(targetDisposed, [0]);
  assert.equal(scene.getObjectByName('diorama-shadow-receiver'), undefined);
  const rigDisposed = trackDisposals(shadowResources(scene, false));
  lighting.dispose();
  lighting.dispose();
  assert.deepEqual(rigDisposed, Array(4).fill(1));
  assert.deepEqual(targetDisposed, [1]);
  assert.deepEqual(scene.children, [asset]);
  assert.equal(scene.environment, previous);
  assert.equal(scene.environmentIntensity, 0.7);
  assert.ok(scene.environmentRotation.equals(rotation));
});

test('failed PMREM capture releases its temporary scene and generator without changing existing assets', (t) => {
  const scene = new T.Scene();
  const asset = new T.Group();
  const previous = new T.Texture();
  scene.add(asset);
  scene.environment = previous;
  let captureDisposed;
  t.mock.method(T.PMREMGenerator.prototype, 'fromScene', (studio) => {
    captureDisposed = trackDisposals(captureResources(studio));
    throw new Error('capture failed');
  });
  const generatorDispose = t.mock.method(T.PMREMGenerator.prototype, 'dispose', () => {});
  assert.throws(() => createKitchenLighting(scene, rendererStub()), /capture failed/);
  assert.deepEqual(captureDisposed, Array(2).fill(1));
  assert.equal(generatorDispose.mock.callCount(), 1);
  assert.deepEqual(scene.children, [asset]);
  assert.equal(scene.environment, previous);
});
