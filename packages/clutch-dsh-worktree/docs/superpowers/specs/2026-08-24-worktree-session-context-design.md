# Worktree Session Context Design

**Status:** Approved design; implementation pending.

**Scope:** TODO1 from `docs/superpowers/drafts/2026-08-24-worktree-session-context-label.md`.

## Decision summary

The Worktree context is the same read-only projection shown in two native
Conversation locations:

```text
blank Session Hero:  Workspace → Agent mode → branch / Worktree
active Session row: Session title → Agent mode → branch / Worktree
```

The context is not a new page header, a new Sidebar tab, or a replacement for
the native Workspace or Agent preset controls.

Display values follow the existing plugin contract:

- Main uses the current local branch from `BranchRecord.isCurrent`.
- An active Worktree uses `WorktreeRecord.branch` as its display name.
- Missing, stale, detached, repair, or not-yet-ready context is omitted rather
  than guessed from an old Session or cwd.

The context is read-only. It does not change Workspace data, Session metadata,
transcripts, Git state, or sidecar records.

## User-visible behavior

### Blank Session Hero

The native Hero row keeps its current Workspace picker and Agent preset control.
The Worktree context is rendered after the Agent preset, producing:

```text
[Workspace picker] [Agent mode] [main or Worktree branch]
```

The context is shown only when the current Session has a reliable projection.
Before a Workspace/Session is selected, while data is loading, or after the
projection becomes invalid, the context control is absent.

### Active Session title row

The plugin contributes a read-only entry to the existing
`conversation.session.header.actions` list. Its order places it after the
native Agent preset label, producing:

```text
[Session title] [Agent mode] [main or Worktree branch]
```

The entry is not a menu and does not pretend that an active Session can change
its Agent preset or Worktree. Long values use the native-compatible ellipsis
and expose the complete raw branch value through a title/accessible label.

The branch and Worktree names remain unlocalized. Accessible labels and any
context type prefix are localized through the plugin locale namespace.

### Session changes

Opening another Session, switching Workspace, completing a Worktree binding,
removing a Worktree, or receiving a refreshed branch/binding projection causes
both locations to resolve against the new current Session. A previous Session's
label must never remain visible while the new projection is unresolved.

The context is independent of whether the Sidebar is currently in native
Workspace mode or Worktree mode. Changing the Sidebar mode must not create or
remove the context for the current Session.

## Architecture

### Shared browser-local projection

Create one Client-fiber-scoped Worktree context projection shared by the Hero
consumer, the Session-header consumer, and the Worktree surface's existing
projection/cache boundary. It is not a new Host or Remote API.

The projection consumes:

- the current DSH Session and Workspace snapshots;
- the browser-local Workspace membership projection;
- Worktree bindings and Worktree records from the existing `WorktreeManager`;
- current branch data from the existing `BranchRecord` projection.

Its output is a small browser-safe view model, conceptually:

```ts
type WorktreeSessionContext =
  | {
      kind: 'main';
      workspaceId: string;
      label: string;
      source: 'current-branch';
    }
  | {
      kind: 'worktree';
      workspaceId: string;
      worktreeId: string;
      label: string;
      source: 'active-binding';
    }
  | {
      kind: 'none';
      reason: 'no-session' | 'not-ready' | 'unbound' | 'detached' | 'repair' | 'stale';
    };
```

The exact exported type may be narrowed during implementation, but the
projection must not expose Provider, Git, sidecar, Node, or native Session
mutation objects to the browser consumers.

Reads are coordinated per Client fiber and keyed by Workspace/session identity.
Rendering either consumer must not issue a new RPC on every render, and an old
request must not overwrite a newer Session's result. Mutations and native list
refreshes invalidate the relevant cache entry. While a new identity is being
resolved, the consumers render no context instead of retaining the previous
label.

The existing `WorktreeSurface` keeps responsibility for its full tree state,
actions, and retryable error surface. The shared projection may reuse its
manager-read cache or refresh coordinator, but the two consumers must not grow
independent copies of binding-to-label resolution rules.

### Native Hero extension

The current DSH rc.8 Conversation contract has no additive seat between the
Workspace picker and Agent preset. The native `ui-conversation` package must
therefore add a root-scoped additive seat, preferably:

```text
conversation.hero.context
```

The native `ConversationRoot` should render it immediately after
`conversation.hero.agentPreset`. The slot must be declared in the native
SlotMap, root children table, and `ConversationSlotProps` render share. The
plugin registers one read-only context entry in that seat.

