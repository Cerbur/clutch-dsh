# Worktree Sidebar Glass Surface

## Decision

Implement the approved Option A as a plugin-only visual treatment. Keep DSH native Sidebar and AppFrame; do not replace the shell, introduce a second navigation surface, or modify the DSH checkout.

The screenshot shows WorktreeSurface, the plugin-owned shell.overlay panel that occupies the Sidebar column while Worktree mode is active. Its own .surface class had an opaque theme fill, so styling the native AppFrame column underneath it was invisible. Apply the glass material directly to .surface only when the native Sidebar is collapsed: DSH already supplies a 40%-50% native tint, so the overlay uses a much lighter 22% theme tint and a subtle wash instead of stacking a second opaque layer. Keep the Worktree surface opaque while the native Sidebar is expanded to avoid ghosting its rows. Supported reduced-transparency mode remains opaque.

This changes presentation only: no Worktree state, navigation, Session data, or host behavior changes. The material is owned by the plugin overlay and follows the native collapse state.

## Verification

- Add source and emitted-bundle tests for the collapsed-only overlay material and opaque expanded fallback.
- Run the package build, typecheck, tests, and bilingual README parity checks.
