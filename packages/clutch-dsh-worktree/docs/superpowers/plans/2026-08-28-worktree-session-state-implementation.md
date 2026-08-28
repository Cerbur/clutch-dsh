# Worktree Session Working State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native-compatible Session status/time presentation, collapsed activity indicators,
and browser-local send-to-head ordering to `@cerbur/clutch-dsh-worktree` for `0.1.7`.

**Architecture:** Keep DSH as the only source of Session facts. Derive one browser-safe Session
presentation index, reuse the upstream `StateDot`, mirror the native subagent-lineage
algorithm in the pure browser helper, render metadata and actions through existing fixed rails,
and add a persisted browser-local order store keyed by Main Workspace or Worktree identity. No
Host, Provider, Manage, sidecar, transport, or DSH data mutation changes are expected.

**Tech Stack:** TypeScript, React, existing DSH Client primitives, `StateDot`,
`useSyncExternalStore`, browser-local storage, Node tests, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-28-worktree-session-state-design.md`

## Global constraints

- Work only in `/private/tmp/clutch-dsh-wt-worktree-0.1.7-session-working-state` on
  `wt-worktree-0.1.7/feat-session-working-state`.
- Preserve unrelated changes; never reset or broadly delete files.
- Browser code may use only the existing DSH Connection and contract projection.
- Reuse native `StateDot`; do not add animation SVG/keyframes/CSS.
- Automatic promotion is browser-local and must not call `insertSessionBefore`, write sidecar
  data, mutate DSH Workspace data, or persist Session content.
- Main and Worktree keep the shared `WorktreeGroupRow` component.
- Apply TDD to every production change: failing test, verify Red, minimal Green, verify Green,
  then refactor.
- Use `apply_patch` for edits. Do not bump version, publish, push, or commit without explicit
  authorization.

## Task 1 — Session projection, status, time, and locale helpers

**Files:** `src/client/session-view.ts`, `src/client/locales.ts`,
`test/client-session-view.test.mjs`.

### Red

- Add fixtures for own running, pending approval/plan-review/question, completed, idle, and
  subagent Sessions.
- Assert optional native fields coexist with current blank/title/query/visibility behavior.
- Assert native status priority, descendant count handling, and every relative-time threshold.
- Assert future timestamps clamp to `now`, invalid/missing timestamps produce no time, and all new
  status/time labels exist in both locales.
- Run the focused test and verify it fails for the missing API, not due to a test typo.

### Green

- Extend `SessionSummaryLike` with optional `running`, `pendingInteraction`, `completed`,
  `parentId`, `origin`, and `updatedAt`.
- Add a pure relative-time helper with explicit `updatedAt` and `now` inputs.
- Add pure native-priority status derivation returning state and accessible label keys.
- Mirror native `indexSubagentDescendants` semantics in the pure helper; the published runtime
  client entry is a browser module-loader bundle and must not be imported by Node-testable
  session-view code. Do not infer lineage from strings.
- Add synchronized `en`/`zh` locale keys with conservative behavior for omitted fields.

### Verify/refactor

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- test/client-session-view.test.mjs
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
```

Refactor only after Green; keep this module free of React, DOM, Git, sidecar, Host, and Manage
dependencies.

## Task 2 — Browser-local per-group Session order

**Files:** new `src/client/worktree-session-order.ts`,
`test/client-worktree-session-order.test.mjs`.

### Red

Test first baseline, strict newer promotion, newest-first simultaneous updates, equal/older
replay, new/removed IDs, invalid/missing timestamps, manual order preservation, independent
Main/Worktree accounts, storage round-trip/malformed data, and disposal.

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- test/client-worktree-session-order.test.mjs
```

The new test must fail because the module/API is absent.

### Green

Implement a deterministic pure transition and a small snapshot store. The transition reconciles
IDs, moves newly observed IDs to the account head in incoming order, records first-seen
timestamps without re-sorting the initial baseline, promotes strictly newer timestamps, and
retains the highest observed value. The store persists only account keys, Session IDs, and
numeric timestamps, normalizes malformed storage, and exposes `getSnapshot`, `subscribe`,
`reconcile`, `setOrder`, and `dispose`.

### Verify/refactor

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- test/client-worktree-session-order.test.mjs
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
```

No order-store API may accept Host, Provider, Manage, Git, or sidecar objects.

## Task 3 — Derive and wire snapshots/order into `WorktreeSurface`

**Files:** `src/client/worktree-surface-types.ts`, `src/client/WorktreeSurface.tsx`,
`src/client/entry.ts`, and focused surface tests.

### Red

- Add Workspace fixtures with Main/Worktree Sessions covering running, pending, completed,
  subagent, archived, and search-hidden cases.
- Assert one shared presentation index feeds both row state and group aggregation.
- Assert stable independent account keys and strict `updatedAt` promotion without calls to
  `insertSessionBefore` or sidecar spies.
- Assert aggregation uses complete non-archived membership, not filtered rows.
- Assert current-session reveal and expand state still control group visibility.

### Green

- Create the order store with view/expand stores in `entry.ts`, subscribe via
  `useSyncExternalStore`, and dispose with the existing lifecycle.
- Build one Session presentation index from `sessions.byId` and native descendant lineage.
- Derive complete membership first; then apply order, search, archive, and existing row limits.
- Pass ordered IDs to `WorktreeSessionGroup`.
- Compute Workspace, Main, and Worktree ongoing activity from complete non-archived membership.
  Count `running || runningSubagentCount > 0` even if the primary row status is warning.
