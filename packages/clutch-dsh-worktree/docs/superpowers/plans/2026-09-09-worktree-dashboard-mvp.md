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
  registration time. Absent facts are never inferred or fabricated; the Dashboard shows a
  historical-unavailable hint instead of the generic Unknown label.
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
  creation/base facts render, and the encoded VS Code link is present. Escape now dismisses
  the Dashboard. English and Chinese layouts were inspected.
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
- Keep the plugin-only boundary: no changes to the DSH source checkout. The instruction and
  acquisition extension uses this package's existing Host/Manage/provider/Remote/sidecar path;
  no second transport, new dependency, version bump, commit, or publish is part of the Dashboard MVP.

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
controlled by the `showDashboardAction` flag for Local/Main and active/archived Worktrees. Its trailing
action rail is zero-width while idle, so Dashboard, menu, and Session `+` do not reduce the Worktree
label's available width. Hover, focus, or an open menu reveals the available controls in intrinsic-width
flow; a long Worktree label automatically scrolls while the pointer is over the row and resets to its
original position when the pointer leaves. The leading Worktree and
nested Session alignment slots remain compacted to 20px, and Dashboard overlay positioning still reserves
the native Sidebar resize handle's 4px half-width.

## Verification

Validate the selected identity and presentation lifecycle, clipboard success and
failure, tab switching, active/archived menu entry, resize, keyboard access, and
return to the original Session. Run package typecheck, lint, build, tests and
workspace/patch checks. Inspect the rendered dashboard and document its MVP
limits in both public READMEs and the Client README.

## Initial implementation and verification evidence

- At the initial presentation checkpoint, implementation was limited to this package's
  Client, tests, and documentation; DSH source and package metadata remained unchanged.
  Later instruction/acquisition work extends this package's contract and Host/Manage/provider
  modules without touching DSH source.
- `pnpm build`, `pnpm typecheck`, and `pnpm lint`: passed.
- `pnpm test`: 547 passed, 0 failed or skipped. Seven new handler/presentation
  regressions cover identity, refreshed facts, navigation, both locales, tabs,
  clipboard boolean failure/rejection/stale results, geometry and restoration.
- Workspace shape and Cordis patch validation passed; `git diff --check` passed.
- A temporary DSH_HOME at `/tmp/clutch-worktree-dashboard-qa` loads the built
  plugin using the unmodified local upstream source. A separate static fixture
  at `/tmp/clutch-dashboard-preview` bundles the real `WorktreeSurface` with
  synthetic data for visual review without a DSH connection.
- At the initial implementation checkpoint, browser verification was pending explicit
  user authorization: automatic approval rejected the temporary DSH token login and
  then access to the static fixture's local origin. No browser screenshot or visual pass
  was claimed at that checkpoint; the authorized preview evidence is recorded below.
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

## Worktree group row rail optimization (2026-09-13)

The follow-up keeps the change inside the browser Consumer. WorktreeGroupRow now keeps its trailing
action rail at zero width while idle, so the Dashboard icon, options menu, and Session creation `+`
are visually hidden without consuming Worktree label space. Hover, focus, and an open menu reveal the
controls with their intrinsic spacing and preserve keyboard reachability through opacity and pointer-event
states. Long labels switch from ellipsis to an automatic forward-and-return scroll while the rail is
revealed; leaving the row cancels the animation and resets the label to its original position. The existing
500 ms Worktree HoverCard remains the full-value fallback. Workspace rows retain their native fixed rail.

No DSH source or upstream behavior changes. The Dashboard remains a plugin-only preview MVP;
its public documentation and screenshot evidence are recorded in the package docs.

## Collapsed activity follow-up (2026-09-13)

A collapsed Main or Worktree group with ongoing Session activity now reserves a 32px trailing
activity rail: 28px for the native `StateDot` container and 4px of label breathing room. The
long-label scroll loop starts for collapsed activity as well as pointer hover, and both triggers
share one RAF owner. Hover, focus, and an open menu still hide the activity dot and take the rail
back for the existing actions; leaving a running row no longer cancels its activity scroll. When
neither trigger applies, the loop is cancelled and the label returns to its starting position.
This remains a Client-only fix and does not modify DSH source or persisted data.

## Dashboard preview evidence (2026-09-13)

- The user-authorized Dashboard preview is stored as `assets/screenshots/screenshots-dashboard.webp`
  (2584 × 1622) and listed in `screenshots.json`.
- Both public READMEs show the screenshot and identify the Dashboard as a plugin-only preview MVP,
  including the connected actions and the placeholder tabs.
- `test/readme-parity.test.mjs` asserts the Dashboard screenshot references and manifest entry; no
  DSH source or generated runtime artifact is used by the documentation asset.

## Review follow-up verification (2026-09-13)

- Main is represented as a browser-only Dashboard projection. Missing branch, health, and source
  facts remain absent and render as unavailable rather than `main`, `ready`, or plugin provenance.
- The open-editor action reuses DSH's native open-in-app host routes and split button presentation,
  falling back to the encoded `vscode://file/...` link when host app discovery is unavailable.
- Dashboard selection is cleared when Worktree mode exits and when the surface is disposed, so
  re-entry cannot reopen a stale overlay.
- Host instruction injection preserves the user's instruction text literally, including a literal
  `</system-reminder>` sequence; the surrounding reminder remains the plugin-owned wrapper.
