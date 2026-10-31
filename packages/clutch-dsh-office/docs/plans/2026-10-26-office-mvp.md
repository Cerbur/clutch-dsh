# Office MVP

Date: 2026-10-26. Worktree: `wt-office-0.1.0/release`.

Status: framework MVP implemented; focused checks and user-authorized real-profile
acceptance in `~/.dsh-test` passed. See [verification](../MVP-VERIFICATION.md).

## Confirmed direction

2026-10-27 user clarification: the original image at
`assets/references/kitchen/kitchen-reference.png` is the mandatory visual reference
for the entire Kitchen scene and its components, character art, materials and
lighting. Its identical library mirror is `kitchen/references/kitchen-reference.png`;
paired `reference.json` files pin the revision/hash. Current whitebox coordinates
and previous asset previews document implementation progress, not the art target.

Build `@cerbur/clutch-dsh-office` as one package under `packages/`, following
Title's Host/Client packaging. Keep all DSH integration plugin-only. The first
theme is an isometric kitchen with whale-girl characters, initially procedural
whitebox geometry. Build the activity/action seam now; detailed tool mapping,
finished art, project-size decoration, subagents, and a floating mini-window follow.

The user chose an independent overview of workspaces, multiple Sessions
with an initial two-character cap per room, and character-top bubbles at meaningful
moments. The initial MVP is developed directly on the release branch; subsequent
features follow the repository's feature-worktree lifecycle.

## Initial behavior decisions

2026-10-26 revision: the user requested all kitchens remain visible, including
idle workspaces, and a single vertical list instead of a responsive column grid.
Only characters are activity-filtered. The global no-kitchens state now means
there are no native workspaces; a focused room remains when its final actor stops.

- Active means an unarchived, nonblank, non-subagent Session is running or has
  a native pending user interaction. No historical activity-time heuristic.
- Workspace membership comes from the native Workspace account, never guessed
  from path prefixes. Worktree-only virtual membership is a future integration.
- Waiting interactions take precedence over running. Running drives cooking;
  waiting drives an idle/wait pose and a persistent bubble.
- Stable admission preserves the two visible actors while they remain active;
  extra active Sessions are counted rather than arbitrarily displacing them.
- The overview contains one kitchen per native Workspace in a single vertical list
  and a focused room view. Idle kitchens retain the scene with zero characters.
  A clearly labeled local preview works when no real Sessions are active.
- Native state loading/failure is visible. No Session retain, history open, run,
  prompt, or storage mutation is required to render an Office.
- Activity types and action scheduling are renderer-independent; future searching
  and editing signals can choose refrigerator and stove stations without changing
  DSH state ownership. Concurrent actors have separate station positions.
- Bubbles contain localized status, not raw prompt/tool output. Character labels
  use native title projections where available and a short id otherwise.
- Pause animation for hidden documents/offscreen canvases; honor reduced motion,
  cap device pixel ratio, dispose all GPU resources, and show WebGL failure visibly.

## Integration evidence

Read-only reference: `/Users/yuancheng/Documents/Code/deepseek-harness`, tag
`dsh-v0.2.1-rc.2`. Native `main` keyed slot and `sidebar.panellist` provide the
overview. Workspace Controller list and root Session hooks provide membership and
status. `session/event`, `tool/call`, and PTC dispatch events can support later
Host-side classification; the initial MVP needs no custom Remote.

There is no append-only native Workspace menu slot in this DSH version. The
Worktree plugin's Workspace menu is also hard-coded in its row component. Do not
modify either for this MVP; expose focused-room navigation within Office.

## Delivery and validation

1. Package manifests, lifecycle conventions, bilingual docs, root catalog entry.
2. Pure workspace/active-actor projection and activity-to-action planner.
3. Native main/sidebar registration and overview/focused-room/preview UI.
4. Procedural kitchen and two whale girls, poses, movement, bubbles, cleanup.
5. Focused behavioral tests; package typecheck/build/lint; workspace/patch guards;
   real browser preview and screenshot. Validate native registration against DSH's
   actual Slot runtime. The user subsequently authorized installation and real
   acceptance in `~/.dsh-test`; the production `~/.dsh` remains untouched.

## Implementation notes

The Client compiler maps Cordis and UI Slots type imports to this package's
direct pinned declarations. The workspace contains older plugins with other
Cordis peer graphs; without this type-only convergence, their duplicate SlotMap
identities split declaration merging on a frozen-lockfile install. Runtime
Cordis/React/UI Slots remain DSH's shared browser modules, not bundled copies.
Other packages' existing lockfile importers and dependency snapshots are preserved.

The initial whitebox kitchen was composed from six independent named model roots:
`floor`, `left-wall`, `right-wall`, `stove`, `table`, and `refrigerator`.
Each builder uses local coordinates; only `scene/kitchen/index.ts` places them
in the room. Floor tiles/mat belong to the floor, the window to the left wall,
the shelf/props to the right wall, cookware to the stove, table props to the table,
and the top plant to the refrigerator. Shared palette/resources remain owned by
the scene and are disposed together. This is an internal MVP refactor preserving
the existing appearance and activity stations, preparing individual asset replacement.

