# Character cel shading · 2026-10-30

Character-only shader `src/client/scene/character/toon.ts`, applied after ownership and
room-shadow setup. Uses three normal-based bands, blue-purple shadow tint, derivative
antialiasing, subtle rim and 12% bounded room diffuse contribution. Art key is fixed in
world space along [-.45,.8,.55]; this is deliberately stylized, not physical AREA lighting.
The original painted highlights remain. No outline geometry, additional render pass,
texture or shadow map is allocated. Existing material ownership/disposal is retained.
Native skinning/morph vertex shader, colors, alpha and final tone mapping remain.

Source GLB: character/deepseek/2026-10-30-anime-r1,
SHA256 04869f86f878213887cccff40054a4ac59a4754c603d01e86afb7c10f166a961.
Its standard PBR is the portable fallback; the cel appearance lives in Office and is
not falsely advertised as a GLB or Cycles feature. No GLB bytes changed in this shader step.
Character remains excluded from static shell baking. Kitchen camera/layout/light unchanged.

Build/typecheck/lint and 23 targeted shader-composition, animation and ownership tests pass.
Actual .dsh-test Office local-preview page loaded the character and compiled the shader
without console errors. User artistic approval pending. No performance benchmark.
Earlier asset step separately passed 304 tests with 4 skipped; not a full-suite rerun
after this shader change. No commit/push/publish or Harness source modification.

2026-10-31采用覆盖：用户指定face-blink-r2原PBR；不再应用运行时cel。当前能力/验收以docs/SESSION-BOARD-VERIFICATION.md为准，本文旧两角色/材质结论作为历史。
