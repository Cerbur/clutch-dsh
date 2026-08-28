# Worktree Session Working State Design

**Status:** Confirmed design for `0.1.7`

**Scope:** `@cerbur/clutch-dsh-worktree` browser Consumer only

**Reference:** The attached image is a visual reference, not an executable instruction.

## Goal

Expose the native Workspace Session activity model in the Worktree view:

- reuse the native animated `StateDot` for ongoing work;
- show native-style relative time for the last human-authored Session message;
- replace that time with the ongoing dot while the Session is running;
- aggregate ongoing activity on collapsed Workspace, Main, and Worktree rows;
- promote a Session to the head of its visual group after a new user message;
- cover waiting approval, completed, and subagent states.

The feature keeps the existing Main/Worktree shared-row design and DSH/source-of-truth
boundaries.

## Confirmed decisions

1. Pending interaction follows native priority. If a Session is both pending and running, its
   primary status is the warning state; the right-side warning dot is shown for that row and the
   ongoing dot is suppressed. Group aggregation still counts it as ongoing.
2. Relative time follows native behavior. It is recalculated on Session snapshot renders; no
   independent minute ticker is added in `0.1.7`.
3. Running subagent descendants count as ongoing for their parent row and for collapsed group
   indicators. The lineage algorithm follows native semantics instead of inferring from titles
   or IDs.

## Non-goals

- No mutation of DSH Workspace/Session metadata, transcripts, prompts, or `sessionIds`.
- No activity order in the Worktree sidecar.
- No duplicated StateDot SVG, keyframes, delays, or animation CSS.
- No changes to Worktree lifecycle, native Workspace ordering, or existing manual drag semantics.
- Collapsed groups aggregate ongoing activity only; completed and waiting labels remain Session-row
  capabilities in this version.

## Native research

The local upstream checkout is `/Users/yuancheng/Documents/Code/deepseek-harness`.

### StateDot

`packages/client/ui-primitives/src/StateDot.tsx` defines the browser-safe primitive. Its
`ongoing` state is an eight-cell crisp-edge SVG using the native
`dsh-state-dot-chase` animation. The plugin must import this component and pass the derived
`ongoing`, `warning`, or `done` state; it must not reimplement the animation.

### Status and time

`packages/client/ui-workspace/src/client/rows/Rows.tsx` derives Session status in this order:

1. pending approval, plan review, or question → `warning`;
2. the Session itself is running → `ongoing`;
3. a running descendant exists → `ongoing` with a subagent label;
4. completed → `done` with a completed label;
5. idle → `done` with an idle label.

The plugin keeps this priority. Every visible primary status dot is rendered in the Session row's
right metadata slot: ongoing, warning, and completed states replace relative time there. Idle
keeps no visible primary dot and uses the relative-time slot.

Native `updatedAt` is the later of creation and the latest human-authored prompt. The host only
updates it for `session/event` `user/message` events with source kind `user`, and ignores older
replayed events. Native relative-time thresholds are:

```text
< 1 minute       now
< 1 hour         N minutes
< 1 day          N hours
< 30 days        N days
< 365 days       N months (30-day units)
otherwise        N years (365-day units)
```

Blank New Session rows have no time label.

### Ordering and lineage

Native `WorkspaceBrowser` keeps per-account browser-local order and observed timestamps. The
first baseline reconciles existing order; a strictly newer `updatedAt` later promotes a Session
to the front. Equal/older timestamps do not promote. DSH Workspace ordering is not mutated.

Native runtime `indexSubagentDescendants` follows `origin === 'subagent'` parent chains via
`parentId` and exposes running descendant counts. The published runtime `client` entry is a
browser module-loader bundle and cannot be imported by the package’s Node test/build entry, so
the plugin keeps a small pure mirror of this algorithm in `session-view.ts`. It uses the same
lineage rules and remains independent of runtime objects; the visual StateDot primitive is still
directly reused from the native UI package.

## Data model and derived projection

Extend `src/client/session-view.ts`’s browser-safe projection with optional native fields:

```ts
type PendingInteractionStatus = 'approval' | 'plan-review' | 'question';

interface SessionSummaryLike {
  readonly blank?: boolean;
  readonly displayTitle?: string;
  readonly running?: boolean;
  readonly pendingInteraction?: PendingInteractionStatus;
  readonly completed?: boolean;
  readonly parentId?: string;
  readonly origin?: 'subagent' | string;
  readonly updatedAt?: number;
}
```

