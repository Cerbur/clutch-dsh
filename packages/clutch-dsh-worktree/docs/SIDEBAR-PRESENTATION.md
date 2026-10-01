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

## Native-style tree motion

`AnimatedTree` uses React pre-commit snapshots and the Web Animations API. Workspace,
Main, Worktree and Session rows have stable browser-local keys. Revealed/new/removed
rows fade over 100ms; displaced rows move over 200ms with ease-out. Inert, aria-hidden
exit clones are presentation only. Motion starts after input inside the list, and
initial loading, search, drag and Reduce Motion settle immediately. Metadata-only
updates preserve in-flight animations. Offscreen rows do not start motion, and disposal
cancels all animations and removes clones.

The plugin implements this behavior itself because DSH's AnimatedRows is an internal
module rather than a public plugin export. It does not import that file or write DSH code.

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
