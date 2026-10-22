# Animation templates and script rendering

## Scope and interface

Continue on `wt-fireworks-0.1.5/feat-global-effect-toast-jump`, after the global
effects commit. Plugin only; preserve `happy_fireworks`, `clutch_fireworks/launch`,
authenticated delivery, source-Session toast navigation and silent refresh.

Tool result → launch event → playback controller → selected animation plus the
independent toast. Capture the selected template at the start of each queued
burst, use its duration, and let subsequent bursts use newly saved preferences.
Custom code never owns the toast, delivery, navigation, or application state.

Queue whole events, not just animations. The animation and toast are separate
rendering branches started together inside one active event. Release that event
only when both branches finish. Toast completion includes automatic expiry,
dismissal and successful Session navigation. A fixed 12-second deadline from
event start clears any remaining rendering and advances without retry; ready
callbacks cannot extend that deadline. Animation startup/completion timers and
the existing trusted failure presentation remain bounded inside this deadline.
Ignore old animation/toast callbacks by playback identity. Keep accepting new
events while only the active toast remains, without starting them or a preview.

## Templates and rendering

- Standalone `.js` files with a versioned JSON comment header (name, duration)
  and `function render(frame, fx)`. Three built-ins use exactly this interface.
- The rendering layer supplies Canvas 2D, CSS-pixel dimensions, DPR scaling,
  elapsed/delta time, normalized progress, deterministic randomness, easing and
  circle/ring/line/star/emoji helpers. It clears frames and owns frame scheduling,
  resize, duration and cleanup. Scripts need no React or DSH dependencies.
- Execute code only in a dedicated Worker created inside an opaque-origin
  `sandbox="allow-scripts"` iframe. CSP denies networking and external resources.
  The Worker owns an OffscreenCanvas and cannot access the iframe or parent DOM.
  Host validates iframe source and a per-playback token on lifecycle messages.
- A startup/frame watchdog terminates broken or stuck Workers. Unsupported or
  failing scripts fall back to the existing trusted emoji renderer for live
  launches. Preview displays the error. Toast remains independently usable.
- Limit scripts to 64 KiB, eight custom templates, 500–8000 ms duration. A script
  is never evaluated by the Host, import parser, or main DSH renderer.

## Configuration

Use the public `plugins.bundle.config` keyed slot on the plugin details page.
Persist one volatile `animation` Config field through DSH settings with revision
checks. Drafts do not affect live playback until saved. Import, preview, remove,
download and copy a complete script-generation prompt. Custom selections require
a successful sandbox preview before the page enables saving. Refresh preferences
when a live launch batch arrives so connected pages use the Host's saved choice.

Preview is a local request to the same global playback controller and root
renderer used for tool launches. There is no preview box, synthetic tool event,
toast or save. Real launches preempt previews; changing templates, stopping,
replacement and page disposal cancel only their own preview. Per-request
identities reject stale completion callbacks. Successful full playback still
validates custom drafts before saving.

Both requests now enter the same burst channel through `play()` and use the
same `AnimationSurface` and `reportPlayback()` callback. Preview only overrides
the captured draft template and omits creation of a task toast. Empty delivery batches
must not stop a preview. A live animation's duration starts after its first
paint; stale callbacks cannot advance a newer playback.

Keep the iframe embedding scheme explicitly `normal`, matching the srcDoc
document. Reproduced Chromium's opaque white viewport when DSH supplied a dark
embedding scheme while the child used its default light scheme. Matching the
schemes restores transparency without changing templates or sandbox isolation.

## Validation

Delivery uses DSH native Remote streams over its shared Gateway WebSocket.
Register/unregister Host and Client descriptors with the plugin lifecycle.
DSH owns authentication, heartbeat and connection recovery; the plugin reopens
only its logical subscription after loss. Preserve silent baselines, cursor
catch-up and bounded retention/backpressure. Keep the complete-event playback
barrier independent of transport recovery. Restart only the
`DSH_HOME=~/.dsh-test` instance on port 3088, then verify in the built-in browser.

Exercise file contracts, malformed/oversized imports, native settings persistence
and conflicts, template capture and duration, sandbox frame errors/timeouts,
resource cleanup, real built-in and imported previews, real background tool-call
playback, and independent toast navigation in `~/.dsh-test` using Codex's built-in
browser. Update both READMEs, script authoring docs and installed-host screenshots.
Do not commit, push, pack or publish this follow-up without user instruction.

## Acceptance record

### Animation performance follow-up

- Reproduced stuttering in a standalone built-in-browser harness using the real
  sandbox document and Worker. Compared the clean Git baseline and optimized
  implementation, with seed 42 and a 3.2-second sample for each effect. The
  benchmark page explicitly declares UTF-8 so it measures actual emoji glyphs.
