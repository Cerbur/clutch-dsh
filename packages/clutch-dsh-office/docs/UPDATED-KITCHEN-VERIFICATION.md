# Updated kitchen set — 2026-10-27

## Latest placement update — 2026-10-28

Table and both stools moved another0.40m outward on user confirmation. Table[1.45,0,.95], stools[.95,.025,1.83]/[1.98,.025,1.83]; same right-edge clearance and relative spacing. All18GLB/manifests retain their prior hashes; other furniture, actor stations, lighting and camera unchanged.79tests/full build/typecheck passed; actual refreshed ~/.dsh-test overview and two-character preview checked, no scene alerts or warning/error logs. Blender and offscreen manual checks were not repeated this iteration. Latest library receipt `sync/receipts/kitchen-layout-2026-10-28-outward-v1.json`; prior sections below are historical for the earlier placement.

[Outward table](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-outward-r2.png)

The table stays at the right edge, aligned around the stove center then moved outward0.40m by the user's latest request. Final table[1.45,0,.55], stools[.95,.025,1.43]/[1.98,.025,1.43], rug[-.95,.0255,2.42]. Original authored units and sizes remain. New sink r2 at[-.05,0,-1.463], new source DeepSeek r2 adopted. This supersedes the prior aligned-layout report's placements/asset versions; its frozen snapshots remain historical.

| Asset                | Revision      | Triangles |   Bytes | SHA256                                                             |
| -------------------- | ------------- | --------: | ------: | ------------------------------------------------------------------ |
| kitchen/sink-cabinet | 2026-10-27-r2 |     37971 | 4089884 | `9b13e43bc017fb7a2e73b7e0159625610d32f52173d0d766fbc0ce879584d238` |
| character/deepseek   | 2026-10-27-r2 |     57979 | 4179544 | `42cf4de8d70b9f2301342afe7979144a5bcf2568c4ed03a3f2578189cab26132` |

Sink is one static mesh/primitive/material, three embedded images; it does not have the legacy door/drawer nodes. Explicit revision rules retain r1/style-r1 rollback and40k/8MiB/one-material ceilings. Self-contained contract tests cover missing required nodes, revision mislabeling and all budgets. These are structural validations, not a cryptographic revision registry; legacy-compatible unknown revisions still use legacy node rules.

Character original876182triangles/25parts/61,272,732bytes is preserved at `office/character/deepseek/source/新角色_20261027.glb`, SHA `5bf18b3bb8350f2f1ad6d58387d9eea230779831423a0c20291a361f6a5bc7bb`. New packed project `character/deepseek/lookdev/2026-10-27-character-r2/鲸鱼娘_新角色r2.blend`. All25parts retained, UV-seam welding checked per loop, reduced to57979triangles, one draw primitive/material. No broad recoloring; original deep-blue/face/white apron identity retained.2048 base color JPEG95,1024 normal/MR.0.3 normal,0metallic,roughness0.541–0.698, no coat. Optional standard specular extension only, no external decoders.

Initial collapse warning reproduced as71duplicate faces; revised pipeline preserves tiny components and exports with no warning and no mesh validation repairs. Frozen GLB independently imported in official Blender5.2.3 LTS/Cycles CPU;34checks, front/back/detail/feet renders. Feet center, height1.50m, +Zfront. Static: no rig/skin/arm/tail animation.87zero-area UV triangles inherited from source, reconstruction defects and painted shading remain; measured source-to-low sampling max7.1244mm is not an exhaustive Hausdorff bound. See component geometry-revision/validation evidence.

Actual adopted furniture GLBs independently loaded in Blender at runtime positions: BVH reports only41intentional wall miter contacts, no other surface intersections. Character paths use the clear lane left of the table, with shared runtime/test waypoint and turning rules. Search faces toward fridge from a presentation station; not certified reach or door manipulation. 252 routes and25,064poses at60FPS/30FPS/delta.06, including spawn and full idle bob. Arbitrary mid-route activity interruptions, actor collisions and reduced-motion teleports were not covered. Detailed frame-step coverage in `sync/evidence/2026-10-27-centered-layout/office-centered-routes.json`; no general navigation or actor-to-actor avoidance claim.

Actual checks: `pnpm run test` (79passed, includes full build), `pnpm run typecheck`, `pnpm run lint`, root `pnpm run check:workspace`, `pnpm run check:patches`. Existing YAML `!!js` warning remains. Browser http://127.0.0.1:3088/ with DSH_HOME=~/.dsh-test:5idle kitchens, focused room, two-character cooking/waiting preview, searching, last room/offscreen and returned rebuilt canvas,0scene alerts. Console warning/error counts recorded in browser evidence. No real Session activated, messages or model requests. OS reduced-motion was not manually toggled; lifecycle regression passes.

18embeddedGLBs 34,564,548bytes (32.96MiB), uncompressed Client 47,583,876bytes. Only sink/character GLB+manifest bytes changed;16other assets unchanged. Lighting/CSS/actions unchanged; runtime placement and turning policy changed. Tests use actual transformed triangles and furniture boxes; furniture test is separate exact BVH. No Harness source/production profile edits, commit/push/publish. Test profile symlink uses release package build and service remains running.

Library root docs, catalog, component handoffs and accepted receipts synchronized; complete layout/hash record `sync/receipts/kitchen-layout-2026-10-27-centered-v1.json`. All authoring stays under `office/<scene>/<component>` or `office/character/<id>`.

[Updated kitchen](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-centered-overview.png)
[New whale girls](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-centered-preview.png)
