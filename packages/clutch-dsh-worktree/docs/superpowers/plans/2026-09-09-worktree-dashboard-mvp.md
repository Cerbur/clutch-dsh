# Worktree dashboard MVP

## Instructions and acquisition facts extension

The user extended the scope to shared instruction editing and system-reminder injection,
native open-editor styling, creation time, and base branch. This supersedes the initial
instructions placeholder and Client-only limit below.

- Add optional v4 Worktree facts: instructions, createdAt, importedAt, baseBranch.
- Save instructions through the existing Connection/Remote/Manage path, under the shard lock,
  with a text comparison witness and recovery gate. Empty text disables injection.
- Contribute the current active binding's instructions through DSH agent/pre-step as a
  standalone plugin instructions message. DSH owns log admission; deduplicate against
  visible durable messages, republish after compaction, and invalidate cleared guidance.
  This supersedes the original combined runtime-context implementation.
- Preserve drafts on failure and ready content on scoped refresh; no global refresh on save.
- Record creation facts at acquisition and journal recovery; external imports record only
  registration time. Legacy absent facts remain unknown.
- Match the native open-editor split control's typography, spacing and theme colors.
- Validate persistence, conflicts, archive/detached behavior, Host injection lifecycle,
  Connection descriptors, UI editing, and the package/workspace checks.

### Extension verification

- Independent pre-step reminder revision: `pnpm test` passed all 560 tests;
  `pnpm lint` and `git diff --check` passed. A local upstream DSH SessionStore
  harness accepted the standalone message into its visible log and verified
  listener restart deduplication and the clearing notice. No live user Session
  was modified and no model request was sent during this verification.

- Session error diagnosis: the original camelCase prompt variable violated DSH's
  `/^[a-z][a-z0-9_]*$/` grammar. Reproduced the exact malformed-variable error with
  upstream `renderContextSections`; use `clutch_worktree_instructions` for both
  the reference and value. Added a regression for valid, registered references.

- `pnpm test`: 559 passed, no failures or skips, including real-Git persistence,
  acquisition facts, restart, stale edit rejection, and binding lifecycle coverage.
- `pnpm typecheck`, `pnpm lint`, `pnpm run check:workspace`,
  `pnpm run check:patches`, and `git diff --check` passed.
- After the final Escape guard, `pnpm build` passed and
  `node --test test/client-dashboard.test.mjs test/client-worktree-instructions.test.mjs`
  passed all 15 tests.
- Browser QA used the actual Surface with synthetic data at
  `/tmp/dashboard-actions-qa`: failed saves retain the draft, retry shows saved text,
  creation/base facts render, and the detected-app menu opens. Escape now dismisses
  the menu while retaining Dashboard. English and Chinese layouts were inspected.
  No real editor launch or live Session/model request was performed.
- Both public READMEs, the Client README, and package architecture instructions are updated.
  No commit, version bump, merge, pack, publish, or push was performed.

The dashboard is a plugin-only addition requested for
`wt-worktree-0.1.10/feat-shorten-worktree-name`. It amends the original plan's
non-goal of replacing the Session page: replacement is temporary browser
presentation, with no DSH source or persisted Session changes.

## Scope and composition

- Add Dashboard to the Local/Main and managed active/archived Worktree menus and row actions.
- Reuse `shell.overlay` to cover the area beside the Sidebar. Keep the native
  conversation mounted and temporarily hide/inert its columns, restoring them on
  close, Session navigation, mode exit, anchor loss, and disposal. Missing layout
  anchors mean zero coverage. Do not replace the occupied `conversation` slot.
- Keep only the selected Workspace/Worktree identity in memory. Resolve the name
  (accepted branch), cwd, current branch, and health from the existing ready
  Worktree projection; targeted refreshes retain the current dashboard.
- Copy the exact absolute cwd with explicit success/failure feedback; clicking the accepted
  branch title copies that branch name directly with the same feedback.
- Implement Dashboard, Git & Changes, Sessions, Children, and Settings tabs with
  keyboard navigation. The reference image informs the two-column card layout.
