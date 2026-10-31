# Refrigerator walk — 2026-10-28

Table/stools move another0.20m outward: table[1.45,0,1.15],stools[.95,.025,2.03]/[1.98,.025,2.03]. Right-edge X and chair spacing remain. Back-of-table to closed-fridge envelope clearance grows to1.3817m. Other furniture, camera, lighting and18asset GLB/manifest bytes unchanged against pre-task SHA256 snapshot.

Local preview **Find ingredients** now travels around the table to a refrigerator-front station instead of merely turning toward it from the left lane. Motion and runtime use shared kitchen-specific route policy, delta-based translation, turns and whole-body bob. Movement/settled/interrupted/reduced-motion cases are documented in the actual motion audit at `office/sync/evidence/2026-10-28-fridge-walk/office-fridge-walk-routes.json`. Exact final layout, runtime source and policy facts are frozen in `sync/receipts/kitchen-layout-2026-10-28-fridge-walk-v1.json`. No general navigation or actor avoidance claim beyond the audit's tested scope.

The new character remains a static GLB. No articulated feet/arms/tail or animation clips were authored; refrigerator doors remain closed and no grasping/reach animation is claimed. Source art stays in office/character/deepseek and office/kitchen/refrigerator. Searching remains a local preview/future activity-feed extension, not live native tool classification.

Validation: `pnpm run test` (79passed, includes full build), `pnpm run typecheck`, `pnpm run lint`. Automated route tests use actual transformed character triangles versus furniture boxes with the same runtime stepping. Actual ~/.dsh-test cold reload, five idle kitchens, starting preview, movement along the corridor, stop at refrigerator and return to cooking reviewed. Console/scene status in browser.json. No Session activated, message sent or model request issued. Reduced-motion/offscreen manual checks are recorded only if actually performed in the browser evidence; automated checks do not imply manual OS testing.

Native source models/deliveries remain unchanged. This iteration does not reexport Blender art. Library root/scene/component handoffs and catalog layoutReceipt synchronized; previous accepted revisions retained. Plugin-only; no Harness source, production profile or commit/push/publish. Service http://127.0.0.1:3088/ remains running via existing test-profile package symlink.

[Walking to fridge](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-fridge-walk-walking.png)
[Arrived](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-fridge-walk-arrived.png)
