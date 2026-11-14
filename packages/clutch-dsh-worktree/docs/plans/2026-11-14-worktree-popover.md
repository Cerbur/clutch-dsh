# Current Session Worktree popover

## Scope and public seam

Use the existing feature Worktree without delegation, version changes, installation
configuration changes or Git publication. Add a public Session-header utility before
native More. Exact adjacency to the sidebar toggle is not exposed by the DSH slot.

## Implementation

- Keep the current Dashboard shortcut and add a branch-icon popover trigger.
- Resolve the current Session binding through the shared Workspace reader; explicit
  Main context is required for Main. Render detached, missing and unavailable states.
- Use an independent minimal layout: small regular title and reload icon, uncommitted
  changes, divider, worktree-to-baseline heading, ahead/behind, committed changes.
  Switch reload to the native loading icon across Workspace and Git reads. First reads
  fill fixed-size placeholders; later reads retain ready content without loading text.
  Omit the sidebar action, paths, close button
  and mutation forms. Reuse the Git overview reader, not Dashboard layout.
- Use native MenuSurface glass material (as in active Sessions), rounded corners and
  a prominent shadow. Header toggle has explicit expanded/collapsed visual states.
  Git counts remain runtime projections.
- Route overview/Git navigation through DashboardSelection.initialTab.
- Keep Session creation in Dashboard. Reuse its baseline editor via a right-aligned pencil
  on the Worktree comparison heading. Local shows only live uncommitted changes.
- Preserve same-target ready content during refresh, invalidate only its Workspace,
  reject stale completion. Ahead/behind opens the shared sync dialog instead of Dashboard;
  require a healthy active Worktree, named baseline and fresh readable comparison.
  This row follows the full Dashboard action without a behind-positive gate.
- Position 12px inside the Session right edge and 12px below the native conversation
  header including view tabs, verified with its public leading marker. Observe header
  resize and viewport changes; do not anchor placement to the trigger button.
  Conversation clicks/focus leave the panel open.
  Header toggle and Escape dismiss it, with nested-modal Escape ownership.
  Persist the open preference in localStorage, defaulting to open; Session switches retain
  it without taking focus. Dashboard selection suppresses the panel without saving a close.

## Verification

Regression coverage: target identity, Main/detached/missing states, fresh comparison
sync gate in the full Dashboard, correct Git tab navigation, retained ready content,
header toggle, conversation persistence, stable loading rows, reload icon lifetime,
Escape dismissal and focus restoration.
Run workspace, patch, lint, typecheck, build, package test and README parity checks.
Real DSH browser verification remains separate from jsdom interaction tests; do not
change the running instance's installation configuration to perform it.

## UI revision

The user requested a minimal Codex-style floating panel on 2026-11-14. This supersedes
the initial compact Dashboard design. A later revision adds the shared baseline editor;
Session creation remains in the full Dashboard. The ahead/behind row now opens the shared
baseline-sync dialog, including its retry identity and partial-failure handling.
