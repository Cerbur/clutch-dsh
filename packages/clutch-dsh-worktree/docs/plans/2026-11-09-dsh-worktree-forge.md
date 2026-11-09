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

Validation: targeted real-native record, replay and restoration tests; historical-path
regression tests; all package gates; isolated acceptance under `~/.dsh-test`, including
plugin unload and read-only inspection of old data. No release/version changes.

Completed: implementation, full native-enabled package regression (1,419 passed, no skips),
six official Forge recovery scenarios, and real ~/.dsh-test model/UI acceptance.
Existing 676 raw Session/sidecar files retain their hashes; the original test profile is restored.
See [acceptance evidence](../qa/2026-11-09-forge-acceptance.md).