- Emoji changed font size for every particle on every frame; stable glyph
  rasters remove repeated text rasterization. Glowing circles reuse bounded
  sprites; Starburst keeps its dots at radius 2.5 and fades alpha to preserve
  glow without rebuilding blur. Scripts skip inactive bursts only after
  consuming their random values and share per-burst calculations.
- Browser sample: Emoji drawing P95 fell from 39.3 ms to 0.5 ms and frame
  interval P95 from 60.5 ms to 11.3 ms. Starburst frame interval P95 fell from
  50.6 ms to 11.3 ms. These are local harness measurements, not a frame-rate
  guarantee for every DSH workload or display.
- A final-build repeat with no other preview active confirmed Emoji drawing
  P95 of 29.4 ms → 1.1 ms, Emoji frame interval P95 of 42.3 ms → 12.0 ms and
  Starburst frame interval P95 of 50.0 ms → 12.5 ms. Final Aurora/imported-example
  frame interval P95 was 11.4/12.4 ms. Both runs show the same improvement;
  absolute timings vary with browser/GPU load and warm caches.
- Sprite caching is per Worker, bounded to 128 entries/two million pixels,
  resets on DPR changes and falls back to direct drawing on overflow. Helpers
  retain their public signatures. The source-over transparent fast path leaves
  other compositing operations available. No frame-driver, iframe theme,
  transport, toast or queue changes were needed.
- Regression tests cover raster reuse while particles move/scale/rotate/fade,
  transparent draws, DPR changes, bounded caches and visible overflow. Package
  build and all 53 tests pass. Both READMEs link the bilingual authoring tips.
- Standalone browser visual checks cover built-ins and the imported example
  against light and dark backgrounds. Installed-host verification followed in
  the separate acceptance record below.

Validation commands (from the package, except the two workspace checks):

```bash
pnpm run test
pnpm run typecheck
pnpm exec eslint src test assets/animations scripts
pnpm exec prettier --check src/client/animation-sandbox.ts src/client/animation-templates.ts assets/animations/classic.js assets/animations/rings.js test/animation.test.mjs README.md README.zh.md docs/ANIMATIONS.md docs/plans/2026-10-22-animation-templates.md
pnpm -C ../.. run check:workspace
pnpm -C ../.. run check:patches
git diff --check
```

### Installed-host verification after the performance follow-up

- Used the existing `DSH_HOME=~/.dsh-test` instance at `http://127.0.0.1:3088`,
  DSH 0.2.1-rc.2, through the built-in browser. No restart was needed. The plugin
  details confirmed the source link points to this feature worktree. The UI's
  generation prompt includes the new performance advice, and the actual preview
  iframe's `srcdoc` contains the optimized sprite-cache runtime.
- Emoji, Starburst, Aurora and the previously imported Golden Spiral each
  completed with the UI reporting script validation passed. Confirmed transparent
  rendering over the real settings/sidebar in the dark system theme and after
  temporarily selecting the light theme. Preview creates no celebration toast.
- Manual stop reports stopped and removes the preview iframe immediately.
  Natural completion also leaves zero preview iframes. The narrow-window preview
  spans the full 634 × 777 CSS-pixel viewport with `sandbox="allow-scripts"`.
- Submitted real `happy_fireworks` requests in the existing fireworks regression
  Session, then opened Plugins while it ran in the background. Captured the live
  Emoji effect with the `动画优化实测 B：点击返回会话` toast on the Plugins page.
  Clicking it returned to the originating `fireworks 插件集成回归测试` Session;
  the tool call and completed agent response are visible there.
- Refresh after playback established a silent baseline with no replayed effect
  or toast. No browser warnings or errors were captured during these checks.
- Restored follow-system appearance and retained the original saved Emoji
  selection; custom scripts were retained and no animation draft was saved.
  Left the existing test Host and plugin enabled. This is installed-UI functional
  and visual acceptance; the numerical frame measurements above remain from
  the standalone comparison harness.

### Installed-host acceptance before the performance follow-up

- Installed in `~/.dsh-test`, DSH 0.2.1-rc.2, port 3088. Used only the Codex
  built-in browser for browser interaction.
- Imported `example-custom.js` through the real file picker, previewed the
  Canvas effect, saved it, and confirmed the selection survived refresh.
- A real background `happy_fireworks` call played the saved custom script on
  the Plugins page; its independent toast opened the originating Session.
- An intentionally looping imported preview was terminated by the 750 ms
  watchdog. The page remained responsive, saving stayed disabled, and discarding
  restored the saved valid template. A custom save stays disabled until its
  complete preview finishes successfully.
