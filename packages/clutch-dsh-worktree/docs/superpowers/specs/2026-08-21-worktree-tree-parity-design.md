# Worktree Tree Native Parity Design

## Goal

Make the Worktree browser's Workspace, Worktree, Main, and Session tree rows
match the native DSH sidebar in interaction, typography, and trailing `+`
alignment, without changing DSH source or the plugin's data boundaries.

## Scope and boundaries

The change is limited to the browser Consumer in
`src/client/WorktreeSurface.tsx`, `src/client/worktree.css`, and focused Client
surface tests. Worktree/session creation, binding, ordering, sidecar storage,
and DSH Workspace/Session APIs remain unchanged.

The attached screenshots are visual references only. Native behavior is taken
from DSH's Workspace row implementation: the row itself toggles its group,
while the leading folder/chevron affordance changes on hover.

## Interaction design

`WorktreeWorkspaceRow` will make the entire Workspace row the disclosure
target. Clicking the row toggles the existing browser-local
`expandedWorkspaces` state. The menu and Workspace `+` stop propagation so
their actions do not also toggle the row. The existing disclosure control
continues to expose `aria-expanded` and an accessible label; it delegates to
the same toggle path without causing a double toggle.

The leading Workspace affordance follows native DSH CSS: the folder is shown
at rest, and the chevron becomes visible on row hover while the folder is
hidden. The row remains keyboard reachable through its existing interactive
controls, and the visible hover affordance does not change the underlying
Workspace expansion state.

## Typography and row metrics

The tree uses the native DSH text metrics:

- Workspace and Worktree titles: `14px`, `400`, `20px` line height.
- Session titles: `14px`, `400`, `20px` line height.
- Session overflow action: `12px`, regular weight.
- `MAIN` group label: `10px`, `600`, uppercase, with the existing native letter
  spacing.
- Search input copy: `13px`, matching the native search field.

Existing semantic DSH color tokens remain in use. No literal color palette or
new UI primitive is introduced.

## Trailing action alignment

Workspace rows, the Main header, and active Worktree rows use one explicit
fixed-width trailing action rail. The rail has a stable `64px` width and the
visible `+` anchor is positioned against the same right edge in every row.
The menu slot remains reserved when its menu is hidden, so showing or hiding
the ellipsis cannot move the `+`. The nested Worktree tree keeps the same
content right edge as the Workspace row; no per-row `translateX` adjustment is
used.

The existing 28px button hit area is retained for accessibility. Alignment is
defined by the rail and anchor edge, not by the SVG's visual bounds.

## Testing strategy

Before production changes, add focused source/CSS regression assertions to
`test/client-surface.test.mjs` covering:

1. Workspace row click wiring and propagation guards for menu/`+` actions.
2. Hover-only folder/chevron presentation.
3. Native font-size, font-weight, and line-height declarations for tree text.
4. A shared fixed action rail and a common right-edge anchor for Workspace,
   Main, and Worktree `+` controls.

Run the focused Client tests after the new assertions to confirm they fail for
the current implementation, then make the smallest source/CSS changes needed
to pass. Finish with the package typecheck, build, test suite, and
`git diff --check`.

## Non-goals

- No change to DSH source or native package code.
- No change to Worktree/session data, RPC contracts, binding semantics, or
  browser view-mode persistence.
- No new component library, layout dependency, or visual mode.
