# Kitchen geometry and surface optimization

User scope: work directly in `wt-office-0.1.0/release`; reduce window glow,
match the hood's coated surface to the accepted refrigerator, simplify kitchen
geometry using bounded meshoptimizer error, and repair the right platform seam.

Preserve the original GLBs and frozen deliveries. Character skin/morph/animation,
layout, camera and movement remain protected. The rejected refrigerator refinement
must not be restored. All derived assets retain node names, transforms, UV seams
and material assignments; no unconditional mesh joins or texture downscaling.

1. Capture the current Three scene and geometry/material/texture baseline.
2. Diagnose the pane mask, hood highlights and platform seam independently.
3. Generate high/medium/low candidates (85/60/35%, error <= 0.001), record actual
   retained geometry and validate glTF, hierarchy, materials and images.
4. Review fixed views and wireframes before choosing production quality. Keep
   compression measurements separate from triangle reduction.
5. Integrate decoder and failure handling; preserve strict bake provenance and
   rebake changed occluders/materials rather than relabelling an old atlas.
6. Run build/type/lint, relevant regression tests, browser loading/visual/lifecycle
   checks, and update both READMEs and verification evidence with actual results.

No commit, profile installation, push or publish is authorized by this plan.

## Implementation outcome

Implemented a separately hashed runtime derivative layer, retaining all adopted
source GLBs/manifests. Generated original/high/medium/low copies in the Blender
component library; medium is the production selection. Strict error/border limits
take precedence over target ratios. Raw source inspection and validated compressed
and uncompressed statistics are in `docs/reports/2026-10-31-model-optimization.json`.

The window defect involved rear/side emission plus a practical light positioned
in front of the frame. Both the front-pane mask and pane-aligned AREA were fixed.
The hood derives a low-metallicity painted surface rather than retaining its
bright reconstruction highlights. The platform seam reproduced only with baked
diffuse; its named wooden rim now uses continuous realtime PBR. Full lighting was
actually regenerated for all optimized sources/materials as r55/OIDN r56.

The comparison tool provides quality/view switches, OrbitControls, wireframe,
lighting isolation and live render/load statistics. The final full kitchen and
source/signature regressions use the selected medium files; source import tests
continue to validate immutable deliveries. See `docs/MODEL-OPTIMIZATION.md` for
actual counts, verification and limits. No automatic LOD or texture resizing was
needed. The current work is verified in local previews; it is not installed into
a DSH profile and does not claim final user art approval.
