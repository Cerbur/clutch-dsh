# Whale-girl runtime optimization and Office lint · 2026-11-07

Worktree: `wt-office/feat-whale-girl-optimize-lint`, baseline commit `f5480eb`.
The feature worktree was clean before this task. After implementation and validation,
the user separately authorized scoped commits on this feature branch. No push,
version change, merge, release, profile installation or DSH source change was performed.

## Current asset and ownership audit

Read from this branch's GLB/manifest and validated with `validateAsset`, rather
than inherited from an earlier handoff:

| Property                               | Before and after                                                   |
| -------------------------------------- | ------------------------------------------------------------------ |
| Revision                               | `2026-10-29-face-blink-r2`                                         |
| SHA-256                                | `eea3bc03f99ea735948a8e33c108b3ae5eb2bbb860651d4bc217421a604bc003` |
| GLB size                               | 7,172,924 bytes                                                    |
| Triangles                              | 57,002                                                             |
| Source meshes / runtime skinned meshes | 1 / 3                                                              |
| Materials / primitives                 | 3 / 3                                                              |
| Textures / embedded images             | 4 / 4                                                              |
| Skin / joints / maximum influences     | 1 / 31 / 4                                                         |
| Morph controls                         | 4, each with position and normal attributes                        |
| Clips                                  | `Walk_InPlace` (93 bone channels), `Blink` (1 weight channel)      |

Three PNGs are 1024×1024; the JPEG is 2048×2048. Runtime texture limiting still
caps characters at 1024. Three material primitives imply three submissions per
actor in a simple main pass, twelve for four actors; this is not a measurement of
total GPU draws, which also depend on shadows and rendering passes.

Production bytes use the existing authenticated asset loader/concurrency gate.
`buildDeepSeek` keeps a WeakMap keyed by room Models; the pending template is loaded,
parsed, texture-limited and given the existing PBR soft fill once per room.
SkeletonUtils clones each actor, with its three mesh rigs rejoined inside that
actor. Geometry/materials/textures are room-owned; skeletons, morph weights, blink
timers and animation mixers remain independent. Late delivery, fallback cleanup,
actor removal and room disposal retain their existing ownership paths.

## Evidence and implementation

All three primitives reference the same 65,187-entry position/skin/morph arrays,
but have separate indices. The previous support-band scan visited the full array
three times, including body feet that were not drawn by either face primitive.
The scan now deduplicates each primitive's actual index references. Non-indexed
geometry still visits every vertex. No geometry, material or animation payload is
rewritten or removed.

Stable idle now advances automatic blinking without repeating skeletal mixing
and sole probes. The first update, active gait/search, final fade frame and resume
still evaluate and ground the pose. A support-band expression check retains idle
grounding for rigs whose morphs affect their feet; the adopted eyelid morphs do not.
The signed gait speed, random blink interval, corrective curve, transitions,
reduced-motion behavior, four-character limit and hidden/offscreen lifecycle are
unchanged. Native Session projection, kitchen assets/layout/camera/light and PBR
shading were not changed.

This adopts runtime CPU savings rather than a new model derivative. The GLB and
manifest stay byte-identical, so there is no new asset revision, asset import,
library write or rebake. Existing frozen deliveries remain intact. Geometry
decimation, texture resizing/re-encoding and style reconstruction were not needed
for these measured savings. No image-generation or modeling tool is required.

## Measured before / after

Node v26.3.1, Apple M1 Pro, macOS arm64. Four actual template clones, seven samples
of 300 updates per mode after 120 warmup updates. Measurement excludes model/image
loading and rendering. Probe counts are collected separately from timings.

| Four-character work                  |      Before |       After |
| ------------------------------------ | ----------: | ----------: |
| Initialization vertex probes         |     782,244 |     242,468 |
| Stable idle probes per update        |       2,844 |           0 |
| Walking/searching probes per update  |       2,844 |         948 |
| Stable idle CPU median per update    | 0.361644 ms | 0.000335 ms |
| Walking CPU median per update        | 0.374239 ms | 0.150761 ms |
| Searching CPU median per update      | 0.360535 ms | 0.140603 ms |
| Reduced-motion CPU median per update | 0.010893 ms | 0.010822 ms |

Walking CPU update time is about 59.7% lower in this probe. This is **not** an FPS,
GPU time, VRAM, network, load-time or device-wide performance claim. Reduced motion
is effectively unchanged. Raw samples, source metrics and environment are recorded
in [the machine-readable report](reports/2026-11-07-character-runtime.json).

Before/after comparison covers 960 frames per actor for four actors, standing,
blinking, walking, stopping, searching, search-to-walk, reverse gait, reduced motion
and pause/resume. All 5,763,840 compared bone-matrix/morph/root-height values match
exactly (maximum error 0). With unchanged geometry and materials this preserves
the rendered pose inputs. There is no changed-model visual candidate or same-frame
art approval to request; this numerical comparison is not a pixel-difference test.

## Lint baseline and repairs