The procedural scene has explicit GPU teardown and a Reload scene action after
WebGL/context failure. The native SlotRegistry lifecycle is tested with the
published DSH renderer bundle; the browser fixture uses simulated workspaces.
Real-profile testing found and corrected two integration issues: native title
projections are strings and already have list labels; cached domain baselines do
not establish current connectivity. Office now uses native titles and requires an
online browser plus connected generation before showing live rooms/counts.

## Deferred scope

2026-10-27 art integration: the user designated the external Blender library at
`/Users/yuancheng/Documents/blender/office` with the hierarchy
`office/<scene>/<component>` (currently `kitchen/refrigerator`). The accepted-for-now
refrigerator is the first GLB replacement, using an immutable revision and SHA-256
manifest. It is bundled inline without DSH source changes or a Host file service.
The former refrigerator remains as a load-failure fallback. Authored coordinates
match the current room placement; Session projection and action stations do not
change. GPU ownership includes imported textures and late asynchronous completions.
See [asset handoff](../BLENDER-ASSETS.md) and the library's own AGENTS/HANDOFF files.

Workspace context-menu append and mini-window, detailed live tool classification,
additional GLB assets and rigged animation clips, arbitrary character counts, full navigation
and collision, persistent room customization, filesystem scanning, and Worktree
virtual-workspace membership. File count will represent project scale rather than
claiming to measure complexity.

## Table and storage-cabinet integration, 2026-10-27

User-authorized `2026-10-27-r1` deliveries add two separate GLBs, independently
validated and loaded through the same owned-resource lifecycle as the refrigerator.
At that integration point the table kept `[0.6,0,1.55]` at unit scale; the cabinet
became the seventh model root,
placed at the counter's left end per the mandatory main reference. The procedural
counter is shortened, and preset action/spawn coordinates are adjusted to keep the
deeper table out of actor paths. Metric placement/stations are now centralized in
`office/kitchen-layout.ts`; projection and the two-actor cap remain unchanged.

Importer verification additionally measures actual transformed vertex bounds and
anchor positions. Refrigerator remains 30k triangles; table has its own 60k limit;
cabinet has its own 30k limit, each capped at 8 MiB. Existing GLB sources, delivery
snapshots and DeepSeek Harness source remain untouched. Real acceptance and library
receipts are required before catalog adoption, with uncommitted work labeled as such.

## Left wall, pendant, sink and DeepSeek integration, 2026-10-27

User-authorized `2026-10-27-r1` deliveries replace the procedural left wall, add a
separate whale pendant and sink cabinet, and replace the procedural character
appearance with the cross-scene `character/deepseek` GLB. The floor, right wall and
stove remain procedural for this pass. The importer and runtime now have seven
explicit asset namespaces, each with independent geometry and byte budgets.

The left wall removes the old fake window. The sink sits between the stove and
refrigerator. The pendant keeps its hanging hierarchy and emits a small local light
from `light_anchor`. DeepSeek keeps its feet-ground-center contract and static-mesh
capability: it translates, rotates and bobs as a whole, while the whitebox arm/tail
animation remains only in the fallback. The two-character cap, session projection,
bubbles and idle-kitchen visibility are unchanged.

Actor stations and cross-room routing now stay behind the preparation table and
through the clear aisle. Tests sample posed bounds against the delivered furniture
and the wall. This is preset-path clearance, not a general navigation system.

The real `~/.dsh-test` page and a fresh fixture were checked with normal and reduced
motion. Requirements, budgets, evidence and the current 19.23 MB inline-bundle
limitation are recorded in
[kitchen asset acceptance](../KITCHEN-ASSET-ACCEPTANCE-2026-10-27.md).

## Current Kitchen library placement, 2026-10-27

The user requested every currently delivered Kitchen component be composed by the
mandatory reference and installed into `~/.dsh-test`. Adopt refrigerator r2 and
utensil-rail r1, preserve meter scale and semantic origins, place the rail on the
rear wall and keep the L-shaped stove/sink arrangement. Refrigerator and pendant
positions were adjusted for actual clearance and camera separation. The original
refrigerator budget remains 30k; the rail has a separate 20k / 1 MiB rule.
Actual checks and evidence: [layout verification](../KITCHEN-LAYOUT-VERIFICATION.md).

## Isometric camera and larger webpage scenes, 2026-10-27

User requested equal visual scale on X/Y/Z and larger scenes with more vertical
room. The orthographic camera now looks along the equal-offset (1,1,1) diagonal
(45-degree azimuth, 35.264-degree elevation). Wider 1200px cards, taller responsive
canvases and reduced page padding enlarge the scene while preserving room edges.
The focused view can grow to 800px high; narrow screens keep width-limited fitting.

## Equal room dimensions, 2026-10-27

User clarified that the complete room width/depth/height should look equal, not
only equal projection per meter. The shell now measures about 5.5 m on all three
axes. The floor grows forward by 1 m, the left-wall instance stretches in its
local width and height, and the procedural rear wall grows taller. This explicit
user-approved shell override supersedes the prior unit-scale rule only for the
wall instance. Frozen GLB bytes and furniture/characters retain their dimensions.
The pendant mount follows the new wall-top height; camera framing fits the cube.