- Captured the installed configuration UI in
  `assets/screenshots/animation-settings.png`, now showing global preview with no
  preview box. Verified its iframe spans the entire viewport, creates no toast,
  and disappears immediately on stop or page leave. Custom draft saving stays
  disabled until full playback completes; abandoning drafts preserves the
  previously saved selection. Confirmed the generation prompt
  expands and the copy action reports success; automated clipboard readback is
  not provided by this in-app browser session.
- Follow-up reproduced an opaque white viewport in the dark theme (99.0% white
  pixels during playback). Changing only the embedding color scheme restored
  the underlying page (0.2% white pixels). Earlier viewport-size and lifecycle
  acceptance did not detect this compositor behavior; always inspect the
  underlying page during playback in both themes.
- Rechecked the shared playback path in the built-in browser: dark and light
  preview, imported custom script validation, stop cleanup, real background
  `happy_fireworks` with emoji particles plus toast, and clicking that toast to
  return to the source Session. Restored the original follow-system theme and
  saved animation choice after testing.
- Verified whole-event serialization with real tools from two Sessions in the
  built-in browser. At about 3.3 seconds A's iframe was gone while its own toast
  remained. B's animation and toast started only at about 8 seconds, after A's
  toast ended. This confirms that a toast-only remainder still occupies A's
  event slot. Captured both phases in the test environment.
- `pnpm run test`: all 47 tests passed, including both event completion orders,
  automatic/manual toast completion, fixed deadline, bounded error fallback,
  old callbacks, preview rejection during a toast-only event, and global preview, cancellation,
  shared rendering/lifecycle, empty-poll preservation, preemption, stale callbacks and timeout/disposal. Package typecheck, build, ESLint over
  source/tests/scripts/templates, scoped Prettier checks, workspace shape,
  Cordis patch checks and `git diff --check` passed.
- Confirmed the required configuration slot and settings methods also exist in
  the DSH `dsh-v0.2.0-rc.1` source tag. Actual browser acceptance used 0.2.1-rc.2.
- Historical SSE follow-up (superseded by native Remote streams below): `pnpm run test` passed all 53 tests. Covers persistent
  multi-event delivery, comment heartbeats, bounded slow subscribers, stream
  abort/disposal, epoch/cursor recovery, split UTF-8/CRLF decoding, malformed
  frames and the 45-second idle watchdog. Typecheck, ESLint, Prettier, workspace
  and patch checks pass. Existing YAML custom-tag warning is unchanged.
- Restarted only port 3088 with `DSH_HOME=~/.dsh-test`. In the built-in browser,
  a real background tool call displayed transparent fireworks and its toast
  on the Plugins page; clicking returned to the regression Session. Refresh
  established a quiet baseline. Unauthenticated SSE access returned HTTP 401.

## Native Remote stream acceptance

- Replaced the plugin Fetch/SSE route with an explicit runtime-registered
  `clutch_fireworks/events` Remote stream. Host and Client use the same strict
  descriptor. Registration is fiber-owned; no automatic `./typert` loader,
  DSH source changes or generated catalog edits. Minimum Host version is
  0.2.1-rc.1; development SDK and installed-browser acceptance remain on rc.2.
- The installed Host delivered native WebSocket baseline and live batches, but
  the first Client implementation did not subscribe: injecting `remote` alone
  cannot access the newly mounted `remote.clutch_fireworks` service in Cordis.
  Reproduced with a minimal real Client Context, then with the actual bundled
  entry. Inject the namespace after `$mount`, with playback and UI owned by that
  dependent fiber. The regression failed before this fix and passes after it.
- Native Gateway regressions cover late Host registration, withdrawal,
  re-enable, strict cursor validation and owner-only aggregate reads even with
  an otherwise permissive access policy. Native Client regression verifies
  multiple subscriptions share one socket, logical cancellation, remount and
  Connection-driven socket replacement/cursor recovery.
- `~/.dsh-test`, port 3088, built-in browser: a real background tool produced
  transparent emoji fireworks and a toast on the Plugins page. Clicking the
  toast returned to the source Session. Disabling/re-enabling the plugin without
  restarting DSH restored real tool playback. Restarting only the test Host,
  without refreshing the page, also restored tool playback and toast navigation.
- Frozen pnpm installation accepts the automatically generated workspace lockfile.
  No hand edits to cross-plugin dependency resolution were applied.
- Final package test run: all 51 tests passed. Package build/typecheck, ESLint
  over source/tests/scripts, scoped Prettier, workspace/patch validation and
  `git diff --check` passed. The pre-existing YAML `!!js` tag warning remains.
- Final browser checks confirmed silent refresh, full-window Starburst preview
  with no toast, successful script completion and cleanup. Discarded the draft
  to restore the saved Emoji selection; left the plugin enabled and 3088 running.