- Clearly label unconnected actions and data as coming soon. Do not invent clean
  Git status, ahead/behind counts, instructions, children, or running Sessions.
- No Host/Provider/Remote/sidecar changes, new dependencies, version bump, commit,
  publish, or changes to the DSH source checkout.

## Dashboard action extension (2026-09-09)

The follow-up work runs on `wt-worktree-0.1.11/feat-dashboard-mvp`.
Connect new Session and Session navigation to the existing surface Session actions;
derive membership directly from the retained in-memory Sessions and bindings, using
the Sidebar's visibility and ordering rules. Show five Sessions in Overview and all
of them in Sessions. Reuse the existing Create dialog with current-branch defaults
and the non-destructive Archive confirmation. Keep the existing eligibility and
pending-operation gates. Launch VS Code through an encoded `vscode://file/...` link.
The remaining Git, instructions, children, settings, and quick actions stay placeholders.
No new reads are introduced by dashboard entry, Session rendering, or tab changes.
The shared Worktree row keeps the existing Dashboard menu entry and adds a hover-only icon action
controlled by the `showDashboardAction` flag for Local/Main and active/archived Worktrees. Its conditional
92px rail places Dashboard/menu/+ at 64/32/0px,
compacts the Worktree leading and nested Session alignment slots to 20px, and reserves the
native Sidebar resize handle's 4px half-width when positioning the Dashboard overlay.

## Verification

Validate the selected identity and presentation lifecycle, clipboard success and
failure, tab switching, active/archived menu entry, resize, keyboard access, and
return to the original Session. Run package typecheck, lint, build, tests and
workspace/patch checks. Inspect the rendered dashboard and document its MVP
limits in both public READMEs and the Client README.

## Initial implementation and verification evidence

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

## Action extension verification

- Implemented Session creation via the existing surface action, in-memory membership
  and navigation, existing Create/Archive dialogs, and an encoded VS Code protocol link.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed on the target feature worktree;
  the final test run built the package and passed 551 tests with no failures or skips.
- `pnpm run check:workspace`, `pnpm run check:patches`, and `git diff --check` passed.
  Prettier checks passed for the edited dashboard code, Surface composition, and test.
- Dashboard regressions cover live membership changes, archive/blank filtering,
  retained order, five/all row presentation, navigation, action delegation, eligibility,
  pending gates, current-branch dialog defaults, and encoded POSIX/Windows paths.
- A synthetic-data preview of the actual Surface is prepared at
  `/tmp/dashboard-actions-qa`. Automatic approval rejected browser access to
  `http://127.0.0.1:43187` because earlier restricted preview access had not received
  explicit user approval.
- After explicit approval, the fresh preview verified the active Worktree Dashboard,
  five-row Overview, full Sessions tab, Session navigation back to the native page,
  the existing Create Worktree dialog with `payment-refactor-2` default, the existing
  Archive confirmation dialog, and the `vscode://file/...` link target. No real VS Code
  launch was attempted; the protocol link was inspected in the browser accessibility tree.
- Both public READMEs and the Client README describe the connected actions and limits.
  Changes remain uncommitted; no version, release, publish, or push operation occurred.

## Session header shortcut extension (2026-09-10)

The plugin now registers a browser-only Dashboard utility in the existing
`conversation.session.header.utilities` list. It is ordered before the native More actions
control and appears only when the shared current-Session context is ready and resolves to Main
or a Worktree. Clicking the icon switches to Worktree mode and reuses the existing transient
Dashboard selection and overlay; no DSH source, Session data, Workspace data, Host, Provider,
Remote, or sidecar contract is changed. The existing More-menu fallback remains available.

The extension adds bilingual accessible copy, native-sized icon-button styling, a source-level
rendering regression, and a Client-composition registration/navigation regression. `pnpm run build`
and the targeted header tests passed. The full package test passed all 572 tests; package typecheck
and lint, workspace shape/patch validation, and `git diff --check` also passed.