## Room height adjustment, 2026-10-27

User requested 3/4 of the current wall height: 5.5 m becomes 4.125 m.
Width/depth remain 5.5 m; original furniture/character sizes are unchanged.
The pendant follows wall-top height (root offset 1.225 m above the delivery).
Camera remains isometric orthographic, targets the revised shell center and uses
a 4.4 m vertical half-frustum minimum. Earlier cube dimensions are historical.

## Final room size

User replaced the proportional-height request with explicit 5 x 5 x 3.5 m.
The shell now follows those dimensions. Furniture retains its original scale,
with boundary units moved inward 0.25 m and actor stations adjusted for clearance.
Camera keeps equal-axis orthographic projection and fits the new shell.
Earlier dimension values above are historical.

## Softer reference camera, 2026-10-27

User approved lowering elevation from 35.264 degrees to 30 degrees. The camera
remains orthographic with symmetric 45-degree azimuth. Its horizontal offsets
are [8,8] and vertical offset is hypot(8,8) * tan(30 degrees). X/Z projected
scales remain equal; Y no longer shares that foreshortening. The room remains
5 x 5 x 3.5 m, with the same furniture layout and larger webpage scene panels.
This supersedes the earlier strict-isometric requirement.

## Cooking set integration, 2026-10-27

Adopt stove r1, wall-cabinet r1 and range-hood r2 at authored scale. Stove replaces
the procedural counter and both old pans. Hood rotates with the stove on the left
wall and centers over burner_left; its installation height is already in the GLB.
The blue cabinet uses its cabinet-bottom origin at y=1.70 m, beside the hood toward
the rear corner. Remove the former blue box on the rear shelf and move/shorten the
shelf to keep its bounds clear. Keep all existing adopted assets and the 30-degree
orthographic camera, 5 x 5 x 3.5 m room and station routes.

Each new component has independent importer budgets, frozen revision/hash and
semantic node checks. Preserve original PBR, textures and COLOR_0. Doors remain
closed, hood and flames static; no source-file or rig edits. The common bundled
loader owns resources, handles failure fallback and late asynchronous teardown.
Evidence and real ~/.dsh-test results: [cooking set verification](../COOKING-SET-VERIFICATION.md).

## Shared material language, 2026-10-27

The user deferred layout work and requested component-level color/PBR convergence.
The Blender library owns `docs/统一美术语言.md` and `docs/office-soft-toy-v1.json`.
This package mirrors them in `docs/ART-DIRECTION.md` and `assets/styles/`; the
procedural surfaces use the same sRGB palette through `scene/kitchen/style.ts`.
Five component workers revise the eleven currently adopted GLBs under new immutable
`2026-10-27-style-r1` deliveries, preserving geometry, UVs, normals, hierarchy and
transforms. Textured props keep their semantic details rather than a global tint.

`scripts/validate-material-revision.mjs` compares actual geometry bytes, UVs,
indices, normals, hierarchy and initial transforms against each accepted parent.
Only material, color and image payloads may differ. Existing per-component importer
budgets remain unchanged. Layout, camera, lights, exposure and CSS stay at their
pre-style baseline, enabling a direct real-profile before/after comparison.

Sources/Blender renders stay in component `lookdev/` and immutable deliveries;
the plugin adopts GLB/manifest only, writes receipts after real ~/.dsh-test review,
and retains the previous accepted deliveries for rollback. Material convergence
does not imply new geometry, de-lighted source textures, new animation or final art.
Results: [material style verification](../MATERIAL-STYLE-VERIFICATION.md).

## Three.js 实时灯光迭代（2026-10-27）

用户在完成材质统一后授权本轮灯光设计。新增独立 `scene/lighting.ts`，暖主光、
冷补光、半球光、PMREM 棚拍反射、灶台/层板工作灯与吊灯局部光、VSM柔影和舞台接影。
灯光不写入11件冻结模型，不改布局、相机、CSS及角色行为；此前“灯光不变”是上一轮材质验收基线。
新规范：素材库 `docs/实时光照设计.md`，插件镜像 `docs/LIGHTING-DESIGN.md`。
实时灯光参数唯一源是插件 `src/client/scene/lighting.ts`。本轮效果/验收以
插件 `docs/LIGHTING-VERIFICATION.md` 和素材库 `sync/receipts/kitchen-lighting-2026-10-27-v1.json` 为准。

## Front-facing key revision, 2026-10-27-v2

User requested removing the side key or lighting from the front. The key now follows
the camera direction (45-degree azimuth, 30-degree elevation), position (8,7.532,8.5)
toward (0,1,0.5); intensity2.8→2.2. Other lights, exposure, layout and models stay fixed.
Built and visually reviewed in ~/.dsh-test; two walls now receive more balanced light,
and the large exterior side shadow no longer dominates. Resource ownership is unchanged.
Current overview evidence: [office-lighting-front.png](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-front.png) in the plugin;
Blender receipt: `sync/receipts/kitchen-lighting-2026-10-27-v2.json`. The v1 captures and
receipt remain historical. This pass did not repeat the v1 two-actor/offscreen checks.

