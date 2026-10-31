# clutch-dsh-office

English | [简体中文](README.zh.md)

Kitchen Chaos is a shared 3D kitchen for active DeepSeek Harness Sessions. Active Sessions, pending
interactions and unread completions appear as whale girls, up to four at once.
Only active, pending-interaction or unread Sessions appear in the list below the scene; idle Sessions are hidden.

## Installation

### Install from npm

The first npm release is pending. After publication:

```bash
dsh plugin --profile web add @cerbur/clutch-dsh-office
dsh web
```

### Install from a local checkout

```bash
cd /absolute/path/to/clutch-dsh
pnpm install
pnpm --filter @cerbur/clutch-dsh-office build

cd /absolute/path/to/deepseek-harness
pnpm dsh plugin --profile web add /absolute/path/to/clutch-dsh/packages/clutch-dsh-office
pnpm dsh web
```

Restart DSH Web or Desktop after installation and asset changes, then reload the
client. The plugin uses public DSH services; no Harness source changes are needed.

For Windows source checkouts, use your local Windows paths and rerun the build after
pulling updates before restarting DSH. Reloading the page alone does not rebuild assets.

## Features

| Feature                       | Preview                                                                                                                                                           | Behavior                                                                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One shared kitchen            | <img src="assets/screenshots/office-session-board.jpg" width="600" alt="Kitchen Chaos header and four simulated Session characters in labeled local preview">     | A full-width scene replaces per-workspace kitchens. The top-right count includes all Sessions needing attention; at most four characters roam in the kitchen. Overflow remains in the active list.                                                      |
| Persistent Session bubbles    | Same view above                                                                                                                                                   | Every character has a persistent title, workspace and status bubble. Click it to open that native Session. Long titles remain available in the tooltip and complete list.                                                                               |
| Active Session list           | <img src="assets/screenshots/office-session-list.jpg" width="600" alt="Labeled local preview: four active Session states, with no idle rows">                     | Newest updates first, with title and workspace. Running rows show a spinning indicator and elapsed time; unread completions show completion time. Pending interactions retain their status. The list is not limited to four and excludes idle Sessions. |
| Whale-girl models and preview | <img src="assets/screenshots/office-character-soft-fill.jpg" width="600" alt="Local preview: four simulated whale girls with softer, brighter character shading"> | Uses the `2026-10-29-face-blink-r2` asset with independent skeletal walking and automatic blinking. A clearly labeled local preview shows one to four simulated characters without changing real Sessions.                                              |

The Session and character screenshots use the labeled local preview; their four entries are simulated.

The plugin marketplace screenshot list is maintained in [screenshots.json](screenshots.json), using the same four documentation images.

| Kitchen rendering                    | Preview                                                                                                                                                                                  | Behavior                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Softer surfaces and lighter geometry | <img src="assets/screenshots/office-optimized-kitchen.jpg" width="600" alt="Optimized empty kitchen with restrained window light, coated range hood and continuous wooden platform rim"> | Uses reviewed medium geometry with Meshopt decoding. The window keeps a gentle warm pane glow, the hood uses a soft coated finish, and the wooden rim avoids baked seam lines. |

Whale girls use a soft character-only fill to keep their faces, blue hair and clothing
readable in shadow while retaining the kitchen's warm lighting.

Rendering uses a bounded pixel budget and lighter soft shadows. Characters share model
geometry and textures while keeping independent skeletons and blinking. Kitchen PNG
textures use lossless WebP transport; small props use smaller textures on the GPU.

## Usage

The header shows **DSH Office**, a version tag derived from `package.json`, and **Kitchen Chaos**. The scene has no character-count caption.

1. Open **Office** in the sidebar. There is one kitchen and one active Session list.
2. Running, pending-interaction and unread-completed Sessions each qualify for a
   character. Pending interactions take priority over running, followed by unread
   completion. Native running subagents roll up to their parent instead of creating
   separate characters.
3. Characters keep their visual slots while eligible. The first four are admitted;
   later arrivals wait for a free slot. The counter and list include overflow.
4. Click a character bubble or a list row to open its native Session. Merely opening
   Office or local preview does not acknowledge unread completions; DSH owns read state.
5. Double-click the version tag to toggle a labeled one-to-four-character local
   preview. Double-click it again to return to live Sessions; a single click does
   nothing. Simulated bubbles and rows do not navigate.

The previous multi-workspace overview, focused-room navigation and activity
simulation buttons are superseded by this shared Session dashboard. Characters
wander independently of Session status; their movement does not claim tool activity,
physical cooking, grabbing or opening the refrigerator.

## Requirements and limits

- DSH Web Client, initially tested with `dsh-v0.2.1-rc.2`, and the public Session,
  Workspace, UI Workspace navigation, layout, sidebar, renderer and locale services.
- Only Host-listed, nonblank, unarchived, non-subagent Sessions are shown. Catalog-only
  rows are excluded. An unavailable workspace relationship is labeled **Ungrouped**.
- “Recent” means qualifying active entries from the current native list, not a separate archive/history query.
  Office does not retain Sessions, read their histories, issue model requests or write
  their logs to build this projection. It does not persist a second unread owner.
- Offline or disconnected state withdraws stale characters and list rows until native
  baselines reconnect. Display clocks follow the notification bell: native update time on first observation, observed running transitions thereafter. Completion time uses the native update time when the transition was not observed; it is not an authoritative execution log. Missing timestamps are shown explicitly.
- The four-character scene uses a 75% display scale and a bounded aisle graph with
  pauses, turns and peer reservations. It is not a general navigation or crowd engine.
- Reduced motion freezes wandering and blinking. Offscreen/hidden scenes pause;
  offscreen canvases release GPU resources and rebuild when visible.
- WebGL 2 is required. Shader or context failures show an explicit reload action.
- Canvas resolution supports DPR 2 with an eight-million-pixel budget and never falls
  below CSS resolution (or the device ratio when below 1). Very large windows can exceed
  that budget at the CSS floor. High-resolution animation costs more GPU time; 30 FPS
  is a ceiling, not a guarantee. Text labels keep native CSS resolution.
  Fixed kitchen lighting is cached at full resolution; characters, their shadows and
  glass stay live. The cache uses additional GPU memory and is released offscreen.
  Devices without renderable HDR targets retain the full-quality direct renderer.
  Small props use 512px textures, larger surfaces and characters
  up to 1024px. Close zooms may show less detail, and eight-tap soft shadows can show
  coarser edges. WebP image decoding is required for the packaged kitchen.
- The accepted Blender kitchen and warm lighting remain in place, including the independent blue-and-cream floor mat in front of the refrigerator; the whale rug stays in place. The rejected fridge
  refinement is not used. Source projects and original imports are retained; builds select
  separately reviewed medium derivatives without loading all quality levels. Character
  skinning, morphs and animation are unchanged. See [asset handoff](docs/BLENDER-ASSETS.md).

## Development

Reproducible high/medium/low generation, the local model comparison tool and measured
geometry limits are documented in [model optimization](docs/MODEL-OPTIMIZATION.md).

```bash
pnpm --filter @cerbur/clutch-dsh-office typecheck
pnpm --filter @cerbur/clutch-dsh-office build
pnpm --filter @cerbur/clutch-dsh-office test
```

The [Session dashboard plan](docs/plans/2026-10-31-session-board.md) supersedes the
workspace-based portions of the original MVP plan. Native facts, Session projection,
roaming and Three.js rendering are separate modules. Camera and lighting contracts
remain documented in [lighting design](docs/LIGHTING-DESIGN.md).
