/** Single English source for the v1 script contract and art direction. */
export const ANIMATION_GENERATION_PROMPT = `Create a distinctive, polished celebration animation for DSH clutch_fireworks using the creative brief below.
Return only the complete contents of one standalone UTF-8 .js file, ready to import and run. No Markdown fences, explanation, concept outline, pseudocode, unfinished placeholders, external dependencies, assets, imports, exports, module wrapper or build step.

Art direction:
- Give the finished effect a recognizable visual identity and a deliberate composition rather than generic random confetti. Translate the brief into a coherent motif, restrained palette and intentional motion language.
- Choreograph anticipation, a clear reveal, a layered climax and a graceful resolution. Use staggered timing, depth through scale/opacity, varied trajectories, easing, rotation and subtle secondary motion. Make details support the main gesture; avoid cheap-looking visual clutter, excessive glow and abrupt cuts.
- Fade smoothly in and completely out by progress 1. Keep the fullscreen canvas transparent: no opaque background, page tint, notification, button or simulated UI. The underlying app must stay visible and operable. The host owns click-through, toast, Session navigation and cleanup.
- Remain legible on light and dark pages, with balanced negative space. Adapt composition and particle sizes to frame.width/height, including narrow portrait and ultrawide windows. Keep a meaningful static composition at progress 0.5 for reduced motion.

Required file contract:
The very first line must be a JSON metadata comment in this exact format (choose a fitting name and duration):
// clutch_fireworks: {"version":1,"name":"My animation","durationMs":4000}
version must be 1; name must be nonempty and at most 60 UTF-16 code units; durationMs must be an integer from 500 to 8000 inclusive. The entire UTF-8 file must be at most 65536 bytes (64 KiB). Users can save at most eight custom animations.
Define a synchronous top-level function render(frame, fx) { ... } that returns no Promise. The host calls it per frame, clears/reset Canvas state, applies DPR, handles resize, schedules frames, stops at durationMs and releases resources. Do not create loops for scheduling, timers, animation callbacks or event listeners. Bounded drawing loops are fine.

Exact drawing API:
frame = {ctx, width, height, dpr, time, delta, progress, durationMs, seed, message, theme}.
frame.ctx is the standard OffscreenCanvasRenderingContext2D for paths, curves, text, gradients, shadows and compositing. Use ctx = frame.ctx, not fx.ctx. width/height and drawing sizes are CSS pixels. DPR is already applied: do not scale ctx or resize its canvas. Applied dpr is at most 2, reduced uniformly to keep the backing canvas within 8000000 pixels while retaining the window's aspect ratio.
frame.theme is the resolved DSH appearance, 'light' or 'dark', and may change during playback. Adapt colors from this value without restarting the timeline, random sequence or animation state. Treat a missing theme as 'dark' for older renderers. Do not query the OS theme or paint a full-screen background.
time and delta are milliseconds; progress is normalized 0..1; seed is a deterministic integer; message is optional celebration text or an empty string. Use absolute time or progress for motion, not accumulated delta, wall clocks or persistent frame state: resize and reduced-motion validation may render nonsequential times.
fx.random() returns a seeded value in [0,1); its sequence resets from the same seed every frame. Consume each particle's random values in the same order before skipping inactive particles, so trajectories remain stable. Do not use Math.random(), Date or performance.now().
fx.clamp(value) clamps to 0..1. fx.easeOut(value) is cubic ease-out with clamped input.
Only these drawing helpers exist (positional arguments and defaults):
fx.circle(x, y, radius, color, alpha=1, glow=0)
fx.ring(x, y, radius, color, lineWidth=2, alpha=1)
fx.line(x1, y1, x2, y2, color, lineWidth=2, alpha=1)
fx.star(x, y, radius, color, alpha=1, rotation=0)
fx.emoji(text, x, y, size=32, alpha=1, rotation=0)
Colors are CSS colors; alpha is 0..1; rotation is radians. Helpers restore their own Canvas state. Pair ctx.save()/restore() around your own state changes.

Performance and safety:
- Aim below about 1000 particles per frame; this is guidance, not a guaranteed frame budget. Keep work bounded and fast on large/high-DPR windows. A frame taking over 750 ms is terminated, not an acceptable target. Avoid unbounded loops, expensive per-frame allocations and heavy repeated text/shadow rasterization.
- Compute shared burst timing/easing outside particle loops. Skip particles before/after their lifetime or when fully transparent, after consuming stable random values. Prefer fx.emoji and fixed-radius/color/glow fx.circle for bounded sprite reuse; animate position, rotation, size where supported and alpha rather than rebuilding blur. The cache is limited to 128 entries and 2000000 pixels; it is not unlimited storage.
- Code runs in a dedicated Worker inside an opaque-origin sandbox iframe with CSP blocking network and external resources. Use only frame, fx, ctx and pure math. No DOM, DSH services, storage, Session access, network, fetch, XMLHttpRequest, WebSocket, import/importScripts/require, window/document, postMessage or global handler overrides. Do not create Workers or external resources.
- Import preflight checks header/size, syntax, the render entry and one bounded frame. Optional full preview validates the whole timeline, including the final frame; reduced motion displays a static midpoint while validating offscreen. Ensure all times from 0 through durationMs render without errors and end fully transparent.

Apply the following creative brief while preserving every requirement above:`;

export function animationGenerationPrompt(creativeBrief: string): string {
  return `${ANIMATION_GENERATION_PROMPT}\n\n${creativeBrief}`;
}
