import * as T from 'three';

const PATCH_ID = 'kitchen-area-shell-front-fill-v5';
const configured = new WeakSet<T.Material>();
const include = '#include <lights_fragment_begin>';
const shadowInclude = '#include <shadowmap_pars_fragment>';
const assignment = 'rectAreaLight = rectAreaLights[ i ];';

// Eight irregular disk points and their antipodes, rotated once at module load.
// The compiled GLSL has 16 literal taps, zero per-pixel/frame random state.
const rotation = 0.37;
const disk = [
  [0.13, 0.09],
  [0.42, -0.21],
  [-0.28, 0.43],
  [0.62, 0.32],
  [-0.68, 0.12],
  [0.18, 0.78],
  [-0.42, -0.67],
  [0.78, -0.52],
];
const taps = disk.flatMap(([x, y]) => {
  const u = x * Math.cos(rotation) - y * Math.sin(rotation);
  const v = x * Math.sin(rotation) + y * Math.cos(rotation);
  return [
    [u, v],
    [-u, -v],
  ];
});
const visibilityHelper = `
// ${PATCH_ID}
#if defined( USE_SHADOWMAP ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) )
float kitchenAreaVisibility(
  sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity,
  float shadowBias, float shadowRadius, vec4 shadowCoord
) {
  // Derivatives must run before any fragment-dependent early return.
  vec3 coord = shadowCoord.xyz / max(shadowCoord.w, 0.000001);
  vec3 dx = dFdx(coord);
  vec3 dy = dFdy(coord);
  float detUV = dx.x * dy.y - dx.y * dy.x;
  vec2 gradient = vec2(0.0);
  if (abs(detUV) > 0.0000000001) {
    gradient = vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / detUV;
  }
  if (shadowCoord.w <= 0.0) return 1.0;
  coord.z += shadowBias;
  if (any(lessThan(coord, vec3(0.0))) || any(greaterThan(coord, vec3(1.0)))) return 1.0;
  vec2 texel = 1.0 / shadowMapSize;
  vec2 halfTexel = texel * 0.5;
  vec2 spread = texel * shadowRadius;
  float visibility = 0.0;
  vec2 sampleUV;
  ${taps
    .map(
      ([x, y]) =>
        `sampleUV = clamp(coord.xy + vec2(${x.toFixed(8)}, ${y.toFixed(8)}) * spread, halfTexel, vec2(1.0) - halfTexel);\n  visibility += texture2DCompare(shadowMap, sampleUV, coord.z + dot(gradient, sampleUV - coord.xy));`,
    )
    .join('\n  ')}
  return mix(1.0, visibility * (1.0 / 16.0), shadowIntensity);
}
#endif
`;

/**
 * Three r180 LTC diffuse is already normalized by pi (LTC_EdgeVectorFormFactor).
 * Only the direct LTC light color is masked: both diffuse and specular keep their
 * original BRDF. Indirect PMREM/bounce are deliberately not multiplied by this mask.
 *
 * Receiver-plane depth correction follows each tap on sloped surfaces, avoiding
 * wide-kernel self-shadow stripes without increasing constant bias.
 * This is one center-of-area projection with a fixed 16-tap Poisson PCF, not area-integrated
 * occlusion: a partially hidden large emitter can be too dark or too bright.
 * Private kitchen invariant: three shadowed rectangles, an optional unshadowed front fill, and four shadow-only,
 * map-less spots: key/fill/rim, then the character-only key projection. Three's stable light sort preserves
 * that order within each type. Do not add/hide/reorder individual rig lights.
 */
export function configureKitchenMaterial(material: T.Material): void {
  if (!(material instanceof T.MeshStandardMaterial) || configured.has(material)) return;
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  const defaultCacheKey = previousCacheKey === T.Material.prototype.customProgramCacheKey;
  const previousCompileKey = previousCompile.toString();
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    if (shader.fragmentShader.includes('// ' + PATCH_ID)) return;
    if (
      !shader.fragmentShader.includes(include) ||
      !shader.fragmentShader.includes(shadowInclude)
    ) {
      throw new Error(
        PATCH_ID + ': previous material hook removed a required lighting/shadow include',
      );
    }
    const chunk = T.ShaderChunk.lights_fragment_begin;
    if (!chunk.includes(assignment))
      throw new Error(PATCH_ID + ': unsupported Three lighting chunk');
    // Keep [ i ] and UNROLLED_LOOP_INDEX for Three's own loop unroller: sampler
    // arrays must be addressed with compile-time constants in WebGL.
    const shadowed = chunk.replace(
      assignment,
      assignment +
        `
        // Mask only this emitter, leaving native spot filtering untouched.
        #if defined( USE_SHADOWMAP ) && ( defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) ) && (NUM_RECT_AREA_LIGHTS == 3 || NUM_RECT_AREA_LIGHTS == 4) && NUM_SPOT_LIGHT_SHADOWS == 4 && NUM_SPOT_LIGHTS == 4 && NUM_SPOT_LIGHT_MAPS == 0
          #if UNROLLED_LOOP_INDEX < 3
          rectAreaLight.color *= receiveShadow ? kitchenAreaVisibility(
            spotShadowMap[ i ],
            spotLightShadows[ i ].shadowMapSize,
            spotLightShadows[ i ].shadowIntensity,
            spotLightShadows[ i ].shadowBias,
            spotLightShadows[ i ].shadowRadius,
            vSpotLightCoord[ i ]
          ) : 1.0;
          #endif
        #endif
    `,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace(shadowInclude, shadowInclude + visibilityHelper)
      .replace(include, shadowed);
  };
  material.customProgramCacheKey = function () {
    // The default key reads this.onBeforeCompile; capture its original text to
    // avoid erasing a previous hook's identity after installing our wrapper.
    const previous = defaultCacheKey ? previousCompileKey : previousCacheKey.call(this);
    return previous + '|' + PATCH_ID;
  };
  configured.add(material);
  material.needsUpdate = true;
}
