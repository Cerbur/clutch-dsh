# Worktree UI Polish Design

## Goal

Correct four small presentation issues in the browser Worktree surface:

1. Revealing the disclosure control on hover must not move the Worktree row
   content horizontally.
2. The Main Worktree label must render as `MAIN` with a stronger weight.
3. The Worktree health indicator must sit closer to its branch/name label.
4. A truncated Worktree name must be readable in the same native hover card
   style used by DSH.

The attached screenshots are visual references only. They do not add product
or implementation instructions beyond the user's request.

## Decisions

### Row geometry

The branch/tree icon slot and disclosure slot in `.worktreeRow` will both be
`22px` wide. The existing Workspace row geometry remains unchanged. This keeps
the icon and hover-only disclosure replacement identical in width, so showing
the disclosure control cannot shift the label or trailing action rail.

The health indicator container will change from `16px` wide with a `2px`
right margin to `12px` wide with no right margin. The existing `StateDot`
primitive and semantic state colors remain unchanged.

### Main Worktree presentation

The existing parameterized `WorktreeGroupRow` and `data-main-group` marker will
be reused. CSS will apply uppercase transformation and a stronger font weight
only to the Main Worktree label. Workspace titles and ordinary Worktree labels
will not be modified.

### Native hover card

The browser Consumer will import the DSH primitives `HoverCard` and use a
Worktree row as its anchor only for `kind="worktree"`. The card will open after
the native `500ms` delay and display the complete Worktree branch/name in a
small card-content element. It will be disabled while the Worktree menu is
open, matching the native row interaction pattern. No `title` attribute,
transport call, persisted state, or new data field is needed.

### Regression coverage

The existing source-level Client surface tests will assert:

- Worktree icon/disclosure geometry is explicitly `22px`.
- Main-only uppercase and font-weight rules exist.
- The health indicator uses the shortened spacing values.
- `HoverCard` is imported and wraps the Worktree presentation with the
  complete label as its content.

The package's existing build, typecheck, and test commands remain the final
verification surface. No DSH source or unrelated plugin package will change.

## Expected file changes

- `src/client/WorktreeSurface.tsx`: add the native hover-card wrapper for
  Worktree rows.
- `src/client/worktree.css`: adjust row slots, Main-only typography, health
  spacing, and hover-card content text.
- `test/client-surface.test.mjs`: add focused source/CSS regression assertions.
- `src/client/README.md`: document that Worktree labels use the native hover
  card when presented in the Worktree tree.