This is a prerequisite outside this package. The plugin must not hijack
`conversation.hero.workspace`, replace `conversation.hero.agentPreset`, or use
absolute-positioned `shell.overlay` DOM to fake the Hero location.

Because the current rc.8 contract does not declare this seat, the implementation
must update the DSH/native package compatibility boundary before enabling the
Hero consumer. Running the plugin against an older contract must not silently
fall back to DOM overlay behavior.

### Native Session-header extension

No new native header seat is required. The plugin registers the context label in
the existing `conversation.session.header.actions` list. The native Agent
preset label currently uses order `-10`; the Worktree context should use the
next static-context order after it, such as `-5`, so the visible order remains
Session title → Agent mode → branch/Worktree.

The header consumer is session-scoped and must read the current Session from
the standard DSH runtime props. Its Worktree data comes from the shared
browser-local projection face, not from `ctx.remote` or a second transport.

## Presentation contract

The Hero context chip should visually belong to the same row as the native
Workspace and Agent preset controls:

- read-only inline chip;
- branch/tree icon consistent with the Worktree Sidebar;
- native semantic color tokens;
- no dropdown chevron and no mutation affordance;
- ellipsis for long branch values with the full raw value available on hover.

The active title-row label should match the native Agent preset label's static
chrome rather than the larger Hero chip. Both presentations use the same
resolved label and context kind, but they may have separate CSS wrappers for
their two native size budgets.

## State and failure rules

- A Session with an active binding to an active Worktree displays that record's
  `branch`.
- A Session that is resolved as a native Workspace/Main member and has no
  Worktree binding displays the Workspace's current local branch when that
  branch is known.
- A Worktree-created Session whose binding is pending/failed and is not
  reliably mapped to a Worktree displays no context; it must not be classified
  as Main merely because its host Session exists.
- A detached binding, removed Worktree, missing Worktree record, repair state,
  mismatched Workspace, or unresolved current branch produces no context label.
- A stale response from a previous Session cannot populate either location.
- Connection, Gateway, or domain failures remain represented in the existing
  Worktree retryable error path; the context label must not convert an error to
  a false Main label or keep stale successful data visible.
- Client disposal aborts pending projection reads and releases any browser-local
  subscriptions without changing DSH-owned data.

## Testing and acceptance

### Pure projection tests

Cover at least:

- Main Session with a current local branch;
- active Worktree binding with a matching record;
- no Session and not-ready state;
- unbound Session;
- detached/removed/repair state;
- missing record and Workspace mismatch;
- stale response after switching the current Session;
- branch refresh replacing the displayed label.

### Slot and component tests

Cover:

- native Hero render order is Workspace → Agent mode → context;
- plugin registers the Hero context seat only through the declared native slot;
- plugin registers the header action after the Agent preset label;
- both consumers use the shared projection and disappear when it is invalid;
- long labels retain an accessible complete value;
- changing Sidebar mode does not change the current Session context.

### Integration/visual checks

Use the DSH fixture or local Web UI to verify:

1. Main `+` creates a blank Session and shows the current branch in the Hero row.
2. Active Worktree `+` creates and opens a Session and shows its branch in the
   Hero row.
3. After the first prompt, the same value moves to the title row beside the
   Agent mode label.
4. Switching Sessions, Workspaces, and Worktree mode never leaves a previous
   label behind.
5. Detached and repair states do not display a misleading active context.

No screenshot or browser automation should be treated as a substitute for the
projection and slot contract tests; both layout and state behavior need
coverage.

## Non-goals

- Adding a separate Worktree/Workspace tab or picker.
- Adding a durable Worktree display-name field distinct from `branch`.
- Changing DSH Workspace membership, Session metadata, cwd, or transcript data.
- Allowing Worktree or branch changes from the context label.
- Replacing native ConversationRoot or Session-header components.
- Positioning the label with a DOM-querying or absolute `shell.overlay` hack.

## Implementation dependency order

1. Add and release the native `conversation.hero.context` slot contract and
   render site in DSH.
2. Add the shared browser-local context projection and cache invalidation rules
   in the plugin Client entry.
3. Register the Hero context consumer and the existing header-action consumer.
4. Add focused projection, slot-order, lifecycle, and visual regression tests.
5. Update plugin peer/development compatibility metadata and package docs to
   state the required native version.
