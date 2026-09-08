# Electron desktop plugin manager

Personal use for the author and friends; not an ongoing product commitment.

## Scope and decisions

The initial plugin proposal was replaced by the user's request for a pure Electron
implementation. Everything stays in `scripts/desktop-packager/`; no package is
added and no DSH tracked source is edited.

- Preserve the native management renderer, preload, menu and Cmd+, entry.
  Add a top-level Extension menu and a separate window at
  `dsh-app://shell/clutch-extension/plugin-manager.html`, with its own preload.
  This supersedes the original renderer replacement to avoid native UI conflicts.
- Compile checked temporary overlays of Desktop main and project-manager.
- Expose a narrow IPC bridge only to the owned extension page's main frame.
- Reuse native profile transactions, private pnpm, health checks and rollback.
- Read the removal inventory from the active profile, without a redundant
  dependency reinstall. Preserve local specs during migration and protect core names.
- Snapshot built directories with pnpm pack (no lifecycle scripts) or validate
  .tgz files; retain content-addressed archives outside the replaced profile.
  Publish archives atomically and verify/repair existing snapshots on reinstall.
- Serialize plugin mutations and manual Host restarts. The Electron shell remains
  alive, while the primary renderer reloads after successful activation.
- No changes to native application auto-update coordination in this experiment.

## Package build performance

Use the upstream release packer's bounded worker pool for both dsh and vendor
families, with four workers by default. `DSH_PACK_CONCURRENCY=1` restores serial
packing; reject invalid values before fetching DSH source or building. Report
each family's elapsed time. Keep build, payload and offline seed checks and
regenerate every archive so local source edits cannot reuse stale packages.
Build native modules from the selected checkout's `native/landlock-run` or
`native/system` layout and pack its `packages/entry`. Keep upstream's
`packed/landlock` output path, clearing it before packing.

Pin unattended GitHub builds to DSH commit
`016af7c67bd6eb9ca4af214dd82e6a5b8fddcfdb` by default. It keeps DSH and Desktop
at `0.1.3-alpha.2` with Electron 44, Node 24.17.0 and pnpm 11.7.0, and passes the
real Electron smoke flow. Continue accepting `DSH_SOURCE_REF` for explicit upgrades.

Stage an existing installed app on the installation volume while switching the new
candidate. Restore it if the switch fails; after success, move it to the current
user's Trash with a collision-safe name so repeated upgrades remain unattended.
Compare serial and parallel archive entries, file bytes, manifest values and
publish order on the same built checkout. Ignore only dependency-map key order
in `package.json`, which pnpm can change while resolving workspace versions;
all other manifest ordering and archive metadata must match.

## Verification

Use real pnpm with small synthetic core packages in isolated temporary profiles.
Cover install/remove, local source deletion, upgrade, rejected health checks,
activation rollback, untrusted IPC, queue recovery, invalid archives and overlay
structure drift. Build against the current local DSH source. Browser preview uses
mock data and checks renderer behavior separately from actual Electron runtime.

The opt-in `electron-smoke.mjs` runs the actual compiled shell, preload and Host
with temporary DSH_HOME/userData, checking runtime PID changes while windows and
the Electron PID survive, plus local install/remove. Regression tests also cover
uninstalling a plugin whose snapshot disappeared and repairing incomplete copies.

A full signed App build, startup and model conversation remain distinct release
verification steps; do not claim them from preview or isolated transaction tests.
