# Table and storage-cabinet acceptance

Date: 2026-10-27. Release worktree: `wt-office-0.1.0/release`, uncommitted working-tree change.

## Adopted deliveries

| Component       | Revision      | SHA-256                                                            | Triangles | Bytes     | Meshes / materials / images |
| --------------- | ------------- | ------------------------------------------------------------------ | --------- | --------- | --------------------------- |
| table           | 2026-10-27-r1 | `5740b817bd2726805143d073f96d360759d0cffa917655a769c73a314b63649e` | 49,964    | 2,759,688 | 1 / 1 / 3                   |
| storage-cabinet | 2026-10-27-r1 | `ef8c325e5a790539516791a63555485ccec10b25deee6e3c89fec40234fe4a15` | 25,816    | 596,228   | 8 / 1 / 2                   |

Both package copies match their immutable deliveries byte-for-byte. Refrigerator
bytes and its 30k triangle / 8 MiB constraint remain unchanged. Table has a distinct
60k triangle ceiling; cabinet has a distinct 30k ceiling, both 8 MiB. Lower delivery
budgets are respected; they cannot increase the independent importer ceilings.

## Layout and geometry

The mandatory kitchen original was viewed before placement. The cart occupies the
left end of the back-wall counter at `[-2.04,0,-1.6]`, facing +Z. The procedural
counter is now 2.55 m wide at `[-0.15,0,-1.65]`; the refrigerator stays in place.
The table remains `[0.6,0,1.55]`. Both GLBs use unit scale and original floor-center
origins, with no total-height normalization, foliage recentering or second axis conversion.

Actual transformed float32 vertex bounds match the manifests within 0.1 mm. Table
anchors remain in place; all wheel-center pivots are preserved and independently
rotate about local Z without moving the cabinet frame. Anchors/pivots add no pickup
or wheel animation. The native refrigerator door hierarchy is preserved.

Cart decorated-bound clearance: 4.38 cm to the left wall, 9 cm to the shortened
counter, 19 cm to the back wall. Table front-to-floor-edge clearance: 10.16 cm.
Preset stations and spawn points live in `office/kitchen-layout.ts`, applied by
the kitchen composer/actions. Search actors face the refrigerator, keeping tails
away from it. The old search position inside the deeper table has been removed.

The layout test samples actual posed actor bounds along all six-activity transitions
for both seats (1,512 samples) against furniture, with separate wall/floor margins.
An additional manual Node check sampled 2,016 moving-arm/tail positions with zero
furniture intersections. This verifies preset aisle clearance, not general navigation
or an actor-actor collision solver.

## Commands actually run

```bash
node packages/clutch-dsh-office/scripts/sync-asset.mjs /Users/yuancheng/Documents/blender/office/kitchen/table/deliveries/2026-10-27-r1/manifest.json
node packages/clutch-dsh-office/scripts/sync-asset.mjs /Users/yuancheng/Documents/blender/office/kitchen/storage-cabinet/deliveries/2026-10-27-r1/manifest.json
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office typecheck
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office test
./node_modules/.bin/eslint packages/clutch-dsh-office/src packages/clutch-dsh-office/test packages/clutch-dsh-office/scripts
node scripts/check-workspace.mjs
node scripts/validate-cordis-patches.mjs
git diff --check
```

All 21 tests passed, including budgets/coordinates/bounds/anchors, distinct filenames,
original-scale GLTF parsing, independent wheel axes, fallback, late completion and
resource disposal. Tests parse an in-memory geometry-only copy in Node (no image
decoder); real browser validation uses the unmodified GLBs and actual textures.
The final lint and targeted Prettier checks passed. The patch guard retains its
pre-existing `!!js` YAML warning and exits zero.

## Real-profile browser checks

Confirmed the port-3088 process uses `DSH_HOME=/Users/yuancheng/.dsh-test`, and its
profile already links this release package. Rebuilt and cold-reloaded the real
DSH `0.2.1-rc.2-687f282` UI. Server remains running at `http://127.0.0.1:3088/`.
No login token is recorded in the handoff.

- Five native kitchens remain visible, idle with zero actors. Overview and focused
  room show all three Blender assets, correct direction/scale/grounding, table cup,
  food/textures, cabinet bottles/leaves/baskets/wheels and shadows.
- Two-actor activities were exercised using the installed plugin's labeled local
  preview in this real profile, without running or stopping native user sessions.
  Cooking/waiting/searching/editing/resting and normal walking were viewed.
- Reduced-motion asynchronous loading and standing poses were viewed separately.
- Scrolling to the final workspace shows two canvases; the old first canvas becomes
  detached and its WebGL context reports lost. Returning reconstructs the room.
- Final cold-loaded warning/error log has zero entries; no scene alerts. Intermediate
  build HMR produced the known duplicate-Three.js warning; cold load is the baseline.

Screenshot: [installed kitchen](../assets/screenshots/office-kitchen-assets.png).
Full overview/focused/actor/list-end evidence is retained in each component's
`reviews/2026-10-27-r1/office/` directory. Receipts:

- `/Users/yuancheng/Documents/blender/office/sync/receipts/kitchen-table-2026-10-27-r1.json`
- `/Users/yuancheng/Documents/blender/office/sync/receipts/kitchen-storage-cabinet-2026-10-27-r1.json`

Table source AI contact shading/utensil irregularities remain; no stools are included.
Both components are static decorations except their preserved semantic anchors.
The three embedded assets yield an 11.51 MB uncompressed Client bundle. Runtime
asset transport optimization remains follow-up work. No DSH source edits, production
profile changes, frozen-delivery updates, commit, push, pack or publish were performed.
