# Session completion status regression

## Scope and superseded assumption

This feature starts from `wt-worktree-0.1.17/release` at
`55ba94d164f348dd8bd425a12dacda81b015cfd2`. The historical
[Session state plan](superpowers/plans/2026-08-28-worktree-session-state-implementation.md)
projected pending/completed directly from SessionSummary. That assumption is superseded
by the installed native UiSession's independent status source; the DSH data-ownership
constraint and existing row/group priority remain unchanged. Historical plans stay read-only.

## Red / green loop

1. Load the real installed UiSession and renderer Client handoffs in a Cordis Context,
   with the native snapshot store and SlotRegistry. Baseline has `s.running=true`,
   `retainedBy={}`, and no legacy completed/pending fields.
2. Emit `api-session/status(s, false)` and replay the stopped list row. Assert native
   `completionUnread=true`, then execute the production Surface hook and row JSX.
   Before the fix, `completed===true` fails with `false !== true` (exit 1).
3. Read the standard `useSessionStatus` hook, include its Map in projection memo
   dependencies, and translate native pending `kind` / `completionUnread` only at
   the ephemeral presentation seam. The same regression passes after the fix.
4. Extend the same loop to status-only updates, main-view acknowledgement, rerun, cold
   idle, pending priority, collapsed Worktree/Workspace, Dashboard, legacy graph and
   catalog-only subagent lineage. Never create a second completion owner.

Focused command (package cwd): `node --test test/client-native-session-status.test.mjs`.
Full gates remain those in [DEVELOPMENT.md](DEVELOPMENT.md) and package AGENTS.

## Catalog decision

The installed Session Controller folds `subagentCatalog` children into `byId`,
including children absent from root `ids`. UiSession's status source handles running
and local unread observation independently. Keep the existing lineage walk, use native
running facts when known, and do not add catalog I/O, retention, or persisted reminders.

## Delivery boundary

Only this package's Client projection, regression tests and documentation change.
No Host/Provider/sidecar, DSH core, Session data, profile or installation changes.
Leave reviewable uncommitted edits; no commit, merge, push or publish. Local verification
is not a production GUI deployment and no `dev:web` watcher is assumed.
