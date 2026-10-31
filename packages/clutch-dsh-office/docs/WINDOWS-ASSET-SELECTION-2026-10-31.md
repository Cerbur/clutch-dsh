# Windows source-build lighting diagnosis

The user reported a large triangular wall-corner shadow and a darker, shinier hood
after pulling this release branch and building on Windows. Work continues in the
existing `wt-office-0.1.0/release`, preserving the prior performance changes.

## Confirmed defect

`runtime-models.mjs` classified native filesystem paths with the literal substring
`/models/kitchen/`. Windows `path.resolve()` returns backslashes, so the selector
returned the original GLB instead of the reviewed `optimized` derivative. That
includes the old hood surface. The r56 bake requires hashes of the reviewed GLBs;
an original source mismatch rejects the room bake and leaves realtime lighting.
This explains both visual symptoms together; the screenshot alone does not establish
that every possible Windows GPU difference has been eliminated.

The newer lossless transport selection in `inline-assets.mjs` had the same separator
assumption and is fixed in this change as well.

## Fix and evidence

- Normalize backslashes to forward slashes before derivative classification, importer
  resolution and plugin module loading. Node accepts forward-slash filesystem paths
  on Windows, including drive and UNC paths; native path joining remains in place.
- Keep source, derivative, transport and runtime bake hash checks intact. Do not disable
  the bake failure guard, change lighting parameters or modify assets to hide this issue.
- `node --test test/windows-assets.test.mjs` failed before the fix: the first test
  returned the original backslash path; the second failed importer/module resolution.
- After the fix, the same pipeline selects the coated derivative and lossless transport,
  preserves bake provenance and still rejects corrupt files. An integration check uses
  backslash spellings against every real bake source hash.
- Validation runs on macOS with Windows-style path inputs. It is not a native Windows
  GPU or driver test. Windows should rebuild the updated source, restart the DSH host,
  and reload the client before comparing the wall corner and hood again.

Executed successfully: `pnpm run build`; `node --test test/windows-assets.test.mjs
test/model-optimization.test.mjs test/inline-bake-assets.test.mjs
test/baked-lighting.test.mjs test/performance-budget.test.mjs` (52 passed, zero
failures/skips); Prettier on the changed files and `git diff --check`.

The historical `cc59bb3` build can therefore render different assets on macOS and
Windows even at the same Git commit. Old bundles must be replaced by a rebuild;
an unchanged version badge is not evidence that the corrected bundle is loaded.
