# Sidebar presentation and desktop compatibility

This decision supersedes the collapsed-only material in
`superpowers/plans/2026-09-28-worktree-sidebar-glass.md`. That proposal left the expanded
panel opaque to hide native rows and exposed glass after collapse. In current macOS DSH,
collapse removes the Sidebar track entirely; the plugin must disappear with it.

## One continuous macOS material

DSH AppFrame already paints a translucent tint over the native window's vibrancy.
The plugin does not create OS vibrancy, change window settings or modify DSH source.
Instead, it reversibly conceals the native direct children covered between New Session
and the footer, leaves native chrome and footer alone, and gives its own overlay no
background or extra backdrop filter on macOS. This avoids stacked fills, sharp native
rows showing through and a filter containing block interfering with native menus.

Visibility, opacity, inert and aria-hidden are restored on collapse, mode exit, DOM replacement,
anchor loss and disposal. Hidden native content stays mounted and measured. If the
structure cannot be recognized, the overlay keeps its theme fill or zero coverage.
Web, Windows and Linux keep their theme fill; CSS alone cannot reproduce macOS OS-level
window vibrancy there. Reduce Transparency uses a stronger theme fill.

The native Workspace header explicitly sets visibility on some descendants. Parent
opacity is therefore also suppressed while covered; visibility alone would let that
header ghost through the transparent plugin surface.

On Web, the brand is a New Session shortcut with the same aria-label as the dedicated
action. Shortcut glyphs appended to the latter's textContent defeat exact visible-text
matching, causing the old fallback to select the brand and cover its entire logo/toggle row.
Anchor selection now excludes buttons within native `data-window-drag` chrome rows.
The dedicated action below chrome remains the measured start on Web and desktop, even
with shortcut text. A missing dedicated action yields zero coverage instead of consuming
native chrome. This requires no Web-specific hard-coded height or DSH source change.

## Tree rhythm and alignment

Aligned with the DSH UI/UX standard (`dsh-ui-ux-design-standard.md` §1 axis alignment,
§7 radius by component role, §8 hairline dividers and weight ceiling, §10 spacing review).

One ruler drives the whole tree, declared once on `.workspaceList`:

```text
--wt-step       12px   indent per level
--wt-lead       20px   leading cell (the disclosure overlays the type icon here)
--wt-label-pad   6px   gap between the leading cell and its label
--wt-row-inset   4px   row inset from the content edge
```- Depth comes from explicit nesting selectors (`.treeChildren`,
  `.treeChildren .treeChildren`, …) rather than a self-referencing custom property:
  `--d: calc(var(--d) + 1)` is a cycle and resolves to invalid, which would silently
  flatten the tree.
- Containers carry no horizontal offset and no guide rail. Rows own their inline padding,
  so every level is exactly one `--wt-step` deeper and rows stay full width — hover fills
  and drop markers share the group row's right edge instead of stopping 20px short.
- Labels share one column per depth: `4px + depth × 12px + 20px + 6px`, i.e. 30 / 42 / 54.
  A Session label lands on its group label's column instead of 6px to its left.
- Every leading cell is 20px, so the 16px folder/branch glyphs and the 14px twisty share
  one vertical axis per depth. The disclosure sits over the icon's own cell and swaps with
  opacity, so revealing it never moves the label, and it stays keyboard reachable while
  invisible (`:focus-visible` / `:focus-within`). Its hit target is 24×24, shifted 2px left
  of the 20px lead cell so the glyph stays on the same axis. Touch devices keep the
  disclosure visible because there is no hover phase.
- Rows sit in the standard control band (34 / 32 / 30px) and share `--dsw-radius-md`.
  The activity lane is reserved by the row (`padding-inline-end: calc(inset + 32px)`) and
  the action rail is anchored out of flow, so hover reveals no longer reflow the label.
- Emphasis stays at weight 500 (functional CSS carries no 600+); new dividers use 0.5px.

Known gap (follow-up): the pre-existing mixed `:hover` / `[data-menu-open]` /
`:focus-within` action-reveal groups still live outside `@media (hover: hover)`. The
disclosure itself is gated and has a touch fallback; the remaining action rail needs paired
CSS and test updates, so it is tracked separately instead of being half-applied here.

