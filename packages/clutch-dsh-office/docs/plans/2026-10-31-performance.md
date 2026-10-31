# Office performance follow-up

## Full-resolution 30 FPS follow-up

Keep the accepted DPR2, eight-million-pixel budget, geometry, materials, lights,
shadow kernel and actor animation. Cache fixed-camera static HDR color; render
exact multisample furniture depth plus live receivers and actors each frame.
Invalidate on room/bake arrivals and resize, release the cache on teardown.
Compare identical animation frames against the original full renderer, and
measure complete multi-pass GPU frames plus consecutive 30-second runs at the
same 3682×1900 buffer. The cache trades additional GPU memory for frame time;
record that cost and retain full-quality direct rendering if HDR targets are
unsupported. No reduced-quality fallback is allowed.

Follow-up acceptance: full-size clarity takes precedence over the initial one-million-pixel
cap. Support DPR 2 within an eight-million-pixel budget with a CSS-resolution floor;
remeasure rather than claiming the old 30 FPS result. Diagnose trash-can surface artifacts
with identical close-ups and shadows disabled, then fix the shadow receiver sampling
without changing immutable geometry, materials, or bake provenance.

Work directly in the user-selected `wt-office-0.1.0/release`. The baseline is the
existing performance report at `cc59bb3`. Preserve the three pre-existing untracked
analysis files. This follow-up supersedes the earlier no-texture-resizing restriction
for runtime budgets, not immutable source deliveries.

1. Reproduce four-character GPU time, resource counts and idle scheduling using the
   real dashboard/runtime in a local fixture.
2. Bound canvas fragment work, halve the balanced soft-shadow kernel and eliminate
   the zero-radiance shadow-proxy BRDF loop. Keep the lighting rig and shadow maps.
   Use a fixed cadence deadline so small RAF drift does not repeatedly skip a frame.
3. Parse one character template per room. Share geometry/materials/textures, clone
   bones/morph weights/mixers per actor, and release resources at their actual owner.
   Retire procedural fallback geometry as soon as replacement succeeds.
4. Use 512px small-prop GPU images and 1024px hero/character images. Generate separate
   lossless PNG-to-WebP transport derivatives, verify decoded pixels and all geometry
   streams, and bind transport hashes to the unchanged bake sources.
5. Evaluate high-face-count assets against the existing bounded low candidates.
   Do not relax error bounds or reintroduce rejected geometry solely to hit a ratio.
6. Run full package tests, typecheck/lint, workspace gates, browser visual/lifecycle
   and repeated GPU samples. Record measured improvements and remaining limits.

No commit, push, publish or DSH-profile installation is implied.

## Source handoff · 2026-10-31

The user subsequently authorized a scoped commit and push to
`origin/wt-office-0.1.0/release` for Windows source-build verification.
Final handoff checks: Office build, typecheck and lint; 105 related tests including
Windows asset selection, lossless transport, shadow sampling, character sharing,
frame cadence and full-resolution cache; workspace/patch checks and diff whitespace.
All passed (the patch checker retains its existing `!!js` YAML warning).
Native Windows GPU verification remains the user's next step. After pulling and
building, restart the DSH host and reload its client so both asset index and bundle
come from the same build. This handoff does not authorize npm publication.

Windows source-build follow-up: normalize native path separators at the model
selector and bundler boundaries so Windows uses the same reviewed models and bake
sources. See [diagnosis and verification](../WINDOWS-ASSET-SELECTION-2026-10-31.md).
