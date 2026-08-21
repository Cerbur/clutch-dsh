# Worktree Surface Interaction and Overlay Design

## Goal

Improve the Worktree navigation surface so it behaves like a native DSH
Workspace/Session browser while remaining an additive plugin-owned overlay.
The surface must not cover unrelated sidebar controls, must remain usable with
long lists, and must not require changes to the native DSH source.

## Scope and boundaries

The change is limited to this package's browser Consumer, its existing Host
projection where transient Worktree health is needed, tests, and package
documentation.

DSH remains the source of truth for Workspace identity, Workspace registration,
Session identity, Session metadata, Session history, and native Workspace and
Session ordering. The plugin continues to own only Worktree metadata and
Worktree/Session relationships in its sidecar.

The overlay does not replace the native Sidebar, Workspace browser, footer, or
other plugin slots. It does not add a new RPC transport and does not write to
the DSH source repository.

## Overlay geometry

The Worktree surface is mounted through the existing `shell.overlay` slot. It
is positioned over the native sidebar interval beginning at the top edge of
the native New Session control and ending at the top edge of the native
footer.

The top and bottom are runtime geometry, not fixed heights. The Client finds
the native New Session control semantically, resolves the native footer from
the Sidebar tree, and computes both rectangles relative to the frame overlay.
`ResizeObserver` watches the relevant sidebar, anchor, footer, and overlay
elements. A `MutationObserver` coalesces updates when another plugin inserts or
removes content above New Session. Window/layout changes therefore update the
surface without a hard-coded vertical offset.

If the anchors are temporarily unavailable, the surface renders with zero
coverage instead of falling back to a full-column overlay. This prevents a
partially composed page from blocking other controls. The existing dynamic
sidebar width observation remains in place and is combined with the vertical
bounds.

The surface keeps its footer boundary outside the overlay. The content column
has `min-height: 0` and `overflow: auto`, so the Worktree list scrolls inside
the computed interval. Collapsed-sidebar rendering uses the same top and
bottom bounds and keeps the compact rail behavior local to the covered region.

The Workspace/Worktree mode Tab is removed. The footer action remains the sole
entry point for entering or leaving Worktree mode, and the surface close
button returns to the native Workspace/Session view.

## Native Workspace and Session interactions

### Workspace rows

Each Workspace row keeps its disclosure control, folder affordance, title, and
fixed trailing action column. The trailing menu provides native-style Rename
and Delete actions; the adjacent Workspace `+` remains aligned with every
other tree-level `+`.

Workspace rows are HTML drag sources and drop targets. The row shows a native-
style before/after insertion marker while a compatible Workspace drag is in
flight. A committed drop calls the injected native DSH
`workspaces.insertBefore(workspaceId, beforeWorkspaceId)` callback. The DSH
Workspace list remains authoritative after the request.

Rename uses a controlled native-style modal. It trims the proposed title,
rejects an empty title, blocks a duplicate title using the current Workspace
snapshot, and preserves the modal with an error when the native mutation is
rejected.

Delete uses a controlled confirmation modal and calls the native Workspace
delete callback. It follows native semantics: deleting a Workspace removes
only its DSH registration; it does not delete the directory, Session logs, or
Git Worktrees. The plugin does not mutate or silently clean the sidecar during
this native operation. Existing sidecar records remain available to later
repair/reconciliation logic rather than being mistaken for DSH data.

### Main and Worktree Session groups

Main and each Worktree are separate visual Session groups. Each group renders
the first five visible Sessions by default. When more exist, a native-style
expand control reveals the rest and can collapse the group again. Expansion is
browser-local UI state and does not enter DSH or the sidecar.

Session rows retain the native content/menu split and support Rename, Fork, and
Archive through the existing DSH Client callbacks. The visible `bound` and
`detached` suffixes are removed; Worktree relationship state is represented by
the Worktree row itself.

Session dragging is supported within the current visual group. It uses the
same before/after marker semantics as native DSH rows and calls
`workspaces.insertSessionBefore(workspaceId, sessionId, beforeSessionId)`.
Dragging a Session between Main and a Worktree is intentionally not supported:
that gesture would change the external binding relationship, not merely the
native Session order, and there is no implicit bind/unbind gesture in this
surface.

### Action alignment

Workspace rows, the Main split row, and active Worktree rows share one fixed
trailing action slot. The slot reserves the same width whether its menu is
visible or hidden, so every `+` lands on one vertical alignment line. Search
controls remain outside this tree action grid.

## Worktree status projection

The persisted Worktree lifecycle remains `active` or `removed`. The Host-side
Manager adds a transient health projection while listing Worktrees:

- `active` plus a verified Git Worktree path is ready and renders a green dot;
- `removed` renders a yellow dot and remains expandable for detached Session
  history;
- `active` whose path is absent from the Git Worktree projection, or whose Git
  health check fails, renders a red repair/error dot.

Health is not written to sidecar JSON. The persisted record, schema version,
and binding invariants remain unchanged. If Git health cannot be checked, an
active record is conservatively projected as repair rather than silently
treated as ready. The dot uses the public DSH state-dot primitive and exposes
an accessible status label/title; it is placed immediately before the
Worktree branch/name.

## Client composition changes

The Client entry injects the existing DSH Workspace actions needed by the
surface:

- `renameWorkspace`
- `deleteWorkspace`
- `insertWorkspaceBefore`
- `insertSessionBefore`

These are thin calls to the current `ctx.workspaces` service. Worktree creation,
removal, binding, and Session creation continue to use the existing plugin
Manager flow. No native DSH source or native package implementation changes.

The surface may reuse existing Worktree error rendering for retryable Manager
failures. Rename and Delete dialogs keep their own pending/error state so a
failed mutation cannot close or discard the user's draft. Reorder failures
leave the authoritative DSH projection unchanged and surface a retryable
navigation error without mutating plugin relationships.

## Verification strategy

The implementation will add focused tests before production changes:

1. Pure overlay-bound calculation tests cover the New Session top, footer top,
   zero-height/unavailable-anchor case, and changing geometry.
2. Client source/composition tests cover removal of the mode Tab, dynamic
   overlay observation, native Workspace callbacks, native Session callbacks,
   drag handlers, fixed action-slot alignment, expand-more rendering, removed
   `bound` text, and state-dot mapping.
3. Manage/Provider tests cover active Git path health, missing-path repair
   health, removed Worktree health, and byte-for-byte preservation of sidecar
   and DSH fixtures.
4. Existing Worktree creation/removal, binding recovery, Client Connection,
   Remote contract, and module-boundary tests remain green.

Final verification runs package typecheck, build, full package tests,
workspace/patch checks, and `git diff --check`. The final diff is checked to
ensure no files under the native DSH repository are modified.

## Alternatives rejected

- A fixed CSS height or top offset cannot adapt to external sidebar content,
  sidebar resize, collapse, or viewport changes.
- Replacing the native Sidebar would shadow other plugins and exceed this
  package's additive overlay boundary.
- Persisting a new Worktree health lifecycle in sidecar would conflate a
  runtime diagnostic with the durable `active`/`removed` relationship model.
