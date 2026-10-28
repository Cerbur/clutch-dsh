# Shared material style acceptance

Date: 2026-10-27. Branch `wt-office-0.1.0/release`, uncommitted working-tree.

The user requested coordinated colors and materials while deferring layout work.
Five component workers created eleven immutable `2026-10-27-style-r1` revisions.
The Blender library owns the [art direction](ART-DIRECTION.md) and machine-readable
palette, mirrored in this package. Its native reusable material .blend contains
12 asset-marked Principled materials, zero objects; an independent reopen passed.

## Adopted bytes

| Asset                     | Triangles |     Bytes | SHA-256                                                            |
| ------------------------- | --------: | --------: | ------------------------------------------------------------------ |
| `character/deepseek`      |    50,000 | 8,045,316 | `83bb40a9ff77250ea05c2605c49aa221c1daa23176480389b5d443d17f393cc1` |
| `kitchen/stove`           |    35,214 |   974,160 | `ed3f084b2cd9497c9cd56db9cde2b6711f9da65c48d5759b84dbe6d26a0467aa` |
| `kitchen/table`           |    49,964 | 2,783,032 | `8430329a3cc3e56064e5fa8642931992d5336d04c0f51b36f0fd7f2c71b00b05` |
| `kitchen/left-wall`       |     3,300 |    74,156 | `30a4e1c84377fa297c396a372176199c5c3551fcd7b0fd8237ce3f3884c28798` |
| `kitchen/wall-cabinet`    |     2,472 |   207,648 | `415762657c50ac4ad118875610e7e7fb7b414ccc7cf4f1f821453bef928dd18b` |
| `kitchen/utensil-rail`    |    17,999 |   550,824 | `37f9d7ab7aa0e5a100ea732841dd9795facb5f675f00fd05e0c1142d43411089` |
| `kitchen/range-hood`      |    11,012 |   391,612 | `6f64c2ab52437145c2de456ba408d8af06a5646dc4f71dc2c0d5c4f6bfb68cca` |
| `kitchen/storage-cabinet` |    25,816 |   596,560 | `602fd5855eab2e341109715cb336173d61894fa000e15fc421c7057bbd654f42` |
| `kitchen/pendant-light`   |    17,000 | 1,833,184 | `1c0be5c718d1c8afc17cbb26afb8e19e138253239d249993268c21364b2b4290` |
| `kitchen/refrigerator`    |    29,499 | 3,747,836 | `e572552d50700160eb0e155654e39edb640e71e560cb1b5373dd353160e3a4fb` |
| `kitchen/sink-cabinet`    |    34,530 |   789,668 | `0d1b14bdca2f328a6c3fc1e93a76dc056d6acfe2b8126a84568f8a4028216920` |

Cream surfaces, coordinated medium/light blues, honey wood and muted gold replace
the inconsistent per-component colors. Metallic response is preserved for sinks
and bare frames; wood, fabric and enamel remain dielectric. Selective image/UV
masks preserve eyes, decals, food, cloth patterns and the whale badge COLOR_0.
Workers saved material-editing .blend files and reproducible scripts in their
component lookdev directories, with actual fixed-studio Cycles before/after renders
and independent final-GLB imports. Frozen parent bytes are retained.

## Verification

`validate-material-revision.mjs` and the existing importer validated every new
revision against its accepted parent before adoption. The audit hashes actual
positions, normals, UVs, indices and morph data, plus hierarchy/initial transforms;
material/image/COLOR_0 changes are allowed. All eleven signatures remained equal.
The scene layout, runtime camera/light/exposure code and CSS matched the stored
pre-style SHA-256 baseline. No geometry normalization, placement or light tuning.

Actual results: `{"passed": true, "testsPassed": 32, "build": "passed", "typecheck": "passed", "lint": "passed", "workspaceCheck": "passed", "patchGuard": "passed with pre-existing YAML warning", "overview": {"kitchens": 5, "activeSessions": 0, "idleRoomsVisible": true}, "focusedKitchen": "passed", "localPreview": {"actors": 2, "cookingAndWaitingBubbles": true, "searchActorReachedRefrigerator": true, "nativeSessionsModified": false}, "offscreenDisposalAndRebuild": {"passed": true, "remainingCanvases": 1, "alerts": 0}, "freshColdBrowser": {"warnings": 0, "errors": 0, "alerts": 0, "canvases": 1}, "oldTabDuringHotReload": "one duplicate Three.js warning; absent on fresh cold page", "comparisonViewport": {"width": 1280, "height": 720, "canvasWidth": 1166, "canvasHeight": 820}, "layoutCameraLightsCssUnchanged": true, "reducedMotion": "not manually toggled; redraw/disposal tests passed", "profile": "/Users/yuancheng/.dsh-test", "url": "http://127.0.0.1:3088/"}`

Commands: `pnpm --filter @cerbur/clutch-dsh-office test` (build + 32 tests),
`typecheck`, `lint`, `pnpm run check:workspace`, `pnpm run check:patches`, Prettier
and `git diff --check`. Patch guard retains its existing !!js YAML warning.
`test/material-style.test.mjs` proves surface edits are permitted while vertex,
UV and pivot mutations are detected. Existing furniture/posed-actor sweeps pass.

Real service: `DSH_HOME=/Users/yuancheng/.dsh-test`, http://127.0.0.1:3088/ .
Same viewport/overview canvas, camera, exposure and lights were used before and
after. Preview activities never run or modify native Sessions. Reduced motion
was not manually toggled in this pass; asynchronous redraw/disposal tests pass.
The listener profile and linked release package were verified; service left open.

Evidence: [before](../assets/screenshots/office-material-before.png),
[after](../assets/screenshots/office-material-after.png),
[characters before](../assets/screenshots/office-material-character-before.png),
[characters after](../assets/screenshots/office-material-character-after.png),
[search](../assets/screenshots/office-material-search.png).
Paired library evidence is `sync/evidence/2026-10-27-material-style/`; separate
revision/hash receipts record acceptance and catalog adoption for all 11 assets.

## Limits

This pass improves color family and surface coherence; it does not finish model
silhouettes, remove all baked highlights/shadows, add missing reference objects,
change the spacious layout, animate hands or match Blender lighting exactly.
The original 5 x 5 x 3.5 m room and 30-degree orthographic view remain.
Static mesh/door-interior limitations are unchanged. Total GLBs: 19,993,996 bytes
(19.07 MiB); uncompressed Client: 28,129,903 bytes (28.13 MB).

Plugin-only; no DSH source/production profile/immutable snapshot changes, no native
Session commands, no commit/push/publish. Accepted refers to this working-tree.