The old package command `eslint src` passed, but `pnpm exec eslint
packages/clutch-dsh-office` from the root reproduced **173 errors**: 172 missing
environment identifiers and one `no-this-alias` in a renderer mock. Node modules
now import their built-ins; Web API globals are explicitly obtained from
`globalThis`. The serialized browser probe obtains its browser globals inside the
serialized function, so they remain available after bundling. The renderer mock
registers its instance in a collection instead of aliasing `this`.

Package `lint` now checks `src scripts test`. No rules are disabled, ignored paths
added, root configuration changed or type assertions added to suppress diagnostics.
Both README development-command lists include lint.

## Reproduction and validation

From the feature root, capture the baseline source before benchmarking the build:

```bash
git show f5480eb:packages/clutch-dsh-office/src/client/scene/character/animation.ts > /tmp/office-whale-baseline-animation.ts
pnpm --filter @cerbur/clutch-dsh-office lint
pnpm --filter @cerbur/clutch-dsh-office typecheck
pnpm --filter @cerbur/clutch-dsh-office build
```

From the Office package:

```bash
node scripts/benchmark-character.mjs /tmp/office-whale-baseline-animation.ts /tmp/office-whale-benchmark.json
node --test test/character-animation.test.mjs test/character-sharing.test.mjs test/runtime-demand.test.mjs
node --test --test-concurrency=1 test/*.test.mjs
```

The benchmark uses a geometry-only in-memory parsing copy, with the delivered
skin/morph/animation bytes unchanged; it does not replace the runtime GLB.

Browser check used the branch's local `scripts/performance-preview.mjs` fixture
at `127.0.0.1:4191`, in the in-app browser. Four simulated characters and PBR kitchen
rendered, then hiding removed the canvas (0) and showing rebuilt it (1), with 0 alerts
and no captured warnings/errors. The screenshot was saved to
`/tmp/office-whale-four-characters.png`. This is a local fixture check, not native DSH
profile integration or a new user art approval. OS reduced motion was not manually
toggled; automated animation/lifecycle tests cover it. No FPS/VRAM/load benchmark
was run. The optional Playwright CLI download failed on network access; the built-in
browser completed the UI check instead.

Initial dependency download failed without network access. `pnpm install
--frozen-lockfile` subsequently succeeded; the lockfile did not change. Build/test
output needed write access to the existing worktree under `.agents`. The first
changed build exposed a missing callback type; it was corrected with a
`BufferGeometry` annotation. Focused tests were then rerun against the successful
build, rather than treating tests against the previous build as acceptance.

Final checks:

| Command                                                                                                                       | Actual result                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm --filter @cerbur/clutch-dsh-office lint`                                                                                | Pass; expanded source/script/test scope, 0 errors                             |
| `pnpm exec eslint packages/clutch-dsh-office` (root)                                                                          | Pass; 173 baseline errors cleared                                             |
| `pnpm --filter @cerbur/clutch-dsh-office typecheck`                                                                           | Pass                                                                          |
| `pnpm --filter @cerbur/clutch-dsh-office build`                                                                               | Pass, including final formatted sources                                       |
| `node --test --test-concurrency=1 test/*.test.mjs`                                                                            | 355 tests: 351 pass, 0 fail, 4 optional library checks skipped; 317.1 seconds |
| `OFFICE_ASSET_LIBRARY=/Users/yuancheng/Documents/blender/office node --test test/left-decor.test.mjs test/floor-mat.test.mjs` | 12 pass, 0 fail, 0 skip; includes all four skipped library checks             |
| `node --test test/character-animation.test.mjs test/character-sharing.test.mjs test/runtime-demand.test.mjs`                  | Final rerun: 25 pass, 0 fail, 0 skip                                          |
| `node scripts/benchmark-character.mjs /tmp/office-whale-baseline-animation.ts /tmp/office-whale-benchmark.json`               | Pose equivalence assertion passed; samples recorded above                     |
| `pnpm run check:workspace` / `pnpm run check:patches`                                                                         | Pass; existing YAML `!!js` unresolved-tag warning retained                    |
| `pnpm exec prettier --check` with changed code/JSON and the new audit document                                                | Pass                                                                          |
| `git diff --check`                                                                                                            | Pass                                                                          |
| `git diff --exit-code -- assets src/office src/client/scene/kitchen src/client/scene/lighting.ts` (package)                   | Pass; protected assets and scene/Session areas unchanged                      |

The full run started before the extra real-four-actor ownership test was added.
That new test passed separately and in the final 25-test focused run; the full run
is not described as containing it. Subsequent source changes were formatting only.
The dynamic full regression includes actual gait/furniture checks, interrupted
fridge travel and full turns of the four-session silhouette. No pending test failure
remains. The local fixture service was stopped after verification.

Run logs are `/tmp/office-whale-full.log`, `/tmp/office-whale-focused-final.log`,
`/tmp/office-whale-library.log`, `/tmp/office-whale-build-final.log`, and
`/tmp/office-whale-lint-all-baseline.log`. User art approval from historical asset
deliveries is not inferred from this runtime audit. No new visual style was adopted.
