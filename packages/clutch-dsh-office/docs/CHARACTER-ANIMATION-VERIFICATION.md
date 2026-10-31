# Whale-girl kitchen animation · 2026-10-30

Working-tree integration in `wt-office-0.1.0/release`; no commit, push or publication.
The immutable source is `office/character/deepseek/deliveries/2026-10-29-face-blink-r2`.

The adopted GLB has SHA256 `eea3bc03f99ea735948a8e33c108b3ae5eb2bbb860651d4bc217421a604bc003`,
7,172,924 bytes, 57,002 triangles, one 31-joint skin, three primitives/materials,
four embedded images and four eyelid morph targets. The cleaned face replaces the earlier
eyelid candidate. Historical deliveries remain unchanged.

Each actor parses its own skin and morph state. The locomotion mixer receives only
Walk_InPlace; Blink never enters it. A separate per-actor timer schedules a 7/30s blink
every 3–6s while standing or walking. Corrective morphs follow `4*w*(1-w)`.
The source walk starts at 1/30s; a playback copy normalizes its start and interpolation.
The route travels at .48m/s, and signed actual speed drives gait; a .12s weight fade
returns the bind pose at stops. Sole-band vertex probes prevent approximately3mm
between-frame quaternion interpolation dips. External floor offset remains .025m.

Reduced motion disables gait/blinking and restores the open-eye bind pose. Hidden/offscreen
rooms pause and release animation resources with their Models owner, including bone textures.
The procedural fallback retains historical rigid movement. No grab/cook/reach/idle/turn clips
or physical hair/skirt collision simulation have been added. No FPS/VRAM benchmark was made.

Validation:

- Build, typecheck, lint, workspace/patch checks and diff whitespace check passed.
- Character, ownership, demand-runtime and transport tests:28 passed,0 failed.
- Dynamic geometry audit:721 sampled poses at .15s intervals across both seats, forward travel,
  fridge stop/return, turns and interrupted retreat; no detected furniture penetration or sole
  penetration beyond 10micrometres. This is sampled geometry coverage, not continuous CCD.
- Existing neutral-geometry exhaustive route/interrupt audit passed with the updated asset.
- Full current suite:315 tests,308 passed,2 failed,5 skipped. Both failures are historical
  candy-material tests expecting the superseded refrigerator's single-material RGB mask.
  The concurrently replaced refined refrigerator has two materials and an RGBA palette;
  these failures are outside character changes. They were retained and reported.
- Library-enabled fridge/decor verification:17 passed,0 failed, including the five checks
  skipped without OFFICE_ASSET_LIBRARY in the full run.
- Current static source/bake signature test passed. Character is explicitly excluded from
  applyKitchenBake and static source export; no character-triggered rebake is required.

Browser evidence is in the source library `sync/evidence/2026-10-30-character-animation/`.
Only Codex's in-app browser is used after the user's browser preference. The plugin's own
preview at http://127.0.0.1:4188/ loaded exact current inline GLBs with no warn/error,
showed two separate actors, stationary natural blinking, skeletal fridge travel and stop.
The blink contact sheet includes a closed-eye frame while the body remains standing.
The fixture exercises the same OfficeDashboard and runtime, but has simulated activities.

The actual .dsh-test service at http://127.0.0.1:3088/ is built with the new GLB and runtime.
A native browser earlier loaded the new character; final Codex in-app DSH verification
still encounters 20s binary fetch timeouts for character/refrigerator/lightmap and falls back.
The same bytes render correctly in the inline fixture. Root cause is unconfirmed; no timeout,
authentication or transport bypass was introduced. Do not label DSH cold loading passed.
The final integration receipt remains pending and latestAccepted stays at the previous
character revision until this page-level gate is resolved. User visual approval is pending.

The latest concurrent furniture and shell bake are retained. No DSH source, production
profile, layout, camera, lighting or immutable delivery was edited by this character task.

2026-10-31采用覆盖：用户指定face-blink-r2原PBR；不再应用运行时cel。当前能力/验收以docs/SESSION-BOARD-VERIFICATION.md为准，本文旧两角色/材质结论作为历史。
