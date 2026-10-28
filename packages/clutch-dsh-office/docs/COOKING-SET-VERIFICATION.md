# Cooking set acceptance

Date: 2026-10-27. Branch: `wt-office-0.1.0/release`, uncommitted working-tree.

## Adopted deliveries

| Component    | Revision      | Triangles |   Bytes | SHA-256                                                          |
| ------------ | ------------- | --------: | ------: | ---------------------------------------------------------------- |
| stove        | 2026-10-27-r1 |    35,214 | 974,580 | 59807639189de884d88993e32a7796b0615df6ce886ec7eeb288caac557a62a3 |
| wall-cabinet | 2026-10-27-r1 |     2,472 | 140,148 | 21d0494b9652143451321dffb6112ed2485844275be47cd54682b2dd0041215a |
| range-hood   | 2026-10-27-r2 |    11,012 | 392,160 | a87ffc1064b7897f4e01271bda30185808380325218c811231821767d77eaf5f |

The mandatory main reference was opened. Separate importer rules preserve each
component's origin, filename, budgets and required nodes. Refrigerator retains
its 30k / 8 MiB rule and adopted r2 bytes. All other adopted components remain.

## Metric placement

All three instances use unit scale and Y +90 degrees, facing into the room from
the left wall. Layout source of truth remains `src/office/kitchen-layout.ts`.

| Component    | Position x,y,z (m)      | Contract                                             |
| ------------ | ----------------------- | ---------------------------------------------------- |
| stove        | -1.93, 0, 0.15          | Cabinet floor center, 0.90 m worktop                 |
| wall-cabinet | -2.188, 1.70, -1.05     | Cabinet-bottom center, top at 2.75 m                 |
| range-hood   | -2.088, 0, 0.2865143657 | Floor projection, modeled installation 1.725–2.760 m |

Hood lateral center matches burner_left; no installation-height offset is added.
Its bottom clears the 0.90 m worktop by 0.825 m. Cabinet/hood lateral bounds have
0.2815 m clearance; mounted backs have a 2 mm standoff from the inner wall.
Stove back clears the wall by 13.9 mm; storage cabinet is 147.8 mm beyond its end.
The shorter delivered stove is not stretched to the previous 2.55 m whitebox.
The rear shelf is shortened/repositioned clear of the new cupboard; its old blue
box is removed. Old stove/pans disappear after successful asynchronous loading.

Original PBR and COLOR_0 are retained, including stove colors and r2 whale badge.
The new components use the common owned-resource loader, failure placeholders,
late-arrival disposal and redraw invalidation. Doors remain closed, flames and
hood static. No new interaction or animation is claimed.

## Actual verification

- Explicit `syncAsset` calls on all three immutable manifests verified hashes,
  counts, semantic nodes, bounds and anchors before adopting files.
- `pnpm --filter @cerbur/clutch-dsh-office test`: build + 31 tests passed.
  Coverage includes independent import/preserved refrigerator, original scale,
  actual vertex-color materials, installed hood height and burner alignment,
  furniture bounds and posed actor station-transition sweeps.
- `pnpm --filter @cerbur/clutch-dsh-office typecheck` and `lint` passed.
- `pnpm run check:workspace` and `check:patches` passed; patch validation retains
  the existing `!!js` YAML warning. Prettier and `git diff --check` passed.
- Test service started with `DSH_HOME=/Users/yuancheng/.dsh-test pnpm dsh web
--port 3088 --no-open`. Listener environment and installed profile link to this
  package were confirmed. URL: http://127.0.0.1:3088/ .
- Real authenticated cold page showed five kitchens, zero live actors; overview
  and focused kitchen show all new GLBs, original cupboard texture and colored
  whale badge. No duplicate stove or blue placeholder remained.
- Local preview displayed two characters; cooking/waiting and searching/cooking
  stations were viewed. No visible furniture intersection. Static character has
  no articulated cooking reach; this pass does not claim hand-to-pan animation.
- Scrolled to list end and back: one mounted canvas at list end and one on
  return; all three new models reappeared. Zero alerts, zero captured console
  warnings/errors. Reduced motion was false in this browser; it was not manually
  toggled this pass. Existing redraw/disposal regression tests passed.

Evidence: [whole kitchen](../assets/screenshots/office-cooking-set.png),
[two characters](../assets/screenshots/office-cooking-set-preview.png),
[search transition](../assets/screenshots/office-cooking-set-search.png).
Matching evidence and component-specific receipts are in the Blender library's
`sync/evidence/2026-10-27-cooking-set/` and `sync/receipts/`.

## Limits and boundaries

Eleven embedded GLBs total 15,674,348 bytes (14.95 MiB). Uncompressed Client bundle
is 22,369,619 bytes (22.37 MB); supported plugin-owned asset transport is deferred.
Stove door interiors and character rig are incomplete. Hood/cabinet use inferred
hidden structure. Room remains 5 x 5 x 3.5 m with 30-degree orthographic elevation.
Floor/right wall and rear shelf remain procedural; no window/stools were added.

Plugin-only: no DeepSeek Harness source or production profile changes, no native
Session run/stop, no frozen delivery edits, no commit/push/publish. Test service and
reviewed tab are left open. Library accepted status refers to this working-tree.
