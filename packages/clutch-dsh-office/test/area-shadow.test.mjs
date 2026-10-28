import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { configureKitchenMaterial } from '../lib/client/scene/area-shadow.js';

function compile(material, kind = 'standard') {
  const shader = {
    uniforms: T.UniformsUtils.clone(T.ShaderLib[kind].uniforms),
    vertexShader: T.ShaderLib[kind].vertexShader,
    fragmentShader: T.ShaderLib[kind].fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

// Exercise the installed renderer's own unroller, not a test copy of its regex.
const rendererSource = readFileSync(
  new URL('../src/renderers/webgl/WebGLProgram.js', import.meta.resolve('three')),
  'utf8',
);
const unroller = rendererSource.slice(
  rendererSource.indexOf('const unrollLoopPattern'),
  rendererSource.indexOf('function generatePrecision'),
);
const unroll = new Function(unroller + '; return unrollLoops;')();

for (const [kind, Material] of [
  ['standard', T.MeshStandardMaterial],
  ['physical', T.MeshPhysicalMaterial],
]) {
  test(
    kind + ' shader masks only the corresponding LTC color before diffuse/specular BRDF evaluation',
    () => {
      const material = new Material({ roughness: 0.56, metalness: 0.1 });
      const originalChunk = T.ShaderChunk.lights_fragment_begin;
      const originalVertex = T.ShaderLib[kind].vertexShader;
      configureKitchenMaterial(material);
      const shader = compile(material, kind);
      assert.equal(T.ShaderChunk.lights_fragment_begin, originalChunk);
      assert.equal(shader.vertexShader, originalVertex);
      assert.equal(material.roughness, 0.56);
      assert.equal(material.metalness, 0.1);
      assert.equal(shader.fragmentShader.includes('#include <lights_fragment_begin>'), false);
      assert.match(
        shader.fragmentShader,
        /\(NUM_RECT_AREA_LIGHTS == 3 \|\| NUM_RECT_AREA_LIGHTS == 4\) && NUM_SPOT_LIGHT_SHADOWS == 4 && NUM_SPOT_LIGHTS == 4 && NUM_SPOT_LIGHT_MAPS == 0/,
      );
      const rectStart = shader.fragmentShader.indexOf('rectAreaLight = rectAreaLights[ i ];');
      const mask = shader.fragmentShader.indexOf(
        'rectAreaLight.color *= receiveShadow ? kitchenAreaVisibility(',
        rectStart,
      );
      const brdf = shader.fragmentShader.indexOf('RE_Direct_RectArea( rectAreaLight,', rectStart);
      assert.ok(rectStart < mask && mask < brdf);
      assert.match(
        shader.fragmentShader.slice(mask, brdf),
        /spotShadowMap\[ i \][\s\S]*spotLightShadows\[ i \]\.shadowMapSize[\s\S]*spotLightShadows\[ i \]\.shadowIntensity[\s\S]*spotLightShadows\[ i \]\.shadowBias[\s\S]*spotLightShadows\[ i \]\.shadowRadius[\s\S]*vSpotLightCoord\[ i \][\s\S]*: 1\.0/,
      );
      assert.ok(shader.fragmentShader.includes('#include <lights_fragment_maps>'));
      // Just expand this loop; the full shader's other includes remain Three's responsibility.
      const loopStart = shader.fragmentShader.lastIndexOf('#pragma unroll_loop_start', rectStart);
      const loopEnd =
        shader.fragmentShader.indexOf('#pragma unroll_loop_end', brdf) +
        '#pragma unroll_loop_end'.length;
      const expanded = unroll(
        shader.fragmentShader.slice(loopStart, loopEnd).replaceAll('NUM_RECT_AREA_LIGHTS', '3'),
      );
      for (let i = 0; i < 3; i++) {
        assert.ok(expanded.includes('rectAreaLight = rectAreaLights[ ' + i + ' ];'));
        assert.ok(expanded.includes('spotShadowMap[ ' + i + ' ]'));
        assert.ok(expanded.includes('vSpotLightCoord[ ' + i + ' ]'));
      }
      assert.equal(expanded.includes('[ i ]'), false);
      assert.equal((expanded.match(/rectAreaLight.color \*=/g) ?? []).length, 3);
    },
  );
}

test('material setup is idempotent and preserves previous hooks, this binding and dynamic cache keys', () => {
  const material = new T.MeshStandardMaterial();
  let calls = 0;
  material.userData.variant = 'first';
  material.onBeforeCompile = function (shader) {
    assert.equal(this, material);
    calls++;
    shader.uniforms.previous = { value: 7 };
  };
  material.customProgramCacheKey = function () {
    return this.userData.variant;
  };
  const version = material.version;
  configureKitchenMaterial(material);
  const hook = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  configureKitchenMaterial(material);
  assert.equal(material.version, version + 1);
  assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.customProgramCacheKey, key);
  assert.equal(material.customProgramCacheKey(), 'first|kitchen-area-shell-front-fill-v5');
  material.userData.variant = 'second';
  assert.equal(material.customProgramCacheKey(), 'second|kitchen-area-shell-front-fill-v5');
  const shader = compile(material);
  assert.equal(shader.uniforms.previous.value, 7);
  assert.equal(calls, 1);
});

test('default program key retains original compile-hook identity and other material types stay untouched', () => {
  const first = new T.MeshStandardMaterial();
  const second = new T.MeshStandardMaterial();
  first.onBeforeCompile = function (shader) {
    shader.uniforms.first = { value: 1 };
  };
  second.onBeforeCompile = function (shader) {
    shader.uniforms.second = { value: 2 };
  };
  const originalFirst = first.customProgramCacheKey();
  configureKitchenMaterial(first);
  configureKitchenMaterial(second);
  assert.equal(first.customProgramCacheKey(), originalFirst + '|kitchen-area-shell-front-fill-v5');
  assert.notEqual(first.customProgramCacheKey(), second.customProgramCacheKey());
  for (const material of [
    new T.Material(),
    new T.MeshBasicMaterial(),
    new T.ShadowMaterial(),
    new T.MeshDepthMaterial(),
    new T.ShaderMaterial(),
  ]) {
    const hook = material.onBeforeCompile;
    const version = material.version;
    configureKitchenMaterial(material);
    assert.equal(material.onBeforeCompile, hook);
    assert.equal(material.version, version);
  }
});

test('an incompatible previous hook fails explicitly instead of silently keeping unshadowed areas', () => {
  const material = new T.MeshPhysicalMaterial();
  material.onBeforeCompile = function (shader) {
    shader.fragmentShader = 'void main() {}';
  };
  configureKitchenMaterial(material);
  assert.throws(() => compile(material, 'physical'), /previous material hook removed/);
});

test('private Poisson PCF has sixteen stable balanced taps, uses one depth compare per tap and leaves native shader chunks intact', () => {
  const originalShadowChunk = T.ShaderChunk.shadowmap_pars_fragment;
  const originalGroundShader = T.ShaderLib.shadow.fragmentShader;
  const material = new T.MeshStandardMaterial();
  configureKitchenMaterial(material);
  const first = compile(material);
  const second = compile(material);
  assert.equal(first.fragmentShader, second.fragmentShader);
  const begin = first.fragmentShader.indexOf('float kitchenAreaVisibility(');
  const end = first.fragmentShader.indexOf('#endif', begin);
  const helper = first.fragmentShader.slice(begin, end);
  assert.ok(first.fragmentShader.indexOf('#include <shadowmap_pars_fragment>') < begin);
  assert.ok(end < first.fragmentShader.indexOf('void main()'));
  const offsets = [...helper.matchAll(/vec2\((-?[\d.]+), (-?[\d.]+)\) \* spread/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ]);
  assert.equal(offsets.length, 16);
  assert.equal(new Set(offsets.map((offset) => offset.join(','))).size, 16);
  assert.equal((helper.match(/texture2DCompare\(/g) ?? []).length, 16);
  assert.equal(helper.includes('getShadow('), false);
  assert.equal(/time|random|sin\(|cos\(/.test(helper), false);
  assert.ok(offsets.every(([x, y]) => Math.hypot(x, y) < 1));
  assert.ok(Math.abs(offsets.reduce((sum, [x]) => sum + x, 0)) < 1e-7);
  assert.ok(Math.abs(offsets.reduce((sum, [, y]) => sum + y, 0)) < 1e-7);
  assert.ok(helper.includes('texel * shadowRadius'));
  assert.ok(helper.includes('coord.z += shadowBias'));
  assert.ok(helper.includes('shadowCoord.w <= 0.0'));
  assert.ok(helper.includes('any(lessThan(coord, vec3(0.0)))'));
  assert.ok(helper.includes('any(greaterThan(coord, vec3(1.0)))'));
  assert.ok(helper.includes('halfTexel, vec2(1.0) - halfTexel'));
  assert.ok(helper.includes('mix(1.0, visibility * (1.0 / 16.0), shadowIntensity)'));
  assert.equal(T.ShaderChunk.shadowmap_pars_fragment, originalShadowChunk);
  assert.equal(T.ShaderLib.shadow.fragmentShader, originalGroundShader);
  assert.ok(originalGroundShader.includes('getShadowMask()'));
  const ground = new T.ShadowMaterial();
  const originalHook = ground.onBeforeCompile;
  configureKitchenMaterial(ground);
  assert.equal(ground.onBeforeCompile, originalHook);
});

test('missing shadow declarations fail before producing an invalid helper call', () => {
  const material = new T.MeshStandardMaterial();
  material.onBeforeCompile = function (shader) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', '');
  };
  configureKitchenMaterial(material);
  assert.throws(() => compile(material), /required lighting\/shadow include/);
});

test('receiver-plane derivatives precede early returns and every Poisson tap adjusts depth at its actual UV', () => {
  const material = new T.MeshStandardMaterial();
  configureKitchenMaterial(material);
  const shader = compile(material).fragmentShader;
  const begin = shader.indexOf('float kitchenAreaVisibility(');
  const helper = shader.slice(begin, shader.indexOf('#endif', begin));
  assert.ok(helper.indexOf('dFdx(coord)') < helper.indexOf('return 1.0'));
  assert.ok(helper.indexOf('dFdy(coord)') < helper.indexOf('return 1.0'));
  assert.ok(helper.includes('max(shadowCoord.w, 0.000001)'));
  assert.ok(helper.includes('if (abs(detUV) > 0.0000000001)'));
  assert.ok(helper.includes('vec2 gradient = vec2(0.0)'));
  assert.equal((helper.match(/coord.z \+ dot\(gradient, sampleUV - coord.xy\)/g) ?? []).length, 16);
  // Evaluate the shader's actual gradient expression against a known oblique plane.
  const numerator = helper.match(/gradient = vec2\(([^;]+)\) \/ detUV;/)[1];
  const solve = new Function(
    'dx',
    'dy',
    'detUV',
    'return [' + numerator + '].map(v => v / detUV);',
  );
  const expected = [0.24, -0.17];
  const dx = { x: 0.002, y: 0.0003, z: 0.002 * expected[0] + 0.0003 * expected[1] };
  const dy = { x: -0.0004, y: 0.0015, z: -0.0004 * expected[0] + 0.0015 * expected[1] };
  const gradient = solve(dx, dy, dx.x * dy.y - dx.y * dy.x);
  gradient.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-12));
  const offsets = [...helper.matchAll(/vec2\((-?[\d.]+), (-?[\d.]+)\) \* spread/g)].map((m) => [
    (Number(m[1]) * 8) / 1024,
    (Number(m[2]) * 8) / 1024,
  ]);
  assert.equal(offsets.length, 16);
  for (const [du, dv] of offsets) {
    const planeDepth = 0.8 + expected[0] * du + expected[1] * dv;
    const corrected = 0.8 - 0.00015 + gradient[0] * du + gradient[1] * dv;
    assert.ok(Math.abs(corrected - planeDepth + 0.00015) < 1e-12);
    assert.ok(corrected < planeDepth, 'same plane stays lit across the wide kernel');
    assert.ok(corrected > planeDepth - 0.002, 'a nearer blocker still casts shadow');
  }
});

test('fourth front softbox remains unshadowed instead of sampling the character-only shadow', () => {
  const material = new T.MeshStandardMaterial();
  configureKitchenMaterial(material);
  const shader = compile(material).fragmentShader;
  assert.match(shader, /#if UNROLLED_LOOP_INDEX < 3/);
  const start = shader.lastIndexOf(
    '#pragma unroll_loop_start',
    shader.indexOf('rectAreaLight = rectAreaLights[ i ];'),
  );
  const end = shader.indexOf('#pragma unroll_loop_end', start) + '#pragma unroll_loop_end'.length;
  const expanded = unroll(shader.slice(start, end).replaceAll('NUM_RECT_AREA_LIGHTS', '4'));
  assert.ok(expanded.includes('rectAreaLight = rectAreaLights[ 3 ];'));
  assert.ok(expanded.includes('#if 3 < 3'));
});
