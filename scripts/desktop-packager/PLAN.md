# Electron desktop plugin manager

Personal use for the author and friends; not an ongoing product commitment.

## Scope and decisions

The initial plugin proposal was replaced by the user's request for a pure Electron
implementation. Everything stays in `scripts/desktop-packager/`; no package is
added and no DSH tracked source is edited.

- Replace the generated application's existing management renderer at
  `dsh-app://shell/plugin-manager.html`; retain the menu and Cmd+, entry.
- Compile checked temporary overlays of Desktop main and project-manager.
- Expose a narrow IPC bridge only to the owned shell main frame.
- Reuse native profile transactions, private pnpm, health checks and rollback.
- Read the removal inventory from the active profile, without a redundant
  dependency reinstall. Preserve local specs during migration and protect core names.
- Snapshot built directories with pnpm pack (no lifecycle scripts) or validate
  .tgz files; retain content-addressed archives outside the replaced profile.
  Publish archives atomically and verify/repair existing snapshots on reinstall.
- Serialize plugin mutations and manual Host restarts. The Electron shell remains
  alive, while the primary renderer reloads after successful activation.
- No changes to native application auto-update coordination in this experiment.

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
