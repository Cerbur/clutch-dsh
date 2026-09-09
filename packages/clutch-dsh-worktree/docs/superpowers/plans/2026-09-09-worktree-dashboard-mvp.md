# Worktree dashboard MVP

The dashboard is a plugin-only addition requested for
`wt-worktree-0.1.10/feat-shorten-worktree-name`. It amends the original plan's
non-goal of replacing the Session page: replacement is temporary browser
presentation, with no DSH source or persisted Session changes.

## Scope and composition

- Add Dashboard to managed active and archived Worktree menus; Local stays unchanged.
- Reuse `shell.overlay` to cover the area beside the Sidebar. Keep the native
  conversation mounted and temporarily hide/inert its columns, restoring them on
  close, Session navigation, mode exit, anchor loss, and disposal. Missing layout
  anchors mean zero coverage. Do not replace the occupied `conversation` slot.
- Keep only the selected Workspace/Worktree identity in memory. Resolve the name
  (accepted branch), cwd, current branch, and health from the existing ready
  Worktree projection; targeted refreshes retain the current dashboard.
- Copy the exact absolute cwd with explicit success/failure feedback.
- Implement Dashboard, Git & Changes, Sessions, Children, and Settings tabs with
  keyboard navigation. The reference image informs the two-column card layout.
- Clearly label unconnected actions and data as coming soon. Do not invent clean
  Git status, ahead/behind counts, instructions, children, or running Sessions.
- No Host/Provider/Remote/sidecar changes, new dependencies, version bump, commit,
  publish, or changes to the DSH source checkout.

## Verification

Validate the selected identity and presentation lifecycle, clipboard success and
failure, tab switching, active/archived menu entry, resize, keyboard access, and
return to the original Session. Run package typecheck, lint, build, tests and
workspace/patch checks. Inspect the rendered dashboard and document its MVP
limits in both public READMEs and the Client README.

## Implementation and verification evidence

- Implemented only in this package's Client, tests, and documentation. DSH source,
  Host/Provider/Remote contracts, package metadata and release version are unchanged.
- `pnpm build`, `pnpm typecheck`, and `pnpm lint`: passed.
- `pnpm test`: 547 passed, 0 failed or skipped. Seven new handler/presentation
  regressions cover identity, refreshed facts, navigation, both locales, tabs,
  clipboard boolean failure/rejection/stale results, geometry and restoration.
- Workspace shape and Cordis patch validation passed; `git diff --check` passed.
- A temporary DSH_HOME at `/tmp/clutch-worktree-dashboard-qa` loads the built
  plugin using the unmodified local upstream source. A separate static fixture
  at `/tmp/clutch-dashboard-preview` bundles the real `WorktreeSurface` with
  synthetic data for visual review without a DSH connection.
- Browser verification is pending explicit user authorization: automatic approval
  rejected the temporary DSH token login and then access to the static fixture's
  local origin. No browser screenshot or visual pass is claimed. Public screenshot
  updates should follow authorized visual verification.
- No feature commit, version bump, release merge, pack, publish, or push was performed.

