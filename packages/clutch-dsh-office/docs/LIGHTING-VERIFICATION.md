# Kitchen lighting verification

2026-10-27. User authorized Three.js lighting after the material-only revision.
Implementation: `src/client/scene/lighting.ts`; [design and parameters](LIGHTING-DESIGN.md).

## Result

Replaced the strong uniform ambient wash with warm key / cool fill / hemisphere,
a locally generated PMREM studio reflection map, short-range hood/shelf practicals
and softer pendant illumination. One 1024-square VSM caster provides blurred shadows;
a low-opacity stage receiver anchors the unchanged room platform. Background is warm gray.
No network HDR or extra dependency, no postprocessing passes or screen-space AO.

All eleven adopted GLBs and manifests retain their pre-lighting byte identities.
Layout, room size, camera and CSS remain unchanged. No Blender source re-export or
new component delivery; prior material receipts are still valid, with a new scene-lighting receipt.

## Checks actually run

- `pnpm --filter @cerbur/clutch-dsh-office test`: build plus **33 passed**.
- `typecheck`, `lint`, `pnpm run check:workspace`, `pnpm run check:patches` passed.
  Patch guard keeps the pre-existing !!js YAML warning.
- Final numerical PMREM tuning rebuilt and checked in a fresh cold browser;
  zero console warnings/errors and zero alerts. The original overlarge blur candidate
  warned about sample clipping; it was corrected, not suppressed.
- Actual service listener `DSH_HOME=/Users/yuancheng/.dsh-test`, port3088, and
  test profile link to this release package verified. Service left running.
- Overview: five native kitchens, zero active Sessions, all empty rooms remain.
- Local preview: two actual GLB characters, cooking/waiting and searching checked.
  No native Session was run or modified. Moving actors update shadows.
- List end and return: the kitchen rebuilt with environment/local lights intact;
  one remaining canvas, zero alerts. A new test verifies both allocated VSM targets
  and the receiver geometry/material release once without disposing scene assets.
- Static-room shadow caching invalidates on asynchronous assets, resize and interaction;
  actor asynchronous loads now request redraw, including reduced-motion mode.
  Reduced motion was **not manually toggled**; no measured FPS or GPU heap plateau claim.
- Same1280×720 viewport, canvas1165.8125×820 at (82.59375,-67), same camera,
  exposure and model/material bytes used for the before/after overview captures.

## Evidence

[Before](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-before.png) ·
[After](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-after.png) ·
[Two actors](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-preview.png) ·
[Search](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-search.png) ·
[List end](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-list-end.png).

Library counterpart: `docs/实时光照设计.md`, `sync/receipts/kitchen-lighting-2026-10-27-v1.json`,
`sync/evidence/2026-10-27-lighting/`. Parameters are owned by the plugin lighting module.

## Limits and boundaries

This is a warm studio approximation, not real-time global illumination. Light pools
have no additional shadow maps, so slight local light leaking remains possible.
Texture-baked shadows, incomplete geometry and static arm/hand appearance remain.
Reference density, missing model details and layout are outside this pass.
Client bundle rounds to28.15MB uncompressed; no GLB payload size increase.

Plugin-only, no DSH source/production-profile changes, no commit/push/publish.
Acceptance refers to the current release working-tree.

## Front-facing key revision, 2026-10-27-v2

User requested removing the side key or lighting from the front. The key now follows
the camera direction (45-degree azimuth, 30-degree elevation), position (8,7.532,8.5)
toward (0,1,0.5); intensity2.8→2.2. Other lights, exposure, layout and models stay fixed.
Built and visually reviewed in ~/.dsh-test; two walls now receive more balanced light,
and the large exterior side shadow no longer dominates. Resource ownership is unchanged.
Current overview evidence: [office-lighting-front.png](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-front.png) in the plugin;
Blender receipt: `sync/receipts/kitchen-lighting-2026-10-27-v2.json`. The v1 captures and
receipt remain historical. This pass did not repeat the v1 two-actor/offscreen checks.

## Reference color-temperature refinement, 2026-10-27-v3

User requested closer reference color temperature. The key stays camera-facing,
now peach #FFE0CC/2.5; neutral/cool stage #77727A and gentler hemisphere/fill frame
amber #FFB653 practicals. Khronos PBR Neutral replaces ACES, at unchanged exposure0.95.
Actual cold ~/.dsh-test overview reviewed with zero console warnings/errors. Build,
typecheck, lint and existing lighting resource test passed. This pass did not rerun
two-character or offscreen scenarios. GLB/manifest/layout/CSS byte identities retained;
no material or camera edits. These are artistic RGB light colors, not calibrated CCT.
Current screenshot [office-lighting-temperature.png](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-temperature.png); library
receipt `sync/receipts/kitchen-lighting-2026-10-27-v3.json`. Previous captures remain
historical. Reference modeling/texture differences and missing window light remain.
