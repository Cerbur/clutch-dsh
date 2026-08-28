# Workspace Add Button Native Icon

## Scope

Replace the plus icon inside the Worktree surface search-row button labeled
`workspace.add` / `添加工作区` with the native DSH Workspace-add icon supplied in the
feature request. Preserve the button's click handler, accessible label, size, and layout.

The separate per-Workspace `添加 Worktree` action is out of scope and keeps its existing
icon.

## Implementation

Use the corresponding exported icon from `@deepseek-ai/dsh-client-ui-primitives`:
`IconProjectAddOutline16`. Its geometry is the supplied native 16×16 SVG, so no local SVG
or runtime dependency is required.

## Verification

The client-surface regression assertion proves that the Workspace-add button renders the
native Project-add icon. Package typecheck and the full package test suite must pass.