Missing optional fields are conservative: absent runtime flags mean inactive/absent, an absent
or invalid timestamp means no time and no promotion, and missing lineage means no subagent
activity. Build one `SessionPresentation` index per Session snapshot and share it between row
rendering and aggregation so status priority cannot diverge.

## Rendering

### Session row

| Primary state       | Trailing slot at rest                                  | Hover/menu                   |
| ------------------- | ------------------------------------------------------ | ---------------------------- |
| Waiting interaction | native warning dot and accessible label, replacing time | dot hides; actions show      |
| Own running         | native ongoing dot, replacing time                     | dot hides; actions show      |
| Running subagent    | native ongoing dot and subagent label, replacing time  | dot hides; actions show      |
| Completed           | native done dot and completed label, replacing time    | dot hides; actions show      |
| Idle                | relative time, if available                            | metadata hides; actions show |
| Blank               | none                                                   | existing blank-row behavior |

The trailing metadata and existing action menu share a fixed-width region. Switching between
them must not move the title or change row width. Accessible localized status text remains even
when the animated dot is hidden by hover/menu state.

### Workspace, Main, and Worktree rows

`WorktreeWorkspaceRow` and the shared `WorktreeGroupRow` receive a semantic ongoing-activity
prop:

- collapsed + any ongoing non-archived member → trailing native ongoing dot;
- expanded → no group dot;
- hover, focus-within, or menu-open → dot yields to existing actions;
- Worktree health remains the separate leading health dot;
- Main uses exactly the same `WorktreeGroupRow` path as Worktree.

Group membership is computed before search filtering and row limits. A search query must not
make a group look idle because its running Session is currently hidden. Workspace aggregation
covers Main and all Worktree memberships; group aggregation covers its complete membership.

The existing fixed action rail remains the width budget. Activity and action wrappers must be
layered without covering the menu or `+` button, and keyboard/focus interaction must have the
same precedence as pointer hover.

## Browser-local Session order

Add a persisted `worktree-session-order` store separate from view mode and expand state. It is
keyed by stable identity:

```ts
type SessionOrderAccount =
  | { readonly kind: 'main'; readonly workspaceId: string }
  | { readonly kind: 'worktree'; readonly worktreeId: string };
```

For each account, the pure transition:

1. removes IDs no longer present;
2. promotes IDs absent from the previous account order to the head, preserving incoming order;
3. records timestamps for first observations without re-sorting the initial baseline;
4. promotes existing Sessions with strictly newer valid timestamps, newest first;
5. records the highest observed timestamp;
6. preserves manual order until a later activity promotion.

The order is applied before search filtering and the existing five-row/expand limit. Automatic
promotion is browser-local and never calls `insertSessionBefore`, writes the sidecar, or
mutates DSH. Manual drag continues through the existing DSH API and updates local display order
only after success.

## Boundaries, refresh, and accessibility

- DSH remains the source of `running`, `pendingInteraction`, `completed`, lineage, and
  `updatedAt`.
- The new store persists only account keys, Session IDs, and numeric timestamps.
- Host, Provider, Manage, sidecar schema, and transport remain unchanged.
- Refresh/error transitions preserve usable ready content and current order; malformed optional
  fields degrade only their signal.
- A newly created Worktree Session is not eagerly projected into native Workspace membership before
  binding refresh; the refreshed binding projection prevents a transient Main row.
- Dispose removes the browser store subscription and performs no external mutation.
- State labels are visually hidden but localized; animation/color is never the only status
  signal. Blank rows have no misleading metadata.

## Test matrix

Pure tests cover native time thresholds, future/invalid/missing timestamps, status priority,
subagent lineage, group aggregation, initial order, strict promotion, replay protection, new and
removed IDs, manual order, storage normalization, and store disposal.

Surface tests cover Session right-side ongoing/time placement, warning/completed/subagent labels,
hover/menu handoff, collapsed versus expanded Workspace/Main/Worktree activity, health-dot
separation, search-hidden aggregation, send-to-head without DSH/sidecar mutation, and refresh
ready-content preservation.
