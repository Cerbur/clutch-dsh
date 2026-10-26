# Office MVP

Date: 2026-10-26. Worktree: `wt-office-0.1.0/release`.

Status: framework MVP implemented; focused checks and user-authorized real-profile
acceptance in `~/.dsh-test` passed. See [verification](../MVP-VERIFICATION.md).

## Confirmed direction

Build `@cerbur/clutch-dsh-office` as one package under `packages/`, following
Title's Host/Client packaging. Keep all DSH integration plugin-only. The first
theme is an isometric kitchen with whale-girl characters, initially procedural
whitebox geometry. Build the activity/action seam now; detailed tool mapping,
finished art, project-size decoration, subagents, and a floating mini-window follow.

The user chose an independent overview of workspaces, multiple Sessions
with an initial two-character cap per room, and character-top bubbles at meaningful
moments. The initial MVP is developed directly on the release branch; subsequent
features follow the repository's feature-worktree lifecycle.

## Initial behavior decisions

2026-10-26 revision: the user requested all kitchens remain visible, including
idle workspaces, and a single vertical list instead of a responsive column grid.
Only characters are activity-filtered. The global no-kitchens state now means
there are no native workspaces; a focused room remains when its final actor stops.

- Active means an unarchived, nonblank, non-subagent Session is running or has
  a native pending user interaction. No historical activity-time heuristic.
- Workspace membership comes from the native Workspace account, never guessed
  from path prefixes. Worktree-only virtual membership is a future integration.
- Waiting interactions take precedence over running. Running drives cooking;
  waiting drives an idle/wait pose and a persistent bubble.
- Stable admission preserves the two visible actors while they remain active;
  extra active Sessions are counted rather than arbitrarily displacing them.
- The overview contains one kitchen per native Workspace in a single vertical list
  and a focused room view. Idle kitchens retain the scene with zero characters.
  A clearly labeled local preview works when no real Sessions are active.
- Native state loading/failure is visible. No Session retain, history open, run,
  prompt, or storage mutation is required to render an Office.
- Activity types and action scheduling are renderer-independent; future searching
  and editing signals can choose refrigerator and stove stations without changing
  DSH state ownership. Concurrent actors have separate station positions.
- Bubbles contain localized status, not raw prompt/tool output. Character labels
  use native title projections where available and a short id otherwise.
- Pause animation for hidden documents/offscreen canvases; honor reduced motion,
  cap device pixel ratio, dispose all GPU resources, and show WebGL failure visibly.

## Integration evidence

Read-only reference: `/Users/yuancheng/Documents/Code/deepseek-harness`, tag
`dsh-v0.2.1-rc.2`. Native `main` keyed slot and `sidebar.panellist` provide the
overview. Workspace Controller list and root Session hooks provide membership and
status. `session/event`, `tool/call`, and PTC dispatch events can support later
Host-side classification; the initial MVP needs no custom Remote.

There is no append-only native Workspace menu slot in this DSH version. The
Worktree plugin's Workspace menu is also hard-coded in its row component. Do not
modify either for this MVP; expose focused-room navigation within Office.

## Delivery and validation

1. Package manifests, lifecycle conventions, bilingual docs, root catalog entry.
2. Pure workspace/active-actor projection and activity-to-action planner.
3. Native main/sidebar registration and overview/focused-room/preview UI.
4. Procedural kitchen and two whale girls, poses, movement, bubbles, cleanup.
5. Focused behavioral tests; package typecheck/build/lint; workspace/patch guards;
   real browser preview and screenshot. Validate native registration against DSH's
   actual Slot runtime. The user subsequently authorized installation and real
   acceptance in `~/.dsh-test`; the production `~/.dsh` remains untouched.

## Implementation notes

The Client compiler maps Cordis and UI Slots type imports to this package's
direct pinned declarations. The workspace contains older plugins with other
Cordis peer graphs; without this type-only convergence, their duplicate SlotMap
identities split declaration merging on a frozen-lockfile install. Runtime
Cordis/React/UI Slots remain DSH's shared browser modules, not bundled copies.
Other packages' existing lockfile importers and dependency snapshots are preserved.

The procedural scene has explicit GPU teardown and a Reload scene action after
WebGL/context failure. The native SlotRegistry lifecycle is tested with the
published DSH renderer bundle; the browser fixture uses simulated workspaces.
Real-profile testing found and corrected two integration issues: native title
projections are strings and already have list labels; cached domain baselines do
not establish current connectivity. Office now uses native titles and requires an
online browser plus connected generation before showing live rooms/counts.

## Deferred scope

Workspace context-menu append and mini-window, detailed live tool classification,
GLB assets and rigged animation clips, arbitrary character counts, full navigation
and collision, persistent room customization, filesystem scanning, and Worktree
virtual-workspace membership. File count will represent project scale rather than
claiming to measure complexity.