## Native-style tree motion

`AnimatedTree` uses React pre-commit snapshots and the Web Animations API. Workspace,
Main, Worktree and Session rows have stable browser-local keys. Revealed/new/removed
rows fade over 100ms; displaced rows move over 200ms with the `--ds-ease-in-out` curve. Inert, aria-hidden
exit clones are presentation only. Motion starts after input inside the list, and
initial loading, search, drag and Reduce Motion settle immediately. Metadata-only
updates preserve in-flight animations. Offscreen rows do not start motion, and disposal
cancels all animations and removes clones.

The plugin implements this behavior itself because DSH's AnimatedRows is an internal
module rather than a public plugin export. It does not import that file or write DSH code.

## Vertical Workspace tabs

Workspaces are the tree's top-level navigation, so they read as a left-hand vertical tab
list rather than several simultaneously open sections. `openWorkspaceExclusive` writes one
draft that clears the selected Workspace from `collapsedWorkspaceIds` and marks every other
known Workspace collapsed. The open tab owns the Main/Worktree/Session body; activating
another tab replaces it, and activating the open tab closes the body. A current-Session
reveal wins for the first render and the follow-up layout effect persists that single tab,
so navigating between Sessions never paints two open Workspaces.

The active tab keeps the native row radius and reuses the native hover fill; the label stays
at weight 500. No custom accent bar is drawn, so the open state composes from the same
`interactive-bg-*` and label tokens as native DSH rows. Closed tabs reserve the existing
28px action rail for one aggregated `StateDot` with the native state mapping: running renders
the spinner, a pending-interaction state renders the warning (yellow) dot, and an unread
completion renders the success (green) dot. The localized status label stays on the tab for
assistive technology and hover. Worktree health remains a separate leading indicator, and
Main/Worktree group rows use the same native aggregate mapping.

The disclosure follows the distilled rules in
`dsh-workspace-todos/docs/panel-ui-rules.md`: 13px text on the 20px line, 24×24 hit target,
the shared focus-ring tokens, `--ds-transition-duration` with `--ds-ease-in-out` for
the transform-only arrow rotation, a pressed `interactive-bg-active` fill, and hover feedback
kept inside `@media (hover: hover)`.

## Collapse and Dashboard

Sidebar geometry accepts 0px (macOS) and 56px (Web rail), observes the frame's semantic
collapse attribute, and follows replaced native roots. CSS hides the overlay as soon
as the native frame reports collapse, before a width transition finishes.

The Session header sets Dashboard selection independently of Sidebar visibility.
Previously, the selection was cleared if the initial Workspace read had not returned
its Worktree yet. Now it remains pending until facts arrive, shows a center loading or
retryable error page, and opens automatically on that first request. Retry reads only
the owning Workspace. A different Session, mode exit or confirmed target removal
still cancels selection. No Sidebar expansion command is used.

## Dashboard window chrome

The sticky full-width top bar shows `{workspace}/{worktreeName}` and groups Open In,
return/create Session and rightbar controls. Its `data-window-drag` marker uses the
native macOS drag/geometry-recall mechanism; the action cluster is explicitly no-drag.
The loading/error page uses the same chrome presentation.

On collapsed macOS frames, scoped plugin CSS raises the existing `data-shell-leading`
seat from native z-index 15 above `shell.overlay` (20) to 21. The title clears its
published `--dsh-frame-leading-clearance` after subtracting the live Dashboard left
offset. This reuses the native reopen/New Session buttons, their shortcuts and fullscreen
spacing, and the CSS ceases to match when the Dashboard closes. No DSH source, native
slot registration or Sidebar state is replaced. Windows placement clears the native
center's top offset so its caption buttons and drag strip remain uncovered.

## Verification

The regressions exercise the actual geometry hook, WorktreeSurface selection effects
and AnimatedTree commit lifecycle. They cover 0px collapse, Web rail width, reopening,
native-content restoration and replacement, first-click pending Worktree/Main requests,
read failure, confirmed removal, fades/movement, interruption and Reduce Motion.

Run the standard package gates from AGENTS.md. For a quick presentation regression:

```bash
node --test test/client-sidebar-compat.test.mjs test/client-sidebar-motion.test.mjs test/sidebar-glass.test.mjs
```
