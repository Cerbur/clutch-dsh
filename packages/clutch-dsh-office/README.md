[English](README.md) | [简体中文](README.zh.md)

# @cerbur/clutch-dsh-office

Office turns all DSH workspaces into small 3D kitchens. Up to two whale-girl
characters represent active Sessions in each room, cooking while work runs and
waiting with a bubble when you need to respond. Open **Office** in the sidebar
for the overview, then enter an individual kitchen.

This MVP uses bundled Blender
models for the rounded timber-and-tile floor, both walls, pendant light, sink cabinet, refrigerator, preparation
table, storage cabinet, wall-mounted utensil rail, stove, blue wall cabinet, range hood,
double wall shelf, an opaque decorative window, whale artwork, two stools, a whale rug, a whale oven mitt, wooden wall clock, board-and-cloth hooks, hanging planters, a whale calendar and an independent pedal bin
and DeepSeek whale-girl character. The shared art direction uses cream, soft blue
and honey wood, with coordinated PBR surfaces. Three broad studio softboxes based on the Blender review, a charcoal background, soft shadows,
color-preserving tone mapping and environment reflections shape the diorama. Local preview controls
exercise the future activity mapping without running a DSH Session.

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

| Feature                            | Preview                                                                                                                                    | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kitchen list                       | <img src="assets/screenshots/office-overview.png" width="460" alt="Office vertical kitchen list with simulated workspaces">                | One kitchen per native workspace in a single vertical list. Idle kitchens stay visible without characters; active rooms show up to two characters and an overflow count. Screenshot shows the actual local test profile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Session activity and bubbles       | Same overview above                                                                                                                        | Running Sessions cook. Pending user interactions take priority and show a persistent waiting bubble.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Focused room and preview           | Same overview above                                                                                                                        | Enter a single kitchen or open a clearly labeled local preview to try cooking, waiting, searching, editing, and resting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Blender kitchen set                | <img src="assets/screenshots/office-candy-s3a-overview.jpg" width="460" alt="Focused Office kitchen with the bundled Blender furniture">  | Models share the soft-toy palette and PBR surfaces, following the reference layout: stove and hood on the left, blue wall cabinet beside the hood, rear sink, refrigerator on the right, table in front, utensils on the left wall, a raised window on the left and lower shelving with trailing greenery on the right, whale artwork, the previously accepted right-edge table position, two stools, whale rug, pedal bin beside the fridge and a separate pendant. The sink run fills the rear corner at 3.08 m wide and 0.80 m deep, keeping counter height; the new cart is a static textured assembly at the platform’s front-left edge. Five new wall decorations fill the cool wall areas; two planters reuse one resource with different wall-facing rotations. The new hood matches the 1.374 m hob area, excluding the side cupboards; the wall cabinet, sink window, artwork and pendant follow the reference. The elongated stove countertop is about 3.247 m long and 1 m deep, forming a level L with the sink’s left module; a thin countertop cap clears the sink handles. Loading failures retain the procedural whitebox fallback. |
| DeepSeek whale-girl characters     | <img src="assets/screenshots/office-candy-s1-search.png" width="460" alt="Two DeepSeek whale-girl characters in the Office local preview"> | Up to two independently positioned DeepSeek models represent active Sessions, with separate status bubbles. Whole-body movement and a slight idle bob preserve the static mesh contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Reduced motion and offscreen rooms | <img src="assets/screenshots/office-reduced-motion.png" width="460" alt="Office kitchen with reduced motion enabled">                      | Bundled GLBs still appear with reduced motion enabled; offscreen room canvases release GPU resources and are recreated when visible.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Usage

1. Open **Office** in the DSH sidebar.
2. Every native workspace has a kitchen in the vertical list. Characters enter
   when an unarchived, nonblank, non-subagent Session is running or waiting for you.
3. Select **Enter kitchen** for a larger room, and **Back to all kitchens** to return.
   Kitchens use an orthographic camera with symmetric 45-degree azimuth and the Blender review’s 26.74-degree elevation,
   taller scene panels and a wider page layout. The room shell is approximately
   5 m wide/deep and 3.5 m high; furniture and characters retain their authored size except the sink run fitted in width/depth to the rear corner and the hood fitted only in width to the hob.
4. Select **Open local preview** to try activities without running a real Session.
   Choose **Find ingredients** to watch the character turn, walk around the table to
   the refrigerator, and face it on arrival. Choose another activity to return.

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
DSH release. See the latest [kitchen asset acceptance](docs/STORAGE-SINK-VERIFICATION.md)
for the tested scope.

## Limitations

- The rounded timber floor uses baked wood grain and tile normals. Grout relief affects
  lighting, not geometry/collision depth; the ceramic insert has a rounded silhouette with 52 triangles.