## Reference color-temperature refinement, 2026-10-27-v3

User requested closer reference color temperature. The key stays camera-facing,
now peach #FFE0CC/2.5; neutral/cool stage #77727A and gentler hemisphere/fill frame
amber #FFB653 practicals. Khronos PBR Neutral replaces ACES, at unchanged exposure0.95.
Actual cold ~/.dsh-test overview reviewed with zero console warnings/errors. Build,
typecheck, lint and existing lighting resource test passed. This pass did not rerun
two-character or offscreen scenarios. GLB/manifest/layout/CSS byte identities retained;
no material or camera edits. These are artistic RGB light colors, not calibrated CCT.
Current screenshot [office-lighting-temperature.png](https://github.com/Cerbur/clutch-dsh/blob/66c88d734b53cf539dc5aabb59011bf3c4f32cbd/packages/clutch-dsh-office/assets/screenshots/office-lighting-temperature.png); library
receipt `sync/receipts/kitchen-lighting-2026-10-27-v3.json`. Previous captures remain
historical. Reference modeling/texture differences and missing window light remain.

## 独立厨房底板接入（2026-10-27）

`kitchen/floor` 的 `2026-10-27-r1` 已accepted；hash `afa575fe5a13fa26f663fe15003c40b530b74d5b534ddc3929268ea88df07364`。
原生工程 `kitchen/floor/厨房底板.blend`，材质/脚本/用户砖面参考/实际渲染留在组件目录。
圆角蜂蜜木框、5×5m奶油砖面；真正Cycles NORMAL投射64块高模砖，GLB仅830面、2材质、5图、3,684,100字节。
原点floor-surface-center，砖面Y=.025、底-.26，外框5.2m；场景根 `[0,0,.5]`，不按总高归一化。
导入脚本/运行时已独立支持floor，成功移除旧底板/凸起砖缝，旧程序化地毯独立保留。
35测试和build/typecheck/lint/workspace/patch通过；真实~/.dsh-test总览、单间、双角色、离屏重建已验收，冷加载零警告错误。
回执 `sync/receipts/kitchen-floor-2026-10-27-r1.json`；图 `sync/evidence/2026-10-27-floor/`。
其他11件资产/布局/相机/灯光未改，未修改DSH源码/生产profile，未commit/push/publish。
实际地面凹凸来自法线，无几何位移；低模砖面仅2三角面。总GLB22.58MiB、Client33.06MB。

## 双墙重制接入（2026-10-27）

用户授权左/右墙几何重制，覆盖上一轮“材质阶段几何冻结”的范围，仅限两面墙。
left-wall当前accepted `2026-10-27-r2`，right-wall当前accepted `2026-10-27-r1`；详见组件HANDOFF、不可变deliveries及`sync/receipts/kitchen-<id>-<revision>.json`。
原生源：`kitchen/left-wall/厨房左墙_重制.blend`、`kitchen/right-wall/厨房右墙.blend`。各1500面、单材质、4primitive、3图、约375KiB。
两面墙按5×3.5m原尺寸独立载入，不再拉伸旧左墙；奶油哑光上墙+0.82–1.72m釉面砖带、圆角顶边/踢脚线/端帽。实际Cycles烘焙1024²切线法线与512²底色/粗糙度，细节只改变受光，没有几何凹凸或碰撞位移。
原左墙的快照与旧工程保留。本轮不制作窗户，右侧架子/碟子/盆栽仍由插件场景独立保留。
37项测试、build/typecheck/lint/workspace/patch通过；真实`~/.dsh-test`5间空厨房/单间/双角色/检索及离屏重建已验收，冷加载0警告错误。
证据`sync/evidence/2026-10-27-walls/`，插件报告`docs/WALLS-VERIFICATION.md`。其余11件GLB及清单、布局/相机/灯光/CSS/角色站位hash保持；13件GLB共23.24 MiB / 33.99 MB。
未修改DSH源码/生产profile；测试服务继续在http://127.0.0.1:3088/运行，无commit/push/publish。

## 纯色厚墙与四类装饰接入（2026-10-27）

用户最新要求覆盖上一版墙砖：墙体与底板同厚，名义0.285m；纯奶油哑光、roughness.68、metallic0，完全无纹理/砖缝/噪声/法线或凹凸贴图。
left-wall **2026-10-27-r3** / right-wall **2026-10-27-r2** 已accepted。单块圆润板各428面、9104字节、单材质/primitive、零图片。
源工程保存在各组件`lookdev/2026-10-27-plain-wall/厨房左墙_纯色哑光.blend`或`厨房右墙_纯色哑光.blend`，独立GLB导入/实际Cycles渲染通过。
内表面localZ+.06不变，向外加厚至-.225，两面45°拼角；圆角实测宽5.16645m、厚.285174m（相对底板.285m误差.174mm）。外边比原5.2m底板伸出75mm，保留旧家具贴墙面与房间内尺寸。
同步接入 wall-shelf **2026-10-27-r3**（唯一当前推荐，旧r1/r2不采用）、wall-art/chair/rug **2026-10-27-r1**。
置物架[0.42, 0, -1.888]、画[1.55, 2.99, -1.888]、两凳[0.05, 0.025, 2.73]/[1.08, 0.025, 2.73]、毯[-1.2, 0.0255, 2.4]，均scale1/旋转0；位置唯一源仍是插件kitchen-layout.ts。
旧程序化架/碟/盆栽及三球地毯已移除。椅子一件GLB/一次parse复用两实例，共享资源房间级释放。毯面高.0515m且避开角色通道；凳脚落在砖面Y=.025。
五个新实例与旧家具的实际三角网格BVH无表面相交；全角色活动对/步进转向包围回归包含椅子与地毯通过。
54项测试和build/typecheck/lint/workspace/patch通过，真实~/.dsh-test总览/单间/双角色/检索/离屏重建通过，冷加载0警告错误；减少动态未手动切OS，仅回归检查。
回执逐件在sync/receipts，证据sync/evidence/2026-10-27-decor，插件docs/DECOR-VERIFICATION.md。
原底板和其他11件GLB/清单不变；相机/CSS/既有家具/角色路径不变；层板局部工作灯随新下层板下降，所有全局灯色/强度/曝光不变。
17件GLB合计34,660,596字节（33.05MiB），未压缩Client47,710,606字节（47.71MB）。
plugin-only，测试地址http://127.0.0.1:3088/继续运行，未改DSH源码/生产profile；未commit/push/publish。

## 齐边圆角与参考图布局（2026-10-27）

用户后续明确授权全场按参考重排，覆盖之前冻结家具位置的条件。当前floor r2、left-wall r4、right-wall r3、trash-can r2 accepted，其余14件原GLB/清单不变。
两墙各内移75mm并缩短拼角75mm，外沿x=-2.6/z=-2.1与5.2m底板齐平（.3mm容差），纯色哑光/名义.285m墙厚保持。
底板源工程`kitchen/floor/lookdev/2026-10-27-rounded-floor/厨房底板_圆角表面.blend`：瓷砖表面四角真实半径.12m，含可见右下角；52面/底板总880面。原木框、支撑Y=.025/底-.26、五张烘焙图片字节完全不变，UV仿射映射保持，无需重烘；64高模砖仍留源工程。
墙源工程位于各组件`lookdev/2026-10-27-flush-wall/`。本轮不再有旧75mm墙面悬边。
桌[1.45, 0, 1.72]、两凳[0.95, 0.025, 2.6]/[1.98, 0.025, 2.6]、地毯[-0.35, 0.0255, 1.5]；挂杆[-2.313, 2.03, 1.52]绕Y+90°上左墙；置物架[-0.65, 0.25, -1.813]向蓝柜移动并抬高.25m。
冰箱[1.4, 0, -1.355]、水槽[-0.05, 0, -1.463]左收，桶[2.23, 0.025, -1.18]在冰箱右侧；桶r2独立组件、3材质/6primitive/0图，19197面/466588字节，20k/2MiB独立预算。冰箱模型/门轴不变，旧提示词“不移冰箱”位置约束已被用户这次重排覆盖。
检索站位Z改.115，安全转身阈值z>.08；主过道z0不变。所有活动对/走动/转身/停留经粗包围→精确顶点→Triangle/Box SAT窄相检查通过，避免旋转尾巴空角误报。
家具实网格BVH无相交，只有双墙拼角共同表面接触41对；不会把此接触谎称全场0相交。桶最终GLB本轮已官方Blender独立导入/Cycles闭盖与开盖渲染，不重新导出桶字节。
60tests/build/typecheck/lint/workspace/patch通过，实际~/.dsh-test总览5空房/单间/双角色/检索/末间与返回重建通过，冷加载0警告错误。OS减少动态未手动切换，生命周期重绘测试通过。
当前完整坐标/采用字节回执`sync/receipts/kitchen-layout-2026-10-27-aligned-v1.json`，证据sync/evidence/2026-10-27-aligned-layout，插件报告docs/REFERENCE-LAYOUT-VERIFICATION.md。
18件GLB共35,130,104字节（33.50MiB），未压缩Client48,337,749字节（48.34MB）。相机/全局光色强度/曝光/CSS保持，层板局部光跟随新根高度。
plugin-only，未改DSH源码/生产profile，无commit/push/publish。http://127.0.0.1:3088/继续运行。

## 新水槽/鲸鱼娘与桌子外移（2026-10-27）

用户最新要求对应的摆放：桌子仍靠右，先按灶台中线再向外移动0.40m，最终 `[1.45,0,0.55]`；两凳 `[0.95,0.025,1.43]` / `[1.98,0.025,1.43]`。地毯 `[-0.95,0.0255,2.42]` 避开桌椅与活动通道。旧“前排Z1.72”和中线试摆Z0.15均为历史，当前坐标唯一源是插件 `src/office/kitchen-layout.ts`，完整回执 `sync/receipts/kitchen-layout-2026-10-27-centered-v1.json`。

本轮新水槽 `kitchen/sink-cabinet/2026-10-27-r2`（37,971面，4,089,884字节，hash `9b13e43bc017fb7a2e73b7e0159625610d32f52173d0d766fbc0ce879584d238`）与新鲸鱼娘 `character/deepseek/2026-10-27-r2`（57,979面，4,179,544字节，hash `42cf4de8d70b9f2301342afe7979144a5bcf2568c4ed03a3f2578189cab26132`）已通过真实 `~/.dsh-test` 接入。原尺寸scale1；水槽根 `[-0.05,0,-1.463]` 不变。新角色源原件、打包Blender工程、贴图、独立渲染与修复记录都在 `character/deepseek/`；不覆盖旧工程或冻结交付。

水槽r2是静态单网格，没有旧门/抽屉枢轴；导入器按revision显式支持r2，并保留r1/style-r1回滚预算/节点。角色无骨骼与分肢动画，1.50m高、双脚中心原点；原件深蓝身份保留，不用旧角色重染替代。87个UV退化三角形继承自源，局部重建/绘制光影仍在，不宣称完美拓扑或去光照。活动路线在桌子左侧，检索时朝冰箱方向；不是已经实现开冰箱/拿取物品。

实际全量79项测试、build/typecheck/lint/workspace/patch通过；逐帧路径与初始化/转身检查、实际家具BVH及真实浏览器空房/单间/双角色/检索/离屏重建通过。双墙拼角保留41对共同表面接触，其余家具无表面相交。相机/光照/CSS及其余16件GLB保持。18件共34,564,548bytes（32.96MiB），未压缩Client47,583,876bytes。OS减少动态未手动切换；无一般导航/人物互避。plugin-only，无commit/push/publish，测试服务 http://127.0.0.1:3088/ 留在运行。证据 `sync/evidence/2026-10-27-centered-layout`。

插件报告 `docs/UPDATED-KITCHEN-VERIFICATION.md`。

## 桌椅再次外移（2026-10-28）

用户明确确认在上一轮位置基础上再向外移动40cm；桌子 `[1.45,0,0.95]`，两凳 `[0.95,0.025,1.83]` / `[1.98,0.025,1.83]`。靠右的X坐标不变，椅子与桌子保持0.88m前后间距，累计距灶台中线向外0.80m。其他物件、角色站位、相机、灯光及18件GLB/manifest字节均不变。新位置回执 `sync/receipts/kitchen-layout-2026-10-28-outward-v1.json`，覆盖旧centered-v1位置；旧回执与交付保留为历史。79 tests/build/typecheck及实际~/.dsh-test总览/双角色预览通过。

## 冰箱行走（2026-10-28）

桌椅再向外20cm：桌子[1.45,0,1.15]、两凳[.95,.025,2.03]/[1.98,.025,2.03]，仍靠右；相对灶台中线累计外移1.00m。找食材预览已增加绕桌走向冰箱前、停留朝冰箱及返回原活动的整体行走动画。角色仍为静态网格，通过转身、平移、轻微起伏表达行走；没有新增骨骼、开门或拿取动画。真实Session的检索分类仍未接入，当前用本地预览入口验收。

最终米制站位、路线策略及验证结果见 `sync/receipts/kitchen-layout-2026-10-28-fridge-walk-v1.json` 的layout/motionAudit。插件布局/运动纯函数为唯一运行时来源，Blender场景与组件工程不内嵌世界坐标；本次不改18件GLB/manifest、材质、相机和全局光照。旧outward/centered回执为历史，不覆盖冻结交付。验收见 `docs/FRIDGE-WALK-VERIFICATION.md`。

## 当前采用：置物柜替换与水槽填角 · 2026-10-28

新版置物柜 `2026-10-28-r1` 已替换旧style-r1，29342面/4069316字节/单静态mesh+primitive+材质/3张内嵌贴图，hash `0eeb04aabea9d090ffc0dab2279c55027ae72cc54611335493f962496ef86e55`。保留原件盆栽、调料、蔬菜、筐和轮子；无旧轮轴/独立食材动作。根位置[-1.715,.024499213707168,1.55]，scale1，轮底对齐地板Y=.025。旧revision节点规则与30k/8MiB/单材质预算保留可回滚，未覆盖冻结快照。

用户明确授权水槽在导入后由场景设置大小以填满转角：采用原r2 GLB字节不变，scale[1.8667534820395086,1,1.2303512683915283]，根[-.75,.024960769226163,-1.4]，世界宽3.08m、深.80m，总高约1.35m，台面高度仍约.925m（含地板修正）。左侧接近左墙转角，右侧与冰箱约50mm缝，后侧距墙约15mm。此为明确非等比场景fit例外，整体总成包括龙头/毛巾/瓶罐同步横向拉宽，不声称重新建模或保持所有细节原始比例。manifest仍描述原始资产尺寸，场景缩放唯一源KITCHEN_SCALE，不写回GLB/Blender工程。

桌子[1.45,0,1.15]、凳Z2.03、其余16件GLB与水槽GLB/manifest、相机/CSS、冰箱行走策略保持；用户后续授权的Cycles预览灯光迁移另见光照文档与回执。扩大后的水槽参与实际变换碰撞检查；置物柜与挂杆只有粗包围重叠，实际三角面无交，不为包围盒误报移动家具或忽略断言。Blender全家具BVH仅双墙41对共同接触，其余无表面交。新源图集既有烘焙明暗/台面轻微三角明暗保留；真实页面已查看，不宣称完全去光照。

100项测试、build/typecheck/lint通过，实际~/.dsh-test总览/单间/双角色/走到冰箱/末间与离屏重建通过，浏览器状态详见回执 `sync/receipts/kitchen-layout-2026-10-28-storage-sink-v1.json`。plugin-only；服务 http://127.0.0.1:3088/ 保留运行，无commit/push/publish。

插件验收 `docs/STORAGE-SINK-VERIFICATION.md`。

## Cycles审核光照迁移（2026-10-28）

用户指定的审核图已作为实时光照基准迁移：三softbox灯位/尺寸/线性光色、深灰背景、Neutral曝光和低强度棚拍反射。非Cycles逐像素复制，阴影/间接光为实时近似，含弱半球漫反弹补偿。参数唯一源插件lighting.ts；双向规范docs/LIGHTING-DESIGN.md ↔ 素材库docs/实时光照设计.md，实际回执sync/receipts/kitchen-lighting-2026-10-28-cycles-review-v1.json。审核图和真实脚本长期归档sync/evidence/2026-10-28-cycles-lighting，原厨房主参考不替换。

## 当前渲染覆盖：Cycles review v2（2026-10-28）

用户明确授权相机/光照一起对齐审核图，覆盖旧相机冻结：Three相机[8,7,8.5]→[0,1.3,.5]、ORTHO8.1、俯角26.739586°；三AREA尺寸/位置/linear色与source一致，P/(πA)起点；移除额外方向光和重复反射灯板，3个零强度shadow-only Spot提供LTC遮挡。Poisson16tap/接收平面深度修正，非VSM；没有底板外接影平面。官方Blender5.2.3探针更正旧环境推断：useNodes=true，真正Background .05/Strength1，world.color .18未生效。保留明确的弱暖bounce GI近似，不宣称Cycles逐像素一致。

GLB/manifest/布局/运动/CSS原字节保持，所有冻结交付与旧回执留档。当前双向规范为插件docs/LIGHTING-DESIGN.md ↔ 素材库docs/实时光照设计.md；回执sync/receipts/kitchen-lighting-2026-10-28-cycles-review-v2.json，真实测试证据sync/evidence/2026-10-28-cycles-lighting-v2。已部署~/.dsh-test供用户审阅；视觉批准待用户。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 当前光照覆盖：Cycles静态漫反射 · 2026-10-28-cycles-bake-r6

用户继续要求审核图墙角与柔和表面。现用真实Blender AREA/World/场景烘焙+OIDN，16个实例采用静态diffuse/indirect；冰箱/桶保持实时PBR以避免UV黑缝，角色与镜面仍实时。模型/布局/UV0/CSS/路线不变，新增光照UV和纹理由每房间私有管理。改模型/材质/位置/光后必须重烘，全部18源实例/71primitive签名验证后才替换；旧纯实时v2墙角中心投影方案为历史。规范docs/LIGHTING-DESIGN.md ↔ 素材库docs/实时光照设计.md；源组件kitchen/lighting，回执sync/receipts/kitchen-lighting-2026-10-28-cycles-bake-r6.json。~/.dsh-test已部署，视觉审阅待用户；plugin-only，无commit/push/publish。

## 轻量光照覆盖 · 2026-10-28-cycles-shell-r8

用户要求清除新增黑缝、保留墙角柔光并优化性能。当前仅墙地面使用2K Cycles/OIDN、家具原PBR，增加无阴影弱正面面光；UV仅20,832bytes，仍验证全部18来源/71primitive。二进制素材通过插件自有鉴权路由按需加载，Client约2MB；贴图运行时最长边1024，空房按需重绘、角色最多30FPS、静态阴影缓存。原GLB/UV0/布局/路线/CSS保持。明确取舍与重烘要求见插件docs/LIGHTING-DESIGN.md ↔ 库docs/实时光照设计.md；回执sync/receipts/kitchen-lighting-2026-10-28-cycles-shell-r8.json。旧r6为历史；~/.dsh-test已实际验证，视觉批准待用户。plugin-only，无commit/push/publish。

## 糖果感阶段1交接 · 2026-10-28

运行时环境 `kitchen-candy-indirect-s1-v1` 已部署真实~/.dsh-test，四盏直射灯/相机/曝光/GLB/材质/r8 bake均保持。方向性PMREM替代constant+Hemisphere，暗面颜色改善；228tests/typecheck/lint与总览/单间/双角色/冰箱到达/末间/离屏重建验证通过。完整目标、采用参数和局限按素材库docs/厨房糖果感-Spec.md、docs/厨房糖果感-Plan.md及插件同名日期Spec/Plan；阶段2材质、阶段3倒角/法线尚未实施，用户视觉认可待定。冻结Cycles工程未加入此次环境近似。回执sync/receipts/kitchen-look-2026-10-28-candy-s1-v1.json，无commit/push/publish。

## 糖果感阶段2A交接 · 2026-10-28

最终采用refrigerator/2026-10-28-candy-r2（独立材质样板，2820460bytes/29499面/1材质3图片）和真实依赖重烘candy-shell-r12；r1误覆盖金属，作为未采纳历史候选保留。原baseColor、所有几何/UV/COLOR/节点/材质分配保持；局部roughness.27/.30、normalXY×.45/.60、coat.15，金属/叶片/陶盆保护。s1照明环境/相机/曝光/布局与其他17源资产不改。230tests/typecheck/lint与真实~/.dsh-test场景回归通过，视觉最终认可待用户。完整参数、保护检查、实机证据和限制见docs/厨房糖果感-Plan.md与sync/receipts/kitchen-look-2026-10-28-candy-s2a-r2.json；其他材质及阶段3未做。plugin-only，无commit/push/publish。

## 新灶台L形总成 · 2026-10-28（当前采用）

用户新源已归档 `kitchen/stove/source/灶台总成_原始_20261028.glb`；当前交付 `kitchen/stove/deliveries/2026-10-28-r6/manifest.json`。可编辑工程 `kitchen/stove/work/2026-10-28-r6/厨房灶台_加长L形总成.blend`；全厨房验证工程同目录 `L形接缝验证.blend`，脚本与纹理位于该组件，旧工程/交付不覆盖。

用户明确拒绝短版1.812m，并确认置物架应靠底板左前边缘。最终台面长3.247109664m（超过原件按柜高换算2.277416295m）、进深.999625942m对齐水槽左柜实测宽，整体非等比拟合；柜体高按真实台面设置，不按含瓶罐总高归一化。静态2网格/2primitive/2材质/3张1024内嵌图，12655面/2847448bytes。保留原纹理与UV造型；源specularColorFactor2去除、normal强度.35。79part合并同材质，末120mm后凸部分压回台面背沿，防止灶架入墙。

灶台右端与水槽L形相接：柜体侧面WorldZ=-.997，避开突出把手；仅薄矩形奶油收口延伸到Z=-1.064，厚.9mm，底Y=.915754，水槽在该实际足迹下最大Y=.913569，最小竖向间隔2.185mm。视觉留自然接缝，不宣称零间隙实体焊接；没有灶台/水槽全对碰撞豁免。冻结manifest旧说明“shaped profile”应理解为历史候选描述，最终实现是固定薄矩形cap，以上实测和work验收记录为准。

最终场景布局唯一源插件kitchen-layout.ts；库内scene-layout.json已同步。灶台[-1.7901838578,.0252,.6407950015]，烟机Z=.961455086对左灶眼；置物架Z=2.636866053，前沿Z2.99、距底板前缘约1cm、与灶台末端10mm。挂杆留左墙Z2.45以避烟机；地毯X=-.379889624避置物架，桌椅不动。两cook站位[-.82,.961455086]/[-.82,1.361455086]，站位通道与冰箱往返通过实际角色逐帧三角面检查。

新总成没有旧独立门轴/抽屉、炒锅/食材或蓝火焰，不虚构活动能力；做饭活动仍是角色状态表现，不新增手臂/拿取/开火。旧stove交付规则保留回滚，r6使用独立静态规则。原图集烘焙明暗、锅架棱角和细碎重建瑕疵保留，不作为完成材质推广或模型精修。

按最终18实例/57primitive/源hash和布局重新64sample Metal烘焙2K墙地面r15，OIDN为r16，UV20832bytes/16MiB atlas预算，s1环境/相机/四面光/曝光不变。r2/r3/r4/r5和r13/r14保留候选历史，不列当前accepted。实际构建、231项测试、typecheck、lint与~/.dsh-test总览/单间/双角色/冰箱往返/末间/离屏重建通过；视觉最终认可待用户。材质推广暂停，阶段3未开始。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

回执 `sync/receipts/kitchen-stove-2026-10-28-r6.json`，证据 `sync/evidence/2026-10-28-stove-long-l/`；测试服务 http://127.0.0.1:3088/ 保留运行。

## Implementation follow-up · 2026-10-30

The whale-girl runtime now supports the user-authorized face-blink-r2 skin and independent automatic blinking. Static body bob remains only as the procedural fallback. Skeletal walking uses actual .48m/s movement, reversible gait, fade-to-bind stops and sole support; blink timing is independent of activity. Per-actor ownership, reduced motion and demand-render lifecycle are tested. See ../CHARACTER-ANIMATION-VERIFICATION.md for checks and remaining DSH in-app binary timeout; this does not authorize publication or source-library acceptance.

## 2026-10-31 用户范围覆盖

共享会话看板取代旧workspace多厨房和两人活动映射。当前实现与验收以 `2026-10-31-session-board.md` 为准；此前各节为历史，不作为当前产品验收条件。
