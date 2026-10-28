# Kitchen asset acceptance, 2026-10-27

The `wt-office-0.1.0/release` working tree now adopts four additional
`2026-10-27-r1` deliveries beside the existing refrigerator, table and
storage-cabinet assets. The change is plugin-only and remains uncommitted on base
commit `abebfbae3f746b99685d43808cc705d77c194e0d`.

| Asset                   | SHA-256                                                            | Geometry                                                 | Placement                      |
| ----------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------ |
| `kitchen/left-wall`     | `9243b901f100d6ad7c05f2fb3526d4ae6f1e7b1af9c0936c1e05d312e347f97a` | 3,300 tris; 4 meshes; 1 material; 2 images; 73,272 B     | `[-2.7,0,0]`, Y `+pi/2`        |
| `kitchen/pendant-light` | `10f14bd64bc810618e6510470ce18c0dc521dafac8c813d0c539da4c0bedd583` | 17,000 tris; 2 meshes; 1 material; 4 images; 1,471,388 B | `[1.1,0,-0.7]`                 |
| `kitchen/sink-cabinet`  | `7c48bf3b84a4a967e753ffac00d0a9e9e157e06e051ff9c8e7470c156b3cdef7` | 34,530 tris; 8 meshes; 1 material; 2 images; 788,860 B   | `[0.65,0,-1.79]`               |
| `character/deepseek`    | `9c4d591a3f3f7e965058034ba1deeebf254eaa52c7982c52988e94c9f4166ec2` | 50,000 tris; 1 mesh; 1 material; 3 images; 3,455,460 B   | feet ground center, unit scale |

The adopted bytes are byte-identical to the immutable library deliveries. Their
manifests validate coordinates, embedded resources, semantic nodes, actual vertex
bounds, component-specific budgets and anchors. The refrigerator limits are
unchanged; every new asset has its own budget.

## Runtime integration

- The left-wall GLB replaces the former procedural wall. The old wall's fake
  window is no longer instantiated; the GLB has no window. Parsing failures retain
  the window-free whitebox fallback.
- The pendant preserves `hanging_assembly/whale_shade/suspension/light_anchor`. A
  low-intensity point light is added under `light_anchor` without shadows. Its
  current X/Z position clears the refrigerator topper, shelf and right wall.
- The sink cabinet sits to the refrigerator's left. Three local-Y door pivots and
  one local-+Z drawer retain their delivery transforms and are closed by default.
- DeepSeek uses `feet-ground-center` and unit scale. The real GLB is a static,
  single-mesh appearance replacement; session motion translates/rotates the whole
  model with a small body bob. Whitebox arms and tail are not animated when the GLB
  is active. Parsing failure retains the procedural character.
- Existing workspace/session projection, vertical kitchen list, two-character cap,
  distinct station positions, overflow count, bubbles and idle-room behavior remain.
- Cross-room movement routes through the aisle at `z=0`; preset actor bounds are
  sampled against the table, stove, sink, refrigerator and left wall.

## Commands run

```bash
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office typecheck
npx --yes pnpm@10.32.1 --filter @cerbur/clutch-dsh-office test
./node_modules/.bin/eslint packages/clutch-dsh-office/src packages/clutch-dsh-office/test packages/clutch-dsh-office/scripts
./node_modules/.bin/prettier --check packages/clutch-dsh-office/src packages/clutch-dsh-office/test packages/clutch-dsh-office/scripts
node scripts/check-workspace.mjs
node scripts/validate-cordis-patches.mjs
git diff --check
```

Typecheck, build, 26 tests, ESLint, Prettier, workspace validation and diff checks
passed. The Cordis validator passed with its pre-existing unresolved `!!js` YAML
warning. The Client bundle is 19.23 MB because all seven GLBs are currently inlined.

## Real DSH test profile

Only the explicitly authorized test profile was used:

- `DSH_HOME=/Users/yuancheng/.dsh-test`
- Server working directory: `/Users/yuancheng/Documents/Code/deepseek-harness`
- URL: `http://127.0.0.1:3088/`
- The server remains running; no production profile or native Session was started,
  stopped or retained for rendering.

The authenticated in-app browser showed five native workspace kitchens at
`5 / 0`, with each idle room still present and no character. The local preview
inside the real DSH page showed two independent DeepSeek models, two labels and
separate cooking, waiting, searching, editing and resting states. The focused room
showed the new cream left wall without the old fake window, a clear junction with
the stove wall, the sink cabinet to the refrigerator's left, and the pendant clear
of the refrigerator topper and shelves. Furniture and actor paths remained clear.

The in-app browser host does not expose console diagnostics to this session. A
fresh cold load of the same Client rendering fixture was therefore used for the
console audit at 1200x915: the normal run and a reduced-motion reload both reported
zero console errors and zero warnings. The fixture also confirmed:

- two active DeepSeek models with distinct bubbles;
- a searching transition under reduced motion;
- only two mounted canvases at the end of the vertical list;
- no alert elements or visible WebGL failure banner.

## Evidence

- [Overview](../assets/screenshots/office-overview.png)
- [Focused kitchen](../assets/screenshots/office-kitchen-assets.png)
- [Two-character local preview](../assets/screenshots/office-deepseek-preview.png)
- [Reduced-motion search](../assets/screenshots/office-reduced-motion.png)
- [Vertical list end](../assets/screenshots/office-list-end.png)

The library keeps the same acceptance images under
`sync/evidence/2026-10-27-r1/`. Component receipts are under `sync/receipts/`.

## Boundaries and follow-ups

- The DeepSeek delivery is static. It has no rig, articulated arms or tail,
  interaction clips or reach/cook/grab animation.
- Layout tests cover the preset activity stations rather than general navigation
  or physics collision. Door and drawer pivots are preserved but no interaction is
  added to the MVP.
- Inline Base64 transport makes the Client bundle 19.23 MB. Moving the asset bytes
  to a plugin-owned transport is the next packaging/performance task.
- The refrigerator's newer r2 remains ready, not adopted; this acceptance preserves
  accepted r1.
- This work does not modify DeepSeek Harness source, a production profile, immutable
  deliveries, or npm publication state. No commit, push or publish was performed.
