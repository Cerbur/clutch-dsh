# First Blender refrigerator acceptance

Date: 2026-10-27. Scope: `kitchen/refrigerator`, revision `2026-10-27-r1`.

The delivery SHA-256 is
`fb8913832c7b433a06b65f3cd76664679b051ad74049c9734cfd8dcb627d4c32`.
The package's GLB is byte-identical to that delivery: 25,974 triangles, 6 meshes,
13 materials and 9 embedded images, 4,180,048 bytes. The independent Blender
import/door checks were performed during art preparation; this integration also
checks the exported container and preserves the existing named pivots.

## Actual checks

From the `wt-office-0.1.0/release` worktree:

```bash
node packages/clutch-dsh-office/scripts/sync-asset.mjs /Users/yuancheng/Documents/blender/office/kitchen/refrigerator/deliveries/2026-10-27-r1/manifest.json
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office typecheck
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office test
./node_modules/.bin/eslint packages/clutch-dsh-office/src packages/clutch-dsh-office/test packages/clutch-dsh-office/scripts
node scripts/check-workspace.mjs
node scripts/validate-cordis-patches.mjs
git diff --check
```

Typecheck/build and all 15 tests passed. The added tests cover delivery identity,
hash mismatch preserving the previously adopted file, shared GLB resources being
released once, and late asynchronous GLB completion after scene disposal. Lint
and both workspace guards passed; the patch guard retains its existing `!!js`
YAML warning. Prettier checked the touched source/docs/scripts; the one reported
test formatting issue was fixed and rechecked.

## Real DSH test profile

The existing profile already linked this release package. Confirmed that the
server on port 3088 had `DSH_HOME=/Users/yuancheng/.dsh-test` before stopping
only that process, then started:

```bash
/Users/yuancheng/.dsh-test/start.sh 3088
```

The startup helper's printed tag/plugin list is old informational text; the
actual UI reports DSH `0.2.1-rc.2-687f282`, and the profile manifest includes Office.
The server is left running at `http://127.0.0.1:3088/`. No login token is recorded
in the handoff. Existing user sessions were not run or stopped.

Playwright verified on that real profile:

- Five native workspace kitchens remain in a vertical list, all idle with no actors.
- Both overview and focused room display the Blender refrigerator, with the
  whale/sticker, top plant and pink side planter visibly loaded.
- Existing refrigerator placement and orientation are retained, with no auto
  normalization against the plant's height and no changes to action stations.
- With reduced motion enabled, the asynchronous asset still becomes visible.
- Scrolling to the last room and back renders the asset again; five room records,
  two visible canvases at the list's end and zero alert elements were observed.
- The final cold-loaded page's warning/error log contains zero entries.

Rebuilding while the page was open produced a transient duplicate Three.js
instance warning through DSH HMR, and the active Office panel was reset. A cold
reload cleared it; final acceptance uses that clean load.

Screenshot: [real test profile with Blender refrigerator](../assets/screenshots/office-fridge.png).
The library receipt is at
`/Users/yuancheng/Documents/blender/office/sync/receipts/kitchen-refrigerator-2026-10-27-r1.json`.

The integration remains an uncommitted working-tree change on the release
worktree, preserving the earlier six-model split changes. No commit, pack,
publish, production-profile update, or DeepSeek Harness source change was made.
The result accepts this art revision for current integration, not as final art.
The Client bundle is about 7.03 MB uncompressed including the embedded GLB;
scaling the asset catalog will require a later asset-transport improvement.
