# Whale-girl stepping turns · 2026-11-07

Turning increment on `wt-office/feat-whale-girl-optimize-lint`, after `ee27fab`.
The user requested a turning action for the current character, then explicitly
authorized scoped commits and deployment to `~/.dsh-test` for visual review.
Push, merge, publication, version changes and production-profile deployment remain
outside this task.

## Behavior

The character now takes small alternating steps while changing direction. The head
and chest turn slightly ahead of the body, with a small opposing tail movement.
Left and right turns blend into walking and back to standing; blinking remains
independent. Reduced motion and hidden-scene pause restore the neutral pose.

The runtime calculates the signed shortest-arc yaw change divided by the actual
frame delta. Zero-time resume frames produce no angular speed. Both native shared
kitchen roaming and the retained station-route presentation feed the same fifth,
optional `CharacterAnimation.update` argument (radians/second). Session state is
not an animation trigger and the route/heading scheduler is unchanged.

`Turn_Steps` is an actor-local mixer action reusing the normalized `Walk_InPlace`
keyframe arrays, with a maximum weight of 0.45. It starts half a cycle apart for
opposite directions and scales its cadence from actual angular speed. It fades
over 0.16 seconds and yields to walking/search actions. This is a small in-place
step blend, not a new hand-authored Blender clip or foot-locked pivot IK; slight
sole sliding while the root rotates is still possible.

The additive pose offsets are head +0.13 rad, chest +0.06 rad and tail -0.08 rad,
scaled by signed turn intensity. Axes are derived from the bind pose in character
space. The previous offsets are restored before each mixer update so repeated or
interrupted turns cannot accumulate twist. Support probes still use only each
primitive's referenced vertices; stable idle stops skin probing after the turn
fade. Skeletons, morphs, actions, anticipation state and blink timers are per actor.

## Asset and scope

The source GLB/manifest remains `2026-10-29-face-blink-r2`, SHA-256
`eea3bc03f99ea735948a8e33c108b3ae5eb2bbb860651d4bc217421a604bc003`,
7,172,924 bytes / 57,002 triangles / 3 materials / 4 images / 31 joints / 4 morphs.
No new source revision/import/rebake is needed: this change only composes runtime
animation on the existing rig. Frozen art, PBR soft fill, all kitchen models,
layout, camera, lighting and native Session semantics stay unchanged. The original
kitchen reference image and art direction were reviewed before implementation.

There is one extra mixer action per actor, sharing its immutable gait tracks with
the existing walk action. Additional active-turn CPU work has not been benchmarked;
the earlier optimization's timing report does not certify turning performance.
No new geometry, material, texture or rendering pass was added.

## Review fixture

From the Office package:

```bash
node scripts/preview.mjs --character-turn
pnpm exec tsc -p test/tsconfig.character-turn.json
```

`http://127.0.0.1:4188/` offers left/right 90° turns, a 180° turn, in-place walking
for transition review, and a local reduced-motion simulation. The fixture uses the
actual character loader, animation and kitchen light rig with a separate close-up
camera and no kitchen geometry; it does not change the production camera or model.
The save button writes `office-turn-review.png` in the local fixture server's system
temporary directory. This run copied the capture to `/tmp/office-turn-review.png`.
`node scripts/performance-preview.mjs` separately checks the complete kitchen at
`http://127.0.0.1:4191/`. Neither fixture reads or writes real Sessions/profiles.

## Verification

- Character/ownership/runtime tests initially passed 27/27, including left/right
  skeletal stepping, independent blinking, zero-delta/angle-wrap handling,
  turn-to-walk, reduced motion, pause and 40 repeated direction changes without
  accumulated pose error.
- Actual animated station routes passed 631 sampled poses (0.15-second sampling),
  including fridge travel, return, turning, reverse retreat and interruption.
  Tests pass the actual angular velocity to the production animation controller.
- Shared-kitchen clearance passed 168 sampled placements/orientations with live
  alternating left/right skeletal turn poses at the six roaming points and aisle
  intermediates. Sole height and actual mesh/furniture intersection checks pass.
  These are sampled checks, not continuous all-pairs character collision or IK.
- The new close-up fixture was independently typechecked using the client config.
- In-app browser checks of close-up turning, 180° turn, reduced-motion simulation,
  and walking/standing transitions passed. The complete kitchen rendered four
  simulated characters; hiding removed the canvas and showing recreated one canvas
  with zero alerts. Both preview tabs had no captured warnings or errors.

Final commands and results on the feature worktree:

- `pnpm --filter @cerbur/clutch-dsh-office lint`: passed.
- `pnpm --filter @cerbur/clutch-dsh-office typecheck`: passed.
- `pnpm --filter @cerbur/clutch-dsh-office build`: passed.
- `pnpm exec tsc -p test/tsconfig.character-turn.json`: passed.
- `node --test --test-concurrency=1 test/*.test.mjs`: 358 tests, 354 passed,
  zero failed, four optional library checks skipped; 302.6 seconds.
- `OFFICE_ASSET_LIBRARY=/Users/yuancheng/Documents/blender/office node --test test/left-decor.test.mjs test/floor-mat.test.mjs`:
  all 12 passed, zero skipped, including the four library checks above.
- `pnpm run check:workspace` and `pnpm run check:patches`: passed, with the existing
  `!!js` YAML warning retained.
- `git diff --check`: passed.

Test logs and captures are local review evidence under `/tmp/office-turn-*`, not
tracked deliverables. Browser reduced motion was simulated in the fixture; the OS
preference was not manually toggled. These implementation checks preceded profile
deployment. Visual approval remains with the user.

The first standalone fixture typecheck exposed input element narrowing in callbacks;
explicit `HTMLInputElement` guards fixed it, without type assertions or disabled
rules. The final fixture check uses the real client TypeScript configuration.

## Authorized test-profile deployment · 2026-11-07

Implementation commit: `897090e` (`feat(office): add blended skeletal stepping turns`).
After explicit user authorization, lint, typecheck and build passed again, and
the standard DSH local-source installation linked this feature package into
`DSH_HOME=/Users/yuancheng/.dsh-test`, profile `web`. Only the Office dependency
changed in the profile manifest; other manifest fields remained identical. The
previous profile manifest, lockfile and workspace config were backed up under
`/tmp/office-turn-deploy-backup/`.

Commands from the read-only Harness checkout:

```bash
DSH_HOME=/Users/yuancheng/.dsh-test pnpm dsh plugin --profile web add /Users/yuancheng/Documents/Code/clutch-dsh/packages/clutch-dsh-office/.agents/clutch-worktrees/wt_bfb4549f9787/packages/clutch-dsh-office
DSH_HOME=/Users/yuancheng/.dsh-test pnpm dsh web --port 3088 --no-open
```

Installation passed with pnpm's linked-package peer-dependency warning. Actual
browser loading succeeded at `http://127.0.0.1:3088/`: Office opened, the version
tag's local preview rendered four roaming characters, one canvas and zero alerts;
captured browser warning/error logs were empty. The page remains in simulated
four-character preview for review, without creating or running native Sessions.
An existing Worktree plugin notification about an unavailable old directory was
observed separately and was not changed by this deployment.

Deployed `lib/client.js` SHA-256:
`913d698a56d6521aa60e6ea12bdf97b0f6d92475d2c6f903b769b56bc3955af4`.
Local evidence: `/tmp/office-turn-dsh-test.png`,
`/tmp/office-turn-deploy-install.log`, `/tmp/office-turn-deploy-build.log`.
Harness source remained clean; no production profile, version, push, merge or
publication changes were made. Final visual approval remains pending.
