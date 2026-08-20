# Worktree Footer Action Visual Design

## Goal

Make the Worktree action in the DSH sidebar footer visually match the native
Settings trigger shown in the supplied reference image while keeping the
existing Worktree mode toggle behavior unchanged.

## Scope

- Update the browser Client footer action in
  `src/client/WorktreeModeAction.tsx`.
- Update its local styles in `src/client/worktree.css`.
- Reuse the DSH primitive `IconBranchOutline16` as the Worktree glyph.
- Preserve the existing `sidebar.footer.action` slot, view-mode store, labels,
  accessibility state, and active-mode behavior.

The DSH source, native Settings implementation, Worktree data model, Remote
surface, and project/session behavior are out of scope.

## Design

When the sidebar is wide, the action is a full-width footer row with the same
geometry as the native Settings trigger: a 42px row, left-aligned content, an
8px gap, a 16px icon, and the `Worktree` label. The row uses the existing
sidebar color tokens and hover background. While Worktree mode is active, the
same background treatment remains visible through the action's existing
`data-active` state.

When the sidebar is collapsed, the action becomes the native 36px rail control:
the label is omitted, the 16px branch glyph is rendered at the rail control
size, and the control is centered in the 56px rail with the native circular
geometry and vertical margins.

The icon and label remain inside the same button so the action keeps one
accessible name and one click target in both sidebar states. The button keeps
its current accessible label, pressed state, title, and view-mode callback.

## Alternatives considered

1. Reuse `IconBranchOutline16` and copy the native Settings row geometry into
   this plugin's local CSS. Recommended: it preserves the slot boundary and
   avoids changing DSH-owned code while matching the native visual language.
2. Register Worktree through `sidebar.settings`. Rejected: it would compete
   with the native Settings owner and change the ownership of the footer seat.
3. Keep the `WT` text marker and only adjust alignment. Rejected: it does not
   provide the requested Git tree/branch affordance or native Settings parity.

## Verification

- Add a focused Client source test before changing production code that checks
  the Worktree footer action uses the branch icon, wide label, and collapsed
  icon-only structure.
- Run the focused Client tests, package typecheck, build, and package test.
- Run `git diff --check` and confirm no DSH source or unrelated package files
  changed.
