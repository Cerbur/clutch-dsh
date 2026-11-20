# Native Forge records for new Worktree Sessions

Approved scope: new Sessions only; no historical Session migration. The user authorized
the native `appendPluginRecord` seam for official Forge worktree facts on 2026-11-09.
This is a narrow exception to the older prohibition on direct Session event writes;
headers, messages, permissions and existing history remain DSH-owned and unchanged.

Implementation must publish real checkout identity through the native working-directory
service before synchronous request/created records, under Agent maintenance, and await
the native per-Session durability barrier before admitting task input. Records are
interpreted by the independently installed official Forge plugin after this plugin unloads.
New checkouts use the official default repository-root pool with a plugin-owned subpool;
old paths remain readable and cleanable without relocation. Imported/existing checkouts
outside the configured official pool support labels and Continue in Project, but official
disk restoration remains restricted by DSH. Subdirectory Workspaces retain their native
membership and permissions; official Continue in Project targets the source Git root.

Case 15: the Session header follows the native working directory after forgetting
a checkout and after Continue in Project. Git supplies the checkout's observed
branch through the existing navigation read; sidecar membership still controls management.

Validation: targeted real-native record, replay and restoration tests; historical-path
regression tests; all package gates; isolated acceptance under `~/.dsh-test`, including
plugin unload and read-only inspection of old data. No release/version changes.

Completed: implementation, full native-enabled package regression (1,419 passed, no skips),
six official Forge recovery scenarios, and real ~/.dsh-test model/UI acceptance.
Existing 676 raw Session/sidecar files retain their hashes; the original test profile is restored.
See [acceptance evidence](../qa/2026-11-09-forge-acceptance.md).

## Approved follow-up: independent automatic Forge activation

The user approved enabling the installed official Forge bundle when Worktree loads,
retaining it after Worktree uninstall, testing under ~/.dsh-test, protecting old data,
and committing on this same feature branch. Enable through DSH pluginManager, never
as a child plugin. Persist one first-load attempt per profile so ordinary restarts respect a later manual disable.
Gate new Session creation on the actual independent official runtime, including its
isolated backend; missing/incompatible bundles require manual installation. Preserve
existing read paths and Session records. Validate cold disable/re-enable, uninstall,
native restore/Continue in Project and actual model replies before committing.

## Approved UI follow-up: case 05 only; case 08 upstream-blocked

The user explicitly selected fixing case 05 and documenting case 08 as an upstream
blocker, without an additional compatibility plugin. Case 05 must not reject native
conversation after cwd has left a missing bound checkout. Suppress only the known
unavailable-checkout result during instruction selection; preserve uncertain I/O
errors, mutation gates, historical records and original Session identity.

Case 08 reproduces for officially created Worktrees: sessionSkillCatalog.list calls
workingDirectory.ensure for a live Agent, committing project fallback before Forge's
inbox restoration check. Earlier direct API recovery tests did not include this UI
read. They prove explicit restoration support, not reliable automatic UI recovery.
Do not patch DSH, backfill records, restore cwd by editing history, or promise that
uninstalling Worktree fixes this upstream behavior.

Validation evidence: [case 05/08 UI follow-up](../qa/2026-11-09-forge-05-08.md).

## Local Session branch icon (2026-11-10)

During interactive acceptance the user requested a native-like branch indicator for
Worktree Sessions that return to Local after lifecycle changes. Render only from the
native Session list's `projectionValues.forgeWorktree`, with a localized branch tooltip.
Do not change archive/grouping semantics, infer labels from obsolete bindings, or
migrate historical Sessions. Verify the already-forgotten acceptance Session in the
real Worktree Local list, alongside ordinary Local Sessions without the icon.

Validated in `~/.dsh-test`: the freshly forgotten `acceptance/01-new-20261110`
Session and existing case 02 show localized branch icons under Local; case 08,
whose native cwd returned to the project, has no icon. Managed rows do not duplicate
the marker. Workspace/patch checks, lint, typecheck, build, README parity and the
native-enabled full suite passed (1,443 tests, zero skips/failures). Both review
axes reported no findings. No Session or sidecar writes are introduced by this UI change.

## Case 02 membership follow-up (2026-11-11)

Real UI removal of the archived `demo/case-7` reproduced a native-owned Session moving
to Ungrouped without any native membership mutation. The legacy browser wrapper applied
an undo delta to an already unprojected native snapshot; both affected modules match main.
Rebuild each view additively from the native snapshot instead of subtracting old bindings.
Four new tests failed before the fix and pass afterward, covering scoped/global/per-Session
removal, native ordering and later native adoption alongside virtual-only legacy entries.
No Session migration, native storage write or DSH patch.

Real UI validation in `~/.dsh-test`: reinstalled this feature, loaded the rebuilt Client,
archived and forgot `demo/case-6`. Without reloading after these actions, its existing
Session stayed under Local with the branch icon; switching to native navigation retained
the original `forge-demo-20261109` Workspace instead of Ungrouped. Actual `pwd -P` returned
the retained checkout and the model replied `LIVE_CASE_02_GROUPING_FIXED_OK`.
The test profile is left with Worktree and independent Forge enabled. The reused case 06/07
scratch checkouts are now forgotten, with directories and conversations retained.

All required workspace/patch, lint, typecheck, build and bilingual README gates passed.
`node --test test/client-mode.test.mjs test/navigation-surface.test.mjs`: 35 passed.
Full `pnpm --filter @cerbur/clutch-dsh-worktree test` with `DSH_NATIVE_SOURCE` and
`DSH_SCHEMA_ADAPTER_ANCHOR` pointing to the verified DSH checkout: 1,447 passed, zero
failures/skips. Post-fix UI baseline: 705 of 707 Session/sidecar files byte-identical;
only the intentionally continued case 06 Session and its scratch Workspace sidecar changed.
DSH working tree remains clean.

## Forge contract recheck (2026-11-19)

At upstream `dsh-v0.2.2-rc.5` (`9c2670d3bc`), the official bundle declares
`forge-panel` and a shared `worktree`. The [RC.1 upgrade guide](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/docs/upgrade-guide/v0.2.2-rc.1/archive-worktrees/guide.md)
documents the removal of the isolated `forge-worktree` row. Use the official
bundle's declared loader entry IDs and live module states, not editable patch
IDs or a caller-scoped service proxy. Test the checked-out upstream patch as
well as the old isolated layout. Keep the rc.2 dependency floor and the
existing Forge request/created record contract: Clutch does not claim native
archive-cleanup ownership of an independently managed checkout.

Admission reads are shared only in flight. Replacing the manager invalidates its
outstanding results, not the per-profile first-attempt preference. Archive wins
over new Session creation at the serialized binding boundary, without blocking
binding repair for existing Sessions; Stop during a binding
commit retains the native Session and any committed binding, without sending input.

## Explicit Session creation after a manual disable (2026-11-19)

The user approved enabling Forge without a prompt when the sidebar, Dashboard or an Agent tool explicitly creates a new Worktree Session. The Host may enable only the installed, compatible official bundle. Preserve the one-time first-load attempt and all individual component toggles. Subsequent restarts, list reads and use of existing Sessions leave a manually disabled bundle off. Opening Diff retains its own confirmation.

For each creation entry point, verify that a disabled bundle can be enabled and that the panel and Worktree service must both be live before a native Session is created. A missing or incompatible bundle, an individually disabled component, activation failure or a required restart must leave no new Session. Worktree must never download Forge.
