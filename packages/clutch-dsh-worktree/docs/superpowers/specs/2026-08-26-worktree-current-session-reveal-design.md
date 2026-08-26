# Worktree View Current Session Reveal and Positioning Design

Status: Confirmed design

Date: 2026-08-26

Implementation baseline: wt-worktree-0.1.6/release at 7770927

## Goal

Align the Worktree view with native DSH Session navigation. The Session
represented by the DSH sessions.current snapshot must be visibly highlighted
in the Worktree Session list. When the current Session is hidden by collapsed
ancestors or the five-row Session limit, Worktree view must temporarily reveal
the path and position the row inside the Worktree overlay.

The feature is browser-local presentation behavior. It must not alter DSH
Workspace or Session data, Session metadata, transcripts, the Worktree sidecar,
or the persisted structural expansion preference as a side effect of automatic
positioning.

## Scope and boundaries

### In scope

- Highlighting the current DSH Session row in Main, active Worktree, and
  detached Worktree groups;
- resolving the current Session's Workspace and visual Session group;
- temporarily revealing collapsed Workspace, Main, Worktree, and Session group
  ancestors;
- temporarily revealing Session rows beyond the first five;
- clearing an active search query when a locate trigger occurs and the query
  could hide the current Session;
- scrolling the current row into the Worktree overlay's nearest visible area;
- preserving user expansion preferences and respecting an explicit manual
  collapse of an automatically revealed path;
- regression tests and public documentation for the new browser-local behavior.

### Out of scope

- changing DSH's native Session selection or Workspace membership;
- changing Worktree bindings, sidecar records, Git state, Host APIs, or Remote
  contracts;
- persisting current selection, search text, scroll position, or Session-group
  overflow state;
- synchronizing reveal state across browser tabs;
- automatically changing search text when the user is merely searching for a
  different Session without a locate trigger.

## Confirmed user behavior

### Current Session source and highlight

DSH's sessions.current is the only source of truth. The Worktree surface does
not infer selection from the last clicked row, the open menu, drag state, or a
Worktree binding mutation.

When a rendered Session ID equals sessions.current, its row receives a
native-aligned selected appearance and an explicit current marker for testing
and accessibility. When sessions.current changes, the old row loses the
marker and the new row becomes the only highlighted row.

The existing Session label, blank-Session visibility, menu, and drag behavior
remain unchanged. A blank current Session is highlighted using the existing
localized New Session label and still has no Session action menu.

### Reveal path

The surface resolves the current Session to one visual path:

    Workspace -> Main -> Main Session group

or:

    Workspace -> Worktree -> Worktree Session group

The resolver uses Workspace membership, the current ready Worktree view, and
the existing binding projection. It supports:

- an unbound Session in Main;
- a Session bound to an active Worktree;
- a Session whose Worktree record is detached after removal.

If the current Session cannot be found in the current DSH/Worktree snapshot,
the surface does nothing visible beyond the normal data refresh. It does not
invent a Workspace, create a binding, or surface a new error.

### Search behavior

Locate triggers are limited to entering Worktree mode and changing
sessions.current. If a non-empty search query is present at one of those
triggers, the surface clears it before resolving the visible path. The query
is not cleared merely because the user starts searching for another Session.

After the query is cleared, Workspace, Worktree, and Session filtering uses the
existing selectors and the current row can be rendered normally.

### Temporary expansion and manual collapse

Automatic reveal is represented by an in-memory current-session reveal state.
It does not call the expand-state store's mutation actions and does not write
clutch-dsh-worktree.expand-state.

The effective expansion of a structural row is:

    persisted expanded OR current-session temporary reveal

The effective expansion of a Session group is:

    existing transient group expansion OR current-session temporary reveal

When the current Session changes, the old reveal path and its temporary manual
suppression are discarded. The previous path therefore returns to the user's
persisted structural preference and existing transient Session-group state.

If the user manually collapses a row that is visible only because of automatic
reveal, that action takes precedence for the current Session. The row hides
immediately, the automatic reveal for that path is suppressed until the next
current-Session change, and the original persisted collapsed record is left
unchanged. A later explicit expand action follows the normal control semantics.

Collapsing a parent continues to clear affected transient Session-group
overflow state through the existing selector/helper behavior.

### Scroll positioning

The surface attempts positioning only after a locate trigger. It waits for the
current Session row to be committed under the Worktree overlay, then finds the
row by its existing data-session-id marker and calls:

    scrollIntoView({ block: 'nearest' })

The lookup is scoped to the Worktree overlay, so native page, Workspace, and
other Sidebar scroll containers are not moved. Ordinary Worktree data refreshes
do not re-scroll an unchanged current Session.

## State model

The existing WorktreeExpandStateStore remains responsible only for
user-controlled Workspace, Main, and Worktree structural preferences.

The surface adds an ephemeral model equivalent to:

    interface CurrentSessionLocation {
      readonly sessionId: string;
      readonly workspaceId: string;
      readonly groupKey: string;
      readonly kind: 'main' | 'worktree';
      readonly worktreeId?: string;
    }

The current reveal state contains the resolved location and a set of reveal
keys suppressed by an explicit user collapse for this current Session. Reveal
keys are derived from stable IDs, for example:

- workspace:<workspaceId>;
- main:<workspaceId>;
- worktree:<worktreeId>;
- session-group:<groupKey>.

The state is reset when Worktree mode exits, when the current Session ID
changes, or when the component is disposed. It is never serialized.

The existing expandedSessionGroups record remains transient. It is not merged
into browser storage and is not treated as a source of current Session
identity.

## Component and module responsibilities

### worktree-surface-selectors.ts

Add pure helpers to resolve a current Session location and to derive stable
reveal keys. The helpers must be deterministic and independent of React,
browser APIs, Git, sidecar storage, and DSH mutation APIs.

The resolver must distinguish Main from Worktree by the existing binding
projection, retain detached Worktree records when present, and return
undefined for incomplete or unmatched data.

### WorktreeSurface.tsx

Own:

- the current Session ID read from the injected DSH Session store;
- current location resolution;
- ephemeral reveal and manual suppression state;
- search clearing on locate triggers;
- effective expanded values passed to Workspace, Main, Worktree, and Session
  group rows;
- one post-commit positioning effect with stale-target cancellation.

The effect must wait for a ready/renderable row when the initial locate trigger
occurs while Worktree data is loading. It may retry when the relevant mode,
current Session, read state, or resolved location changes, but must not create a
continuous scroll loop.

### worktree-surface-types.ts and worktree-surface-rows.tsx

Extend Session row props with a current/selected presentation flag. The row
component renders the marker and selected class but does not resolve DSH state.
The Session group receives the current Session ID or resolved current marker
from the surface and passes it to each row.

Structural row toggle handlers must distinguish an ordinary persisted toggle
from a manual collapse of an automatically revealed row. This lets a user hide
the current path immediately without flipping an existing persisted collapsed
record.

### worktree.css

Add the current Session appearance using the existing row geometry, spacing,
hover, menu, and drag affordances. Current highlighting must not change the
fixed action rail or the Session label truncation behavior. Menu-open and drag
markers remain visible and usable when the row is current.

No Client entrypoint, Host composition, Remote contract, provider, manage, Git,
or sidecar changes are required.

## Lifecycle and failure handling

1. On entering Worktree mode or observing a new sessions.current ID, create a
   locate generation.
2. Clear the search query if needed and resolve the current location from the
   latest available facts.
3. Render the temporary reveal path without mutating the persisted expand
   store.
4. After commit, locate the matching Session row inside the overlay and scroll
   it into the nearest visible area.
5. Mark that generation positioned. A normal refresh with the same current
   Session does not restart it.

If the read is loading, stale, incomplete, or in an error state, existing ready
content remains governed by the current refresh-preservation behavior. A
missing current row is treated as an unresolved locate target, not as a
Worktree domain error. The target can be resolved by a later complete ready
snapshot.

If a component unmounts or a newer locate generation supersedes an older one,
pending animation-frame or post-commit work is cancelled or ignored. A stale
callback must never scroll an old Session.

Detached Worktree data is display-only as it is today. Current Session reveal
does not repair, remove, or rebind detached records.

## Verification strategy

### Pure selector tests

- resolve an unbound current Session to Main;
- resolve an active Worktree binding;
- resolve a detached Worktree binding;
- return no location for a missing Session, incomplete view, or unmatched
  binding;
- derive stable reveal keys from IDs rather than labels or array positions.

### Surface and row tests

- current Session receives the selected marker and old current rows lose it;
- collapsed Workspace, Main, and Worktree ancestors are temporarily revealed;
- a current Session after the fifth row temporarily reveals Session overflow;
- automatic reveal does not mutate the persisted expand-state snapshot;
- manual collapse hides an automatically revealed path immediately and remains
  suppressed until current Session changes;
- the current row remains compatible with blank Session, menu, hover, and drag
  states;
- entering Worktree mode and current Session changes trigger positioning;
- ordinary refreshes with an unchanged current Session do not scroll again;
- a non-empty search is cleared only for a locate trigger;
- delayed ready data positions after the target row appears;
- missing targets, stale generations, and unmounts do not throw or scroll the
  wrong row.

### Regression and boundary checks

- existing expand-state persistence tests continue to pass unchanged for
  user-controlled structural toggles;
- existing no-white-screen refresh tests continue to pass;
- no DSH Workspace/Session fixture, sidecar fixture, Remote contract, or Host
  source is modified by this feature;
- run package typecheck, build, tests, and the workspace/patch checks required
  by the package instructions.

## Documentation

After implementation, update the English and Chinese public README files and
the Client README to describe that current Session highlighting and automatic
positioning are browser-local Worktree presentation behavior. The documents
must state that automatic reveal does not change DSH data, sidecar data, or the
user's persisted structural expansion preference.

## Alternatives rejected

- Mutating the persisted expand-state store during automatic reveal would
  silently change user preferences and create restoration races.
- An imperative DOM-only scroll without a declarative reveal path cannot
  reliably reach a row hidden behind collapsed ancestors or Session overflow.
- Reusing DSH native selection mutation would violate the plugin's read-only
  boundary for Workspace and Session facts.
- Re-scrolling on every refresh would interrupt normal browsing and cause
  visible jumps during background reads.
