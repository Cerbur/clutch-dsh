# Floor asset acceptance

2026-10-27. `2026-10-27-r1`, SHA-256 `afa575fe5a13fa26f663fe15003c40b530b74d5b534ddc3929268ea88df07364`; release working-tree, uncommitted.
User requested a reference-style rounded timber platform, ceramic surface and real baked normals.

## Asset

Native source: `/Users/yuancheng/Documents/blender/office/kitchen/floor/厨房底板.blend`.
Frozen manifest: `/Users/yuancheng/Documents/blender/office/kitchen/floor/deliveries/2026-10-27-r1/manifest.json`.
3,684,100 bytes,830 triangles,2 meshes/primitives/materials,5 embedded PNGs.
Outer5.2m square, .285m total height;5m ceramic insert at Y=.025m,wood bottom-.26m.
`floor-surface-center` is an explicit new origin contract. Scene root at (0,0,.5), scale1;
the old embedded centerZ offset moved to the root, preserving all furniture/actor world positions.

## Actual Blender work

Official Blender5.2.3, isolated CPU Cycles. Native rounded timber silhouette and flat insert.
64 high tiles with4mm bevels and10mm gaps project via selected-to-active NORMAL to2048² tangent normal.
Low insert contains2 triangles; wood uses1024² procedural grain color/normal, tile has color/roughness.
Color uses EMIT bake only, with no light/AO/shadows. Native project packs images and keeps3 editable
source materials with fake users plus hidden64-tile source and studio collections. Neither studio nor
high source goes to GLB. Final wood explicitly triangulated for stable exported tangents.

Fresh Blender import decoded final GLB images and checked830 triangles, zero degenerate triangles,
zero invalid normals/UVs. Actual whole/detail/top/underside and independent-GLB renders reviewed.
Saved-native audit found no missing files; normal-on/off renders have maxRGB channel difference
0.0824. This is measured render difference, not a depth/displacement claim.
Blender MCP interactive connection was inspected; its background helper lacked an executable path,
so official Blender ran directly via its absolute executable. The user's unsaved scene was retained.

## Plugin and real-profile verification

Independent floor importer:5,000triangles/6MiB/2materials/2primitives; other rules unchanged.
Shared bundled loader owns textures/geometry and removes fallback surface on success; legacy mat stays
separate so it does not disappear or double with floor adoption. Existing late-load/offscreen lifecycle retained.

- `assets:import` passed before building; actual GLB/manifest matches the frozen delivery.
- `pnpm --filter @cerbur/clutch-dsh-office test`: build passed; floor bounds test initially used `.y`
  on an array and was fixed to `[1]`. Re-ran `node --test test/*.test.mjs`:35passed,0failed.
- typecheck,lint,workspace and patch guards passed (existing!!jsYAML warning).
- Actual `DSH_HOME=/Users/yuancheng/.dsh-test`, port3088; stopped listener restarted using existing profile.
  -5 empty native kitchens, focused room, two-actor cooking/waiting/search preview inspected.
  -Scrolled to list end and returned: one remaining canvas, zero alerts, new floor reconstructs.
  -Cold and subsequent console warnings/errors:0. Reduced motion not manually toggled; regression tests pass.
  -Other11 asset hashes unchanged. Camera/lighting/CSS/room/furniture/routes unchanged. Only floor root local
  origin and separately compensated legacy mat coordinates changed. Tile contact height remains .025m.

Evidence:[overview](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-floor-overview.png),[actors](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-floor-preview.png),
[search](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-floor-search.png),[list-end](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-floor-list-end.png).
Library receipt `sync/receipts/kitchen-floor-2026-10-27-r1.json` and evidence directory `sync/evidence/2026-10-27-floor/`.

## Limits

Normal maps produce light response, no parallax/collision displacement. Fine grain and pores are deliberately
subtle at overview size. Tile pattern is procedurally authored from reference, not pixel-identical stone grain.
No rugs/furniture are in the floor asset. No adoption of other sessions' ready rug/shelf/trash-can deliveries.
Total12 embedded GLBs:22.58MiB; uncompressed Client:33.06MB.
Plugin-only,no DSH source/production-profile changes,no native Session runs,no commit/push/publish.
