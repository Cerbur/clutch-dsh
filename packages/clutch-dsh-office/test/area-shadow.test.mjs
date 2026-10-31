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

test('four shadow-only spots skip their zero-contribution native BRDF loop, retaining LTC sampling', () => {
  const material = new T.MeshStandardMaterial();
  configureKitchenMaterial(material);
  const shader = compile(material).fragmentShader;
  assert.ok(
    shader.includes(
      '&& !( NUM_SPOT_LIGHTS == 4 && NUM_SPOT_LIGHT_SHADOWS == 4 && NUM_SPOT_LIGHT_MAPS == 0 )',
    ),
  );
  assert.ok(shader.includes('rectAreaLight.color *= receiveShadow ? kitchenAreaVisibility('));
});

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
        /\(NUM_RECT_AREA_LIGHTS == 3 \|\| NUM_RECT_AREA_LIGHTS == 4 \|\| NUM_RECT_AREA_LIGHTS == 7\) && NUM_SPOT_LIGHT_SHADOWS == 4 && NUM_SPOT_LIGHTS == 4 && NUM_SPOT_LIGHT_MAPS == 0/,
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
  assert.equal(material.customProgramCacheKey(), 'first|kitchen-area-shell-practicals-v8');
  material.userData.variant = 'second';
  assert.equal(material.customProgramCacheKey(), 'second|kitchen-area-shell-practicals-v8');
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
  assert.equal(first.customProgramCacheKey(), originalFirst + '|kitchen-area-shell-practicals-v8');
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

test('private Poisson PCF has eight stable balanced taps, uses one depth compare per tap and leaves native shader chunks intact', () => {
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
  assert.equal(offsets.length, 8);
  assert.equal(new Set(offsets.map((offset) => offset.join(','))).size, 8);
  assert.equal((helper.match(/texture2DCompare\(/g) ?? []).length, 8);
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
  assert.ok(helper.includes('mix(1.0, visibility * (1.0 / 8.0), shadowIntensity)'));
  assert.equal(T.ShaderChunk.shadowmap_pars_fragment, originalShadowChunk);
  assert.equal(T.ShaderLib.shadow.fragmentShader, originalGroundShader);
  assert.ok(originalGroundShader.includes('getShadowMask()'));
  const ground = new T.ShadowMaterial();
  const originalHook = ground.onBeforeCompile;
  configureKitchenMaterial(ground);
  assert.equal(ground.onBeforeCompile, originalHook);
});

test('receiver depth matches the nearest sampled texel on steep planes without losing blockers', () => {
  const material = new T.MeshStandardMaterial();
  configureKitchenMaterial(material);
  const shader = compile(material).fragmentShader;
  // Exercise subtexel phases, not just idealized continuous UVs. PCF maps use NearestFilter.
  const snapped = shader.includes('sampleUV = (floor(sampleUV * shadowMapSize) + 0.5) * texel;');
  for (const size of [512, 1024]) {
    for (let phase = 0; phase < 100; phase++) {
      const uv = (100 + phase / 100) / size;
      const center = (Math.floor(uv * size) + 0.5) / size;
      const storedDepth = 0.8 + 0.6 * center;
      const compareDepth = 0.8 + 0.6 * (snapped ? center : uv) - 0.00015;
      assert.ok(compareDepth <= storedDepth, `self shadow at ${size}/${phase}`);
      assert.ok(compareDepth > storedDepth - 0.002, 'nearby blocker remains visible');
    }
  }
});

test('curved receivers do not extrapolate comparison depth behind their surface', () => {
  const material = new T.MeshStandardMaterial();
  configureKitchenMaterial(material);
  const shader = compile(material).fragmentShader;
  const expression = shader.match(
    /visibility \+= texture2DCompare\(shadowMap, sampleUV, (.*)\);/,
  )[1];
  const compare = new Function(
    'receiverDepth',
    'slope',
    'return ' +
      expression
        .replace('coord.z', 'receiverDepth')
        .replace('dot(gradient, sampleUV - coord.xy)', 'slope')
        .replace('min(', 'Math.min('),
  );
  // The neighboring curved triangle is flatter than this fragment's tangent.
  // Positive extrapolation would turn the same surface into a false blocker.
  for (const slope of [-0.001, 0, 0.001, 0.01]) {
    const depth = compare(0.8 - 0.0004, slope);
    assert.ok(depth <= 0.8, 'same surface remains lit');
    assert.ok(depth > 0.798, 'a separate nearer blocker still casts a shadow');
  }
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
  assert.equal(
    helper.split('coord.z + min(0.0, dot(gradient, sampleUV - coord.xy))').length - 1,
    8,
  );
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
  assert.equal(offsets.length, 8);
  for (const [du, dv] of offsets) {
    const planeDepth = 0.8 + expected[0] * du + expected[1] * dv;
    const corrected = 0.8 - 0.00015 + Math.min(0, gradient[0] * du + gradient[1] * dv);
    assert.ok(corrected < planeDepth, 'same plane stays lit across the wide kernel');
    assert.ok(corrected > planeDepth - 0.004, 'a nearer blocker still casts shadow');
  }
});

for (const [kind, Material] of [
  ['standard', T.MeshStandardMaterial],
  ['physical', T.MeshPhysicalMaterial],
]) {
  for (const count of [3, 4, 7]) {
    test(kind + ': ' + count + ' rectangles keep shadow sampler indices safe', () => {
      const material = new Material();
      configureKitchenMaterial(material);
      const shader = compile(material, kind).fragmentShader;
      assert.match(shader, /#if UNROLLED_LOOP_INDEX < 3/);
      const start = shader.lastIndexOf(
        '#pragma unroll_loop_start',
        shader.indexOf('rectAreaLight = rectAreaLights[ i ];'),
      );
      const end =
        shader.indexOf('#pragma unroll_loop_end', start) + '#pragma unroll_loop_end'.length;
      const expanded = unroll(
        shader.slice(start, end).replaceAll('NUM_RECT_AREA_LIGHTS', String(count)),
      );
      assert.equal(expanded.includes('[ i ]'), false);
      assert.equal(expanded.includes('UNROLLED_LOOP_INDEX'), false);
      for (let i = 0; i < count; i++) {
        assert.ok(expanded.includes('rectAreaLight = rectAreaLights[ ' + i + ' ];'));
        assert.ok(expanded.includes('#if ' + i + ' < 3'));
      }
      // Resolve only the literal inner guard after Three's real unroller. Full GLSL
      // compilation remains a browser check; no GPU/compiler dependency is introduced here.
      const guards = [...expanded.matchAll(/#if (\d+) < 3\s*([\s\S]*?)#endif/g)];
      assert.equal(guards.length, count);
      for (const [, index, body] of guards) {
        assert.ok(body.includes('spotShadowMap[ ' + index + ' ]'));
      }
      const active = expanded.replace(/#if (\d+) < 3\s*([\s\S]*?)#endif/g, (_, index, body) =>
        Number(index) < 3 ? body : '',
      );
      for (const name of ['spotShadowMap', 'spotLightShadows', 'vSpotLightCoord']) {
        const indices = [...active.matchAll(new RegExp(name + '\\[\\s*(\\d+)\\s*\\]', 'g'))].map(
          (match) => Number(match[1]),
        );
        assert.deepEqual([...new Set(indices)], [0, 1, 2]);
      }
      assert.equal((active.match(/rectAreaLight.color \*=/g) ?? []).length, 3);
      assert.equal((active.match(/RE_Direct_RectArea\( rectAreaLight,/g) ?? []).length, count);
    });
  }
}
