# Isometric camera and larger scene panels

Date: 2026-10-27. Worktree: `wt-office-0.1.0/release`, uncommitted integration.

Camera remains orthographic. The eye is `[8,9.15,8]`, looking at `[0,1.15,0]`:
equal relative offsets of `[8,8,8]`, 45-degree azimuth and 35.264-degree elevation.
A Three.js projection check measured identical X/Y/Z unit segment lengths
(`0.2041241452319315` each under a square test frustum). Viewport aspect is applied
to the horizontal frustum to preserve equal physical pixel scale.

Page padding is smaller and card width grows from 1000px to 1200px. Overview scenes
grow from 340px to responsive 440–660px; focused scenes grow from 520px to
responsive 520–800px. Mobile scenes use 350–480px. The camera targets y=1.15 and
fits both horizontal and vertical room extents, retaining upper/lower room content.

Build, typecheck, ESLint, Prettier and diff checks passed. A projection check of the
complete room envelope fits at 1200x800, 900x660, 600x520 and 340x350. Real
`DSH_HOME=/Users/yuancheng/.dsh-test`, `http://127.0.0.1:3088/`, was cold-loaded;
the focused room displayed the full kitchen and no horizontal page overflow.
The current 768px browser measured a 673x520 focused canvas. Fresh-tab console
warnings/errors: zero. Screenshot: [office-isometric-view.png](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-isometric-view.png).

This pass changes the camera and webpage sizing only. No geometry, asset delivery,
DSH source, native Session, production profile, commit, push or publication change.

## Confirmed room proportions

The user clarified that the overall room edges should be equal as well. The
current shell is 5.5 m wide/deep/high (platform including border is 5.7x5.7 m).
The left-wall scene instance scales locally by [5.5/4.4,5.5/2.9,1]; its immutable
GLB is unchanged. Furniture, characters and their activity routes keep original
dimensions. The floor extends forward and the pendant root follows wall-top
height. This is an explicit user-approved shell sizing override, not a new asset
delivery or a stretched camera projection.

Camera target is now [0,2.62,0.5], eye [8,10.62,8.5]; equal relative [8,8,8]
continues to project equal unit lengths. The frustum fits the full new envelope at
1200x800, 900x660, 673x520 and 340x350. Overview panels are now 540–820px,
focused panels 680–1000px, mobile panels 480–660px so the taller shell stays large.
Build and all 27 tests passed; typecheck/lint and manual geometry/projection checks
passed. Actual focused-room screenshot and cold-load console were checked in
`~/.dsh-test` after the shell adjustment. Previous dimensions above are historical.
Final in-app check showed the complete cube and original-size furniture; the
reloaded tab retained one duplicate-Three.js warning after rebuilding, with no
errors or visible fallback. Screenshot was refreshed for the current shell.

## Room height adjustment, 2026-10-27

User requested 3/4 of the current wall height: 5.5 m becomes 4.125 m.
Width/depth remain 5.5 m; original furniture/character sizes are unchanged.
The pendant follows wall-top height (root offset 1.225 m above the delivery).
Camera remains isometric orthographic, targets the revised shell center and uses
a 4.4 m vertical half-frustum minimum. Earlier cube dimensions are historical.

## Final room size

User replaced the proportional-height request with explicit 5 x 5 x 3.5 m.
The shell now follows those dimensions. Furniture retains its original scale,
with boundary units moved inward 0.25 m and actor stations adjusted for clearance.
Camera keeps equal-axis orthographic projection and fits the new shell.
Earlier dimension values above are historical.

## Softer reference camera, 2026-10-27

User approved lowering elevation from 35.264 degrees to 30 degrees. The camera
remains orthographic with symmetric 45-degree azimuth. Its horizontal offsets
are [8,8] and vertical offset is hypot(8,8) * tan(30 degrees). X/Z projected
scales remain equal; Y no longer shares that foreshortening. The room remains
5 x 5 x 3.5 m, with the same furniture layout and larger webpage scene panels.
This supersedes the earlier strict-isometric requirement.
