# Trash surface recheck · 2026-10-31

The user clarified that the remaining complaint concerns diagonal bands/faceted
patches on the **body**, viewed in the currently open DSH desktop application.
Lid/handle reconstruction imperfections are a different issue.

## Actual integration check

The desktop profile's `node_modules/@cerbur/clutch-dsh-office` is already a symlink
to this release worktree. The earlier assumption that this profile did not use
the local work was incorrect. No profile installation or configuration change
was necessary or performed.

The on-disk compiled shader has patch ID `kitchen-area-shell-practicals-v8`.
Its SHA-256 is `058ce2f24f25b003b08539006203c6f6fefa1d9b2a3329a011beb222102aa79e`.
This verifies the disk artifact, not the JavaScript previously held in a renderer.

Opened Office in the actual desktop app and waited for the GLBs to replace their
loading placeholders. Inspected zero actors and the built-in four-actor local
preview. The previously reported broad diagonal bands on the bin body did not
reproduce in those views. Captured the settled four-actor view:

[Actual DSH four-actor view](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/docs/reports/2026-10-31-trash-dsh-recheck.png)

The local production-runtime fixture was also checked at 5× zoom with shadows
enabled/disabled. The old scan's vertical dents and irregular lid/handle boundaries
remain; those are not the diagonal shadow bands identified by the user. An original
unoptimized GLB diagnostic showed those geometry imperfections too.

We cannot establish retrospectively whether the user's previous scene had an old
in-memory module or another transient state. Do not claim that cache staleness was
proven, nor that arbitrary magnification is artifact-free.

## Scope and verification

No additional production geometry, material, light, pixel-budget, or shader change
was adopted in this recheck. A separate geometry candidate made before the user's
clarification remains unadopted in the Blender library's trash-can work directory;
it is not a delivery, is not selected by the plugin, and does not alter bake hashes.
The temporary original-model diagnostic injection was removed.

`node --test test/area-shadow.test.mjs test/render-budget.test.mjs test/static-frame.test.mjs`
passed all 25 tests. This recheck does not claim a new desktop FPS measurement;
the unchanged full-resolution cache's three 30-second measurements remain in
[the performance report](FULL-RESOLUTION-30FPS-2026-10-31.md).

All changes remain local; no commit, push, publish, installation or frozen delivery
modification was performed. The desktop local preview was exited after inspection.