- Keep manual drag on the native API; update local order after success only.

### Verify/refactor

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- test/client-worktree-surface-state.test.mjs
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
```

Run existing refresh, projection, drag, and expand tests before moving on.

## Task 4 — Session row status/time and action handoff

**Files:** `src/client/worktree-surface-types.ts`, `src/client/worktree-surface-rows.tsx`,
`src/client/worktree.css`, focused row tests.

### Red

Assert running own/subagent rows show the right ongoing dot and no time; pending and completed
rows show their warning/done dot in the right rail instead of time; idle rows show time; blank
rows show none; hover/menu hides metadata and reveals actions; title width/row height remain
stable.

### Green

- Add a status presentation prop rather than recomputing in JSX.
- Use one trailing status/time metadata slot for every visible Session status; do not render a
  leading status slot.
- Import the existing native `StateDot`; add accessible visually hidden labels.
- Use existing hover/menu selectors to swap metadata for actions without adding animation rules.

### Verify/refactor

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- test/client-worktree-surface-state.test.mjs
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
```

Confirm the action menu remains keyboard accessible while metadata is visible.

## Task 5 — Collapsed Workspace/Main/Worktree activity

**Files:** `src/client/worktree-surface-types.ts`, `src/client/worktree-surface-rows.tsx`,
`src/client/worktree.css`, collapsed/action tests.

### Red

Assert collapsed Workspace activity from Main and Worktree members, collapsed Main and active/
detached Worktree activity, expanded suppression, hover/menu handoff, health-dot separation,
and shared Main/Worktree component usage.

### Green

- Add `hasOngoingSession` (or equivalent) to Workspace/group row props.
- Render activity only when ongoing and collapsed; use native ongoing `StateDot` in the existing
  fixed rail.
- Layer activity and action wrappers so the dot never covers menu/`+` controls.
- Preserve current action coordinates and focus-within/menu precedence when there is no activity.

### Verify/refactor

```bash
pnpm --filter @cerbur/clutch-dsh-worktree test -- test/client-worktree-surface-state.test.mjs
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
```

## Task 6 — Public and client documentation

**Files:** `README.md`, `README.zh.md`, `src/client/README.md`.

After behavior is implemented, update both public READMEs in their required four-section order
and keep facts synchronized. Document native StateDot/time placement, status coverage,
collapsed aggregation, browser-local send-to-head ordering, and DSH/sidecar boundaries. Update
the client README with the shared Main/Worktree row and order-store boundary. Do not add the
current package version to README files.

Verify:

```bash
pnpm run check:workspace
pnpm run check:patches
git diff --check
```

## Task 7 — Full verification and handoff

Run from the feature worktree:

```bash
pnpm run check:workspace
pnpm run check:patches
pnpm --filter @cerbur/clutch-dsh-worktree typecheck
pnpm --filter @cerbur/clutch-dsh-worktree build
pnpm --filter @cerbur/clutch-dsh-worktree test
pnpm run format:check
pnpm run lint
git diff --check
git status --short
```

Review that no native/Host/Provider/Manage/sidecar files changed, no StateDot animation was
duplicated, automatic promotion has no external mutation, and refresh does not clear ready
content. Report exact command results and changed files.

Only after explicit authorization, verify the feature worktree is clean, create one scoped
commit, and stop before release-worktree rebase/merge. Version bump, pack, publish, and tag are
outside this task.

## Implementation checkpoint — 2026-08-28

- Implemented the browser-safe native Session status/time projection, including pending
  interaction, completed, and subagent lineage states, while reusing the upstream `StateDot`.
- Implemented independent browser-local per-group Session ordering: newly observed Sessions enter
  the account head, existing Sessions use strict `updatedAt` promotion, and automatic promotion
  does not call DSH ordering or mutate the sidecar.
- Wired complete-membership ongoing aggregation to Workspace, Main, and Worktree rows, with
  collapsed-only indicators and hover/focus/menu action handoff.
- Synchronized `README.md`, `README.zh.md`, and `src/client/README.md` with the confirmed design.
- Verification: root `pnpm run check` passed; root checks reported 17/17 and package checks
  reported 278/278 tests passing. `git diff --check` passed. No version bump, push, publish,
  or merge was performed; the scoped commit is created only to satisfy the requested rebase
  gate.

## Follow-up checkpoint — 2026-08-28

- Confirmed that every visible non-idle Session status uses the right metadata rail: ongoing,
  warning, and completed dots replace relative time; idle keeps the relative-time label.
- Removed the empty leading status slot so Session titles retain the requested left alignment.
- Added and passed a focused regression assertion for the right-only status rail; the package test
  suite remains 278/278 passing.

## Regression follow-up checkpoint — 2026-08-28

- Traced the new-Session-at-tail regression to the order test and implementation introduced by
  `7f3e555`, which intentionally appended first-seen IDs and therefore contradicted the requested
  native queue-head behavior.
- Traced the Worktree-to-Main flash to the create path projecting native Workspace membership in
  `beforeOpen` before the binding refresh; restored the earlier create ordering so new Worktree
  Sessions bind and open before the refreshed projection adds them to the Worktree view.
- Added focused regressions for newly observed IDs and create/membership timing; focused tests pass
  46/46. Full package verification remains to be run after this follow-up.
