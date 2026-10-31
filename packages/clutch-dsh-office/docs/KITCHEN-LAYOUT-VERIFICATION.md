# Kitchen reference layout verification

Date: 2026-10-27. Package: `@cerbur/clutch-dsh-office`.
Worktree: `/Users/yuancheng/.dsh/clutch-dsh-worktree/worktree/wt_29c81af66e9e`.
Branch: `wt-office-0.1.0/release`. Integration remains an uncommitted working tree.

The Kitchen library has seven delivered component IDs. All are now composed:
left-wall r1, table r1, storage-cabinet r1, sink-cabinet r1, pendant-light r1,
refrigerator r2 and the new utensil-rail r1. DeepSeek r1 remains the character.
Floor, right wall and stove have no delivered GLB and retain their procedural models.
The mandatory original reference was opened before changes.

## Placement

The existing stove follows the left wall, the sink follows the rear wall, the
refrigerator occupies the right corner, and the table stays in the foreground.
Storage cabinet stays at the stove's front end. All delivered assets keep unit scale.

- Refrigerator: `[2.1,0,-1.65]`; new r2 leaves 65.6 mm beside the sink, stays within
  the rear wall/floor boundary, and preserves both door pivots.
- Utensil rail: `[-0.9,1.72,-2.138]`, no rotation. Wall-plane origin is preserved.
  The rear mounting faces contact the wall. Lowest utensil point is 1.050 m,
  above the worktop and clear of the faucet and actors.
- Pendant: `[1.65,0,-0.7]`, no rotation. An initial position farther right caused
  visual overlap with the refrigerator topper. The final position separates the
  hanging whale from the top whale and foliage in the actual isometric camera.
- Other current positions and all station targets remain in `kitchen-layout.ts`.

## Verification

`pnpm --filter @cerbur/clutch-dsh-office test` rebuilt the Client and passed all
27 tests. Added coverage checks the rail's independent import/origin/budget,
runtime node hierarchy, wall contact, utensil height, sink/refrigerator gap,
pendant clearance, furniture bounds and existing actor transition sweeps.
Typecheck, ESLint, Prettier, workspace/patch guards and `git diff --check` passed.
The patch guard retains its existing `!!js` YAML warning.

The real server was started from the unchanged DSH checkout using
`DSH_HOME=/Users/yuancheng/.dsh-test pnpm dsh web --port 3088 --no-open`.
The authenticated page at `http://127.0.0.1:3088/` showed five kitchens and zero
live actors, focused empty kitchens, complete asset textures, two DeepSeek models
in local preview and cooking/search transitions without visible furniture overlap.
Scrolling to the list end and back recreated kitchens; two canvases were mounted
at the list end and zero alerts were present. No native Session was run or stopped.

A fresh independent authenticated tab reported zero console warnings/errors.
The previously open tab accumulated one duplicate-Three.js warning during HMR;
it is not included in the cold-load result. Reduced motion was not manually
retested in this pass; asynchronous-load/resource regression tests passed.

Evidence: [focused room](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-reference-layout.png),
[two actors](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-reference-preview.png).
The server and reviewed kitchen tab are left open.

## Limits

Refrigerator r2 lacks the reference pink side planter and full interior; its baked
texture seams remain. Rail and refrigerator r2 do not have a new `.blend` source
or a claimed Blender roundtrip. No new animation or general collision system is
introduced. The eight inline GLBs total about 13.5 MiB and produce a 20.36 MB
uncompressed Client bundle. This is a composition of currently available models;
missing reference hood/window/stools are not supplied by this delivery.

Plugin-only. No DSH source, production profile, immutable delivery, commit, push or
publication changes. Library acceptance receipts record revision and hash.
