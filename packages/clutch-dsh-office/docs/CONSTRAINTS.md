# Office maintenance constraints

This document holds the project constraints and implementation/iteration notes
extracted from the public READMEs. Read it through [AGENTS.md](../AGENTS.md) before
changing Office behavior or assets. Keep the bilingual READMEs focused on product
introduction, installation, features, usage and user-facing requirements. Record
future implementation constraints and iteration details here or in the linked
specialist documents, rather than appending them to the READMEs.

## Integration and native state

- Stay plugin-only: use public DSH services, never modify Harness source or patch
  its private DOM. The DSH checkout is a read-only integration reference.
- The initial compatibility reference is `dsh-v0.2.1-rc.2`. Office uses public
  Session, Workspace, UI Workspace navigation, layout, sidebar, renderer and locale
  services.
- Keep native facts, Session projection, action scheduling/roaming and Three.js
  rendering separate. The Office projection is disposable Client presentation
  state. Do not retain or activate Sessions merely to render characters, read their
  histories, issue model requests, inject prompts or write Session logs.
- Use only Host-listed, nonblank, unarchived, non-subagent Sessions; exclude
  catalog-only rows. Workspace membership comes from native relationships, never
  path guesses. Missing relationships display as Ungrouped.
- The current scene, counter and list share the same active filter: pending
  interaction, running or native unread completion. Pending interaction has highest
  priority, then running, then unread completion. Idle Sessions are hidden; running
  subagents roll up to the parent. The scene admits at most four stable character
  slots, while the list includes all qualifying entries in descending update order.
- “Recent” refers to qualifying entries from the current native list, not an
  additional archive/history query. Native DSH owns unread state; do not persist a
  second unread owner. Merely opening Office or local preview must not acknowledge
  completion. Bubbles and rows navigate through the public native Session API;
  simulated entries do not navigate.
- Offline or disconnected state withdraws stale characters and rows until native
  baselines reconnect. Unknown/disconnected state must not look like completion.
- Display clocks follow the notification bell: native update time on first
  observation, observed running transitions thereafter. Completion time falls back
  to native update time if the transition was not observed. Missing timestamps are
  explicit; these clocks are not authoritative execution logs and do not read
  Session history.

## Presentation and rendering

- The header shows DSH Office, Kitchen Chaos and a version tag derived from
  `package.json`; do not duplicate the package version in documentation or code.
  The scene has no character-count caption. Double-clicking the tag toggles the
  labeled one-to-four-character preview; a single click does nothing.
- Characters use a 75% scene display scale and a bounded aisle graph with pauses,
  turns and peer reservations. Movement is independent of Session state; it does
  not claim actual tool activity, cooking, grabbing or opening the refrigerator.
  This is not a general navigation or crowd engine.
- Characters share model geometry and textures, with independent skeletons,
  animation and automatic blinking. The soft character-only fill keeps faces, blue
  hair and clothing readable in shadow while retaining the kitchen's warm lighting.
- Reduced motion freezes wandering and blinking. Hidden/offscreen scenes pause;
  offscreen canvases release GPU resources and rebuild when visible. Generated
  environment, shadow and cache resources belong to the scene and must be disposed.
- WebGL 2 is required. Shader/context failures expose an explicit reload action.
- Canvas resolution supports DPR 2 with an eight-million-pixel budget, never below
  CSS resolution (or the device ratio when below 1). Very large windows may exceed
  the budget at the CSS floor. Text labels retain native CSS resolution. Animation
  is capped at 30 FPS; this is not a performance guarantee.
- Fixed kitchen lighting is cached at full resolution; characters, their shadows
  and glass remain live. The cache consumes additional GPU memory and is released
  offscreen. Devices without renderable HDR targets keep the full-quality direct
  renderer.
- Kitchen PNG textures use lossless WebP transport; browser WebP decoding is
  required. Small props use 512px GPU textures, larger surfaces and characters up
  to 1024px. Close zooms may reveal less detail; eight-tap soft shadows may have
  coarser edges. Do not claim performance improvements are free of visual or memory
  tradeoffs.

## Asset constraints and iteration references

- Preserve reviewed source projects, original imports and immutable deliveries.
  Builds select reviewed medium derivatives with Meshopt decoding, without loading
  all quality levels. Character skinning, morphs and animation are preserved.
- The adopted character source is `2026-10-29-face-blink-r2`, with independent
  skeletal walking and automatic blinking. The accepted Blender kitchen and warm
  lighting include a separate blue-and-cream mat in front of the refrigerator;
  this does not replace the whale rug.
- The rejected refrigerator refinement is historical and must not be selected by
  default. Preserve its source and delivery for reference; follow the rollback and
  subsequent accepted baselines in AGENTS.md and the specialist documents.
- Camera, lighting, material, layout and asset changes require reading the relevant
  contracts first; this extraction does not authorize changing those contracts.
  The gentle warm window-pane glow, soft coated hood and continuous wooden platform
  rim describe the current reviewed rendering, not permission for further edits.

| Area                                                                          | Maintainer reference                                        |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Current Session dashboard and acceptance history                              | [Session dashboard plan](plans/2026-10-31-session-board.md) |
| Original MVP and historical workspace design                                  | [Office MVP plan](plans/2026-10-26-office-mvp.md)           |
| Source library, immutable imports and acceptance receipts                     | [Blender asset handoff](BLENDER-ASSETS.md)                  |
| Material palette and character shading                                        | [Art direction](ART-DIRECTION.md)                           |
| Camera, lighting, bake dependencies and resource ownership                    | [Lighting design](LIGHTING-DESIGN.md)                       |
| Reproducible high/medium/low derivatives, comparison tool and measured limits | [Model optimization](MODEL-OPTIMIZATION.md)                 |
| Marketplace screenshots, reusing the four README images                       | [Screenshot manifest](../screenshots.json)                  |
| Package release parameters                                                    | [Office release parameters](RELEASING.md)                   |

The Session dashboard plan supersedes workspace-based portions of the original
MVP: the multi-workspace overview, focused-room navigation and activity simulation
buttons are historical. Later active-only filtering, compact title/workspace rows
and the version-tag preview entry take precedence over earlier iterations. Detailed
acceptance evidence stays in the plans, verification documents and existing
AGENTS.md handoffs; technical acceptance is separate from user visual approval.
