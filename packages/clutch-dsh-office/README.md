[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-office

Office turns all DSH workspaces into small 3D kitchens. Up to two whale-girl
characters represent active Sessions in each room, cooking while work runs and
waiting with a bubble when you need to respond. Open **Office** in the sidebar
for the overview, then enter an individual kitchen.

This is a procedural whitebox MVP, with local preview controls for future activities.

## Installation

### Install from npm

The first npm release is pending. After publication, install with:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-office
dsh web
```

Until publication, use the local checkout below. Restart the DSH Web server or
DSH Desktop after installation, then reload the client. Refreshing alone does
not activate a newly added Host plugin.

### Install from a local checkout

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-office build

cd /absolute/path/to/deepseek-harness
pnpm install
pnpm run build
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-office
pnpm dsh web
```

The package's `lib/` is generated. Rebuild and repeat the absolute-path add
command after changing its source or manifest. These commands install a plugin;
no DeepSeek Harness source modifications are required.

## Features

| Feature                      | Preview                                                                                                                            | Behavior                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kitchen list                 | <img src="assets/screenshots/office-overview.png" width="460" alt="Office vertical kitchen list with simulated workspaces">        | One kitchen per native workspace in a single vertical list. Idle kitchens stay visible without characters; active rooms show up to two characters and an overflow count. Screenshot uses the isolated simulated fixture. |
| Real DSH profile acceptance  | <img src="assets/screenshots/office-live-profile.png" width="460" alt="Office vertical kitchen list in the real DSH test profile"> | All native workspaces remain in a vertical list in `~/.dsh-test`, including empty kitchens. Real agent turns and native user questions were also verified.                                                               |
| Session activity and bubbles | Same overview above                                                                                                                | Running Sessions cook. Pending user interactions take priority and show a persistent waiting bubble.                                                                                                                     |
| Focused room and preview     | Same overview above                                                                                                                | Enter a single kitchen or open a clearly labeled local preview to try cooking, waiting, searching, editing, and resting.                                                                                                 |

## Usage

1. Open **Office** in the DSH sidebar.
2. Every native workspace has a kitchen in the vertical list. Characters enter
   when an unarchived, nonblank, non-subagent Session is running or waiting for you.
3. Select **Enter kitchen** for a larger room, and **Back to all kitchens** to return.
4. Select **Open local preview** to try activities without running a real Session.

Existing characters keep their seats while active. Additional active Sessions
are counted; when a seat becomes free, another can enter. Kitchens remain visible when no Sessions are active, with an empty scene and
a **No active sessions** label. Loading and reconnecting state is shown explicitly.

The first live mapping uses running and pending-interaction facts. Searching and
editing are preview activities and extension points, not live tool classification.
Status bubbles contain localized activity labels, not prompts or tool output.
The character roster provides the same status as accessible text.
Character names use native Session titles and update after a rename. When the
browser goes offline or DSH loses its connection generation, live rooms and
counts withdraw until the connection and native baselines are available again.

## Requirements

- DSH Web Client runtime; the initial integration targets `dsh-v0.2.1-rc.2`.
- DSH Workspace Controller, Session Controller/UI hooks, layout/sidebar/renderer
  slots, and locale services declared in `package.json`.
- WebGL 2 and a browser with hardware acceleration.
- For the referenced DSH release, Node.js `^22.19.0 || >=24.0.0`.

`package.json` is the source of truth for package version and dependency ranges.
Real-profile acceptance was also performed in `~/.dsh-test` against the referenced
DSH release. See [verification](docs/MVP-VERIFICATION.md) for the tested scope.

## Limitations

- MVP supports at most two visible characters per kitchen and uses simple
  procedural models and preset movement, without rigged animation or collision.
- Membership follows native Workspace records. Worktree-only virtual membership
  and activity in subagents, jobs, and schedules are not aggregated.
- Native workspace menus and the Worktree plugin's workspace menus do not expose
  an append slot in the referenced version. Use the overview to enter a room.
- Floating mini-windows, detailed tool mapping, project-size decoration, custom
  assets, and persistent room layouts are reserved for later iterations.
- This plugin reads native Client facts without retaining Sessions, opening
  histories, issuing model requests, or modifying project files. Preview state
  is local and disposable.
- Hidden tabs pause animation; offscreen rooms release GPU resources. Reduced
  motion disables continuous animation. WebGL/context failures show a message
  and a **Reload scene** action.

## Development

```bash
pnpm --filter @cerbur/clutch-dsh-office typecheck
pnpm --filter @cerbur/clutch-dsh-office build
pnpm --filter @cerbur/clutch-dsh-office test
pnpm --filter @cerbur/clutch-dsh-office preview
```

The isolated browser fixture runs at `http://127.0.0.1:4188` with simulated
workspaces. Use `?lang=en` for English or `?empty=1` for the empty state.

See [AGENTS.md](AGENTS.md), [MVP plan](docs/plans/2026-10-26-office-mvp.md),
[release parameters](docs/RELEASING.md), and [release log](RELEASE-LOG.md).
The initial MVP is developed directly in its release worktree; subsequent feature
work uses `wt-office-<version>/feat-<name>` and the shared release gates.

## Uninstall

```bash
dsh plugin --profile web remove @cerbur/clutch-dsh-office
```

From a DSH source checkout, use `pnpm dsh plugin --profile web remove` with the
same package name.
