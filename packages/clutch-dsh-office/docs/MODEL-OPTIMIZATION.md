# Kitchen geometry and surface revision · 2026-10-31

## Lossless transport and runtime budgets

The geometry selection below remains medium. Production builds additionally select
`assets/models/kitchen/transport/manifest.json`: 28 separately hashed GLBs with PNG
images losslessly encoded as WebP. JPEG images stay byte-identical. Geometry streams,
UVs, materials and decoded pixels are verified; the original optimized files remain
the bake source. Packaged files include transport GLBs instead of duplicate optimized
GLBs. Inline modeling previews continue to use the original optimized GLBs.

Run `pnpm --filter @cerbur/clutch-dsh-office textures:compress` after changing an
optimized source, then run `node --test test/texture-transport.test.mjs` after build.
Stale source/transport hashes fail the production build. This does not authorize
changing geometry or material response without rebaking.

Runtime small props use 512px images; larger surfaces and characters retain 1024px.
The character template is parsed once per room with shared geometry/textures and
independent skeletons, morph weights and mixers. Replaced procedural geometry is
released immediately. These are memory/loading optimizations, not triangle reduction.

Production selects `assets/models/kitchen/optimized/manifest.json`, quality **medium**.
The original 28 kitchen GLBs and their delivery manifests remain byte-identical.
`runtime-models.mjs` verifies both the original and derivative hashes before the
Client build, geometry export or lighting import selects a derivative. Runtime
requests only that selected file through the existing authenticated asset service.
The source/candidate copies increase checkout storage. The npm file list excludes
unused original kitchen GLBs and contains only the 28 selected derivatives plus
the character; they are not all downloaded or decoded as multiple qualities.
No automatic distance LOD is used.

## Measured geometry and transfer

These totals count each of the 28 unique kitchen files once, excluding characters.
Surface preparation only changes the hood's textures/PBR; its smaller PNG accounts
for the difference between the adopted original and the simplifier input.

| Version               |      Bytes | Vertices | Triangles | Decoded geometry bytes |
| --------------------- | ---------: | -------: | --------: | ---------------------: |
| Adopted original      | 55,760,240 |  369,616 |   477,327 |             14,579,748 |
| Surface-revised input | 55,019,916 |  369,616 |   477,327 |             14,579,748 |
| High (85% target)     | 49,092,932 |  335,326 |   414,417 |             13,021,182 |
| Medium (60% target)   | 48,101,520 |  295,012 |   341,383 |             11,328,714 |
| Low (35% target)      | 47,428,464 |  267,525 |   293,939 |             10,181,650 |

Medium removes **28.48%** of unique-source triangles and **20.18%** of vertices.
Before lossless Meshopt encoding its simplified files total **51,765,192 bytes**;
encoding then reduces them to **48,101,520 bytes** without further triangle loss.
The full 33-instance kitchen, including reused chairs/plants, changes from
**543,917 to 399,911 static triangles (26.48% fewer)** and retains 49 primitives.
Draw count is not reduced; the comparison renderer also submits a second pass for
the double-sided transparent stove surface. GPU time is still affected by shading,
texture bandwidth, pixel count and shadows. Desktop preview FPS is not a mobile
performance certification or a guaranteed percentage speedup.

The maximum relative geometric error is **0.001**, with topological borders locked.
Exact duplicate faces are removed only when one identical triangle still covers
the surface (including opposite winding on double-sided material). Thin single-sided
surfaces instead retry with stricter error; medium table uses **0.0005**, retaining
40,396 triangles. All 28 final medium components independently re-import into
Blender with exactly the declared counts and no invalid positions or normals.
UV/normal discontinuities constrain further simplification: foliage and some
reconstructed props retain more geometry than their target ratios. No forced
permissive collapse, mesh joining, texture resizing or position quantization occurs.
Shells under 1,000 triangles, the walkable rug/mat, and any animated/skinned/morph
asset are conservatively retained. Kitchen assets have no skin, animation or morph;
the character is outside this batch and remains the accepted face-blink asset.

## Surface and lighting fixes

- The window's old depth-only emission mask included 5,326 rear/side vertices.
  The mask now bounds front-pane depth and normal, and emission changes from
  0.9 to 0.32 with a less orange tint. The window practical moves from 0.27 m in
  front of the component to 0.105 m, facing straight into the room at 8 W.
  It therefore no longer lights the front timber rail from in front of the window.
- Neutral hood coating pixels use a consistent slate paint palette, metallic 0,
  roughness 82/255, coat <= 0.12 and normal scale 0.22. Saturated whale
  graphics, bright belly, black controls and warm lamp base-color pixels are
  excluded from recoloring; roughness/metallic retuning is limited to neutral
  coating. The normal scale and coat cap apply to the shared material. This
  is a color/response revision, not a claim of recovering the original photograph.
- The right platform line reproduced only with baked diffuse enabled. The named
  `圆角木框` mesh now retains continuous realtime PBR. Ceramic and walls keep
  baked diffuse. The wood still validates and participates in Cycles bounce;
  this does not bypass any source/layout/geometry guard.
- New Cycles 64-sample CPU bake r55 and OIDN r56 use all 33 actual optimized
  instances, the revised hood and the same practical-v3 JSON as Three. They
  retain 2K RGBM8, 20,832 UV bytes and the 16 MiB decoded atlas budget. Earlier
  r49–r54 are diagnostic history. Runtime environment/camera/layout are unchanged.

## Reproduce and compare

Run from the package directory after installing workspace dependencies:

```bash
node scripts/refine-kitchen-surfaces.mjs assets/models/kitchen /tmp/office-surface-input
pnpm models:optimize --input /tmp/office-surface-input --output /tmp/office-models --ratios .85,.6,.35 --error .001
pnpm models:compare /tmp/office-models
```

The local-only comparison server listens at `http://127.0.0.1:4189`. It switches
original/high/medium/low while retaining the same camera, lighting and renderer;
provides OrbitControls, fixed review/front/right/back/window/hood/edge views,
wireframe, unlit/normal/shadow isolation, actual renderer triangles/draw calls,
FPS/frame time, file bytes and end-to-end load time. The original option reads
the retained adopted kitchen files. The optional production bake applies only to
the matching medium set. It loads one quality into GPU memory at a time.

`--no-compress` emits ordinary glTF geometry. Meshopt output uses the Three r180
bundled decoder, with no Draco decoder or additional network decoder request.
Both simplified uncompressed accessors and compressed containers are validated.
The validator reports zero errors; existing generated-tangent warnings remain,
and its unsupported-Meshopt notice is supplemented by actual Three decoder tests.
Names, transforms, hierarchy, extras, material count and image bytes are checked
before encoding. Source image dimensions and formats are recorded in the JSON report.

`adopt-models.mjs OUTPUT_DIRECTORY` is an explicit maintainer step after visual
review; it does not regenerate lightmaps. Any changed occluder/material/light
requires a real Cycles rebake and `lighting:import`, not just new provenance hashes.
Raw `.blend`, uncompressed bake inputs and all original/high/medium/low candidates
live in `office/kitchen/<component>/work/2026-10-31-meshopt-soft-r3/` in the Blender
library. The optimizer script is the canonical executable in this package; archived
script copies in the library document the tool revision and use this package's
installed dependencies. Frozen historical deliveries and the rejected refrigerator
refinement are not changed or re-adopted.

Full per-file statistics, bounds, hierarchy, extensions, textures and validation:
[JSON report](reports/2026-10-31-model-optimization.json).
