# Verification · kitchen optimization r3

Worktree: `wt-office-0.1.0/release`, working-tree changes; no commit or deployment.
Production selection: `2026-10-31-meshopt-soft-r3`, medium. Lighting:
`2026-10-31-meshopt-shell-r56` (actual Cycles r55 + OIDN).

## Actual checks

- Generated and validated all 84 high/medium/low GLBs. Both pre-compression geometry
  and final containers report zero validator errors. Three's bundled decoder
  additionally loads every production derivative; the validator itself cannot
  decode Meshopt and reports that limitation as informational output.
- Independent Blender import of all 28 medium components: 341,383 triangles,
  zero invalid normals, zero nonfinite positions, zero zero-area triangles.
  Editable component `.blend` files and a JSON import report are retained in the
  source library. Exact duplicate regression failed against the earlier stove
  candidate, then passed for r3. The table retries at 0.0005 to protect thin sides.
- Final full test set ran in two disjoint groups while baking: **274 + 58 = 332
  passed, zero failed/skipped**. `OFFICE_ASSET_LIBRARY` was set for library tests.
  The first group includes actual optimized furniture triangle collision checks,
  skeletal movement, source imports, transport and lifecycle. The second validates
  the final atlas/source pairing, pane masks, decor provenance and resource budgets.
- `npm run build`, `npm run typecheck`, `npm run lint` passed. Additional ESLint
  covers the new optimizer/adoption/comparison scripts and comparison fixture.
- `node scripts/check-workspace.mjs`, `node scripts/validate-cordis-patches.mjs`
  and `git diff --check` passed. The existing `!!js` YAML warning remains.
- Actual production asset handler served all **31** indexed resources,
  **58,337,848 bytes**, with matching SHA-256. This checks handler/file integration;
  it is not a claim of a new DSH-profile installation or network benchmark.
- `npm pack --dry-run --json --ignore-scripts` lists 29 GLBs: 28 optimized kitchen
  assets plus the unchanged character, and no unused original kitchen GLBs. No
  tarball was published or created by the dry run. The Client remains below 3 MiB;
  decoded bake remains 16 MiB and UV data 20,832 bytes.

## Browser and visual evidence

Local Office fixture: `http://127.0.0.1:4188`; quality review:
`http://127.0.0.1:4189`. These are standalone local previews, not native Sessions.
Fixed-camera overview/window/hood/platform-edge views were reviewed. The window
no longer has the old pink lower-rail band, the hood uses a broad soft slate
coating, and the wooden rim no longer samples the broken diffuse seam. Existing
small texture/reconstruction artifacts are not represented as rebuilt geometry.
Four-character local preview retains the existing character appearance and motion;
the character GLB and renderer implementation were not changed. No console
warnings/errors were observed after successful resource loading.

The comparison tool exposes actual renderer counts, bytes, elapsed load time and
FPS/frame time. These samples are affected by local CPU load and browser scheduling;
no percentage FPS or mobile performance improvement is asserted. The static
geometry workload reduction is independently verified: 543,917 → 399,911 triangles.
[Captured browser samples](reports/2026-10-31-browser-samples.json) include all
four qualities. Rapid high→original switching was also verified to retain the
correct 53.18 MiB original byte count rather than mixing canceled requests.

The README screenshot is the empty final local kitchen, with no simulated native
Session facts. Before/after, closeups, quality/wireframe evidence and raw logs are
retained under `office/sync/evidence/2026-10-31-kitchen-optimization-r3/` in the
Blender library. Final user art approval remains separate from technical checks.

See [parameters and reproduction](MODEL-OPTIMIZATION.md) and
[per-file report](reports/2026-10-31-model-optimization.json).

The first workspace dependency install reached unrelated `clutch-dsh-worktree`
prepare/type errors. No other plugin source was changed. The final lock patch
preserves all pre-task entries and adds only six Office tooling dependencies and
their dependency closure. The full root `check` was not claimed; the actual
Office checks and workspace/patch gates above passed.