- Both walls are plain matte cream, with rounded edges and the same nominal
  0.285 m thickness as the platform. Their outer edges align with the platform. No wall textures are included. A separate opaque decorative window sits above the sink; it has no wall opening, transmission or opening animation.

- Walls and floor retain Blender Cycles baked diffuse and indirect light; furniture and characters use realtime PBR, a weak front softbox and a low-resolution directional room environment that lifts shadow colors. This global environment approximation has no spatial occlusion. Furniture avoids fragmented lightmap seams. Rebuild the bake after changing source assets, layout or baked lights. See [lighting design](docs/LIGHTING-DESIGN.md).

- MVP supports at most two visible characters per kitchen. All kitchen furniture and decorations are bundled GLBs, including
  the floor, both walls, pendant light, sink cabinet, refrigerator, table,
  storage cabinet, utensil rail, stove, wall cabinet, range hood, shelf, artwork, stools, rug, decorative window and pedal bin. DeepSeek is a static
  single mesh with whole-body movement and a slight idle bob, without a rig,
  articulated arms/tail, reaching animation, or general collision/navigation.
- Twenty-four source GLBs total about 49.19 MiB. Production binaries load on demand through the plugin’s authenticated, allowlisted asset route; the Client script is about 2.01 MB. The scene lightmap uses a 16 MiB RGBA atlas. Runtime model textures cap at 1024px; original source textures remain unchanged. Build and restart the DSH Web server after asset changes.
- The sink run uses a scene-only width/depth fit; attached taps, towels and props scale with it.
- The new storage cart is one static mesh with no independent wheel pivots or movable props.
- The updated sink is one static assembly; its former independent doors/drawer are absent.
  The replacement DeepSeek character retains its new source appearance and static capability.
- Table utensils and cabinet contents are static groups; table anchors do not provide manipulation or wheel animation. The new stove is a static assembly without independent door/drawer pivots, cookware or blue flames. Wall-cabinet doors remain closed and the hood is static. The mitt, wooden clock, board-and-cloth hooks, hanging pots and calendar are static decorations; the clock/calendar do not track live time or date. The two wall pots share one parsed GLB per room, mounted with different orientations on the two walls. New decorations stay outside the stove and hood area. The two stools share one asset and
  do not add a sitting animation.
- Membership follows native Workspace records. Worktree-only virtual membership
  and activity in subagents, jobs, and schedules are not aggregated.
- Native workspace menus and the Worktree plugin's workspace menus do not expose
  an append slot in the referenced version. Use the overview to enter a room.
- Floating mini-windows, detailed tool mapping, project-size decoration, custom
  assets, and persistent room layouts are reserved for later iterations.
- This plugin reads native Client facts without retaining Sessions, opening
  histories, issuing model requests, or modifying project files. Preview state
  is local and disposable.
- Empty kitchens redraw only when needed; animated characters draw at up to 30 FPS. Static shadow maps are cached, while the character key-shadow updates on baked walls/floor. Character shadows on realtime furniture and self-shadowing are omitted.
- Hidden tabs pause animation; offscreen rooms release GPU resources. Reduced
  motion disables continuous animation. WebGL/context failures show a message
  and a **Reload scene** action.

## Development

The toy look follows a [three-stage spec](docs/specs/2026-10-28-kitchen-candy-look.md) and [execution plan](docs/plans/2026-10-28-kitchen-candy-look.md). Stage 1 lighting and Stage 2 surface tuning across the kitchen have passed technical verification. Wood, fabric, foliage, skin and metal retain distinct responses; the matte walls and rug stay matte. Bevel/geometry corrections remain the next stage, and final visual approval is pending.

```bash
pnpm --filter @cerbur/clutch-dsh-office typecheck
pnpm --filter @cerbur/clutch-dsh-office build
pnpm --filter @cerbur/clutch-dsh-office test
pnpm --filter @cerbur/clutch-dsh-office preview
pnpm --filter @cerbur/clutch-dsh-office lighting:geometry /tmp/office-bake/geometry.json
pnpm --filter @cerbur/clutch-dsh-office lighting:import /absolute/delivery/manifest.json
```

The isolated browser fixture runs at `http://127.0.0.1:4188` with simulated
workspaces. Use `?lang=en` for English or `?empty=1` for the empty state.

Blender sources follow `office/<scene>/<component>` in a separate asset library.
The current refrigerator has no pink side planter or complete interior. Material
revisions preserve original shapes and texture details. The refrigerator and top whale
use localized soft-gloss coating while leaves, pottery and metal retain their response;
existing baked color shading and reconstruction imperfections remain. The range hood uses corrected surface normals to reduce triangular shading while retaining its shape and textures. See the [shared art direction](docs/ART-DIRECTION.md).

See [asset handoff](docs/BLENDER-ASSETS.md) for revisioned import and
[latest acceptance](docs/STORAGE-SINK-VERIFICATION.md) for the real-page checks.

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
