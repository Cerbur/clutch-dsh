# Blender asset handoff

Current user-approved room-shell override: width/depth are 5 m and height is 3.5 m.
Both walls retain a5m interior side and3.5m height, scale1; their rounded miter
envelopes are about5.09145m wide and.285174m thick. Plain matte cream replaces tile textures. The historical
left-wall4.4/2.9 runtime stretch has been removed by the user-authorized wall
rebuild; old deliveries remain immutable. Furniture and characters retain their original scale. Left-wall center Z is 0.5,
and the pendant root gains 0.6 m to follow the wall top. Placement tables below describe earlier
acceptance; `kitchen-layout.ts` owns current positions. This shell-only override
was explicitly requested after the initial unit-scale asset acceptance.

The source library is `/Users/yuancheng/Documents/blender/office`. It contains
all Office art, with `office/<scene>/<component>` as the hierarchy for scene art
and `office/character/<id>` for cross-scene characters. Kitchen is a scene;
refrigerator, table, storage-cabinet, left-wall, right-wall, pendant-light and sink-cabinet
utensil-rail, stove, wall-cabinet and range-hood are sibling components. DeepSeek is the first cross-scene character.

Read that library's `AGENTS.md`, `HANDOFF.md`, `docs/素材同步与验收.md`, and the
component's `HANDOFF.md`. The library owns source projects, references, textures,
history and immutable deliveries. This package owns renderer integration and its
adopted GLB/manifest; it must not write back into a delivered snapshot.

## Import

From this package directory:

```bash
node scripts/sync-asset.mjs /Users/yuancheng/Documents/blender/office/kitchen/refrigerator/deliveries/2026-10-27-r1/manifest.json
```

Or from the workspace:

```bash
pnpm --filter @cerbur/clutch-dsh-office assets:import /absolute/delivery/manifest.json
pnpm --filter @cerbur/clutch-dsh-office typecheck
pnpm --filter @cerbur/clutch-dsh-office test
```

The importer explicitly supports these IDs and their matching runtime filenames:

| Asset ID                  | Runtime file          | Triangles | Bytes | Additional contract                                            |
| ------------------------- | --------------------- | --------: | ----: | -------------------------------------------------------------- |
| `kitchen/refrigerator`    | `refrigerator.glb`    |    30,000 | 8 MiB | Independent upper/lower door pivots                            |
| `kitchen/table`           | `table.glb`           |    60,000 | 8 MiB | One material; table/table_mesh/work_surface/prep_anchor        |
| `kitchen/storage-cabinet` | `storage-cabinet.glb` |    30,000 | 8 MiB | Four static batches and four wheel pivots                      |
| `kitchen/left-wall`       | `left-wall.glb`       |    10,000 | 1 MiB | Window-free static wall hierarchy                              |
| `kitchen/right-wall`      | `right-wall.glb`      |    10,000 | 1 MiB | Wall surface only; scene-owned shelf props stay separate       |
| `kitchen/wall-shelf`      | `wall-shelf.glb`      |    55,000 | 8 MiB | Installed height authored; rear-envelope ground projection     |
| `kitchen/whale-mitt` | `whale-mitt.glb` | 10,000 | 3 MiB | One static mesh/material, 3 images; wall-plane-bottom-center |
| `kitchen/wall-clock` | `wall-clock.glb` | 10,000 | 3 MiB | One static mesh/material, 3 images; wall-plane-bottom-center |
| `kitchen/board-cloth` | `board-cloth.glb` | 15,000 | 3 MiB | One static mesh/material, 3 images; wall-plane-bottom-center |
| `kitchen/wall-plant` | `wall-plant.glb` | 12,000 | 3 MiB | One static mesh/material, 3 images; wall-plane-bottom-center |
| `kitchen/wall-calendar` | `wall-calendar.glb` | 15,000 | 3 MiB | One static mesh/material, 3 images; wall-plane-bottom-center |
| `kitchen/window` | `window.glb` | 30,000 | 4 MiB | Opaque static decoration, rear-wall-bottom-center, one mesh/material |
| `kitchen/wall-art`        | `wall-art.glb`        |    16,000 | 2 MiB | Wall-plane-center origin, installation height scene-owned      |
| `kitchen/chair`           | `chair.glb`           |    20,000 | 4 MiB | One asset, two shared-resource instances, floor-center         |
| `kitchen/rug`             | `rug.glb`             |     6,000 | 4 MiB | Walkable surface decoration, floor-center                      |
| `kitchen/trash-can`       | `trash-can.glb`       |    20,000 | 2 MiB | Three materials/six primitives, independent lid/pedal X pivots |
| `kitchen/pendant-light`   | `pendant-light.glb`   |    20,000 | 4 MiB | Hanging hierarchy and light_anchor                             |
| `kitchen/sink-cabinet`    | `sink-cabinet.glb`    |    40,000 | 8 MiB | Three Y-axis doors and one +Z drawer                           |
| `kitchen/utensil-rail`    | `utensil-rail.glb`    |    20,000 | 1 MiB | Wall-plane origin at rail axis                                 |
| `kitchen/stove`           | `stove.glb`           |    40,000 | 4 MiB | Five materials, 20 primitives, closed doors, COLOR_0           |
| `kitchen/wall-cabinet`    | `wall-cabinet.glb`    |    10,000 | 2 MiB | Cabinet-bottom origin, three materials, ten primitives         |
| `kitchen/range-hood`      | `range-hood.glb`      |    20,000 | 2 MiB | Installed height modeled, seven materials, 20 primitives       |
| `character/deepseek`      | `deepseek.glb`        |    60,000 | 8 MiB | One material; static, feet-ground-center, no rig               |

Floor additionally uses `floor.glb`, a5,000-triangle/6MiB/two-material ceiling and
`floor-surface-center` origin. Its52-triangle rounded ceramic insert carries the retained true baked tangent
normals; authored topY=.025 and bottomY=-.26 preserve scene contact.

The importer checks SHA-256, byte count, embedded resources, geometry counts,
hard-coded semantic nodes, coordinates, actual vertex bounds, declared dimensions
and anchors before writing. Do not import and build concurrently.

Delivery budgets may tighten these ceilings but cannot relax them. The original
refrigerator file and constraints are retained when another component is imported.
Use the same command above with the appropriate component delivery path.

Scene-component GLBs use meters, +Y up and +Z forward. Their manifests declare
their origin rather than assuming that every asset has the same root: furniture
uses a floor center, the pendant uses the floor projection of its suspension,
and DeepSeek uses a feet-ground center. Blender's native project uses +Z up / -Y front.
`office/kitchen-layout.ts` owns the metric layout and station coordinates, applied
by `scene/kitchen/index.ts`; do not normalize the total height
including plants. Animation should preserve the initial pivot transform.

`GLTFLoader` asynchronously parses the bundled GLB. A procedural fallback stays
visible until success or after failure. Parsed geometry, materials, textures and
ImageBitmaps belong to the individual scene, including results arriving after
teardown. A successful load explicitly schedules a frame for reduced-motion mode.
Tone mapping uses Khronos PBR Neutral; Blender's AgX studio render is a reference, not an
identical engine lighting setup.

The MVP inlines Base64 asset bytes through a shared tsdown plugin, used by the
actual Client build and fixture. Eighteen GLBs total about 33.50 MiB before Base64
encoding; the current uncompressed Client bundle is about 48.34 MB. There is no
runtime filesystem URL, CDN or DSH source patch. Before scaling to many assets,
replace inline transport with a supported plugin-owned asset service.

## Acceptance / return receipt

Install only into the explicitly authorized profile, restart if needed, and
reload the real Office screen. Check overall/focused rooms, sticker/whale/plants,
orientation, idle rooms and browser errors. Record the adopted revision/hash,
workspace/branch and dirty state, actual commands, test URL and screenshot path
in the library's `sync/receipts/`. Update its catalog to accepted only after this.
Uncommitted integration is described as working-tree, never attributed to HEAD.

The importer does not install, commit, publish or update the library's acceptance
status automatically. Roll back by importing a previous delivery, rebuilding and
writing a new receipt. Both READMEs describe public behavior; this document owns
maintainer details.

## Mandatory Kitchen original reference

Open [the user-designated original](../assets/references/kitchen/kitchen-reference.png)
before Kitchen scene, component, character-art, material or lighting work. Read its
[reference manifest](../assets/references/kitchen/reference.json). Whiteboxes and
previous renders are implementation snapshots, not substitutes for this image.

The scene-level library mirror is `kitchen/references/kitchen-reference.png`.
Both original PNGs and both reference.json files must match byte-for-byte. Keep
component closeups within their component directories and use them as supplements.
Preserve original bytes; save crops/annotations as derived images.

A user-designated revision may originate in either session: preserve the previous
revision, copy the original and same manifest to the other side, verify SHA-256,
update both handoffs/scene instructions, and return a library reference-sync receipt.
Resolve conflicting hashes against the user's specified source, not timestamps.
Future asset delivery manifests should pin referenceId/revision/sha256 under
`references`. Never retrofit a frozen asset delivery. Reference sync itself does
not mean the scene already matches the image or require restarting DSH.

## Current metric layout and clearance

`KITCHEN_PLACEMENT` is the source of truth. The current positions are:

| Component         | Position `[x,y,z]` | Notes                                                                        |
| ----------------- | ------------------ | ---------------------------------------------------------------------------- |
| `left-wall`       | `[-2.7,0,0]`       | Rotate Y `+pi/2`; replaces the old whitebox wall and removes its fake window |
| `right-wall`      | `[0,0,-2.2]`       | Procedural                                                                   |
| `stove`           | `[-2.19,0,-0.15]`  | Rotate Y `+pi/2`                                                             |
| `table`           | `[0.6,0,1.62]`     | Original units; anchors are markers                                          |
| `refrigerator`    | `[2.1,0,-1.65]`    | Original units; decoration is not used to recenter                           |
| `storage-cabinet` | `[-2.04,0,1.55]`   | Left end of the stove run                                                    |
| `sink-cabinet`    | `[0.65,0,-1.79]`   | Left of the refrigerator                                                     |
| `pendant-light`   | `[1.65,0,-0.7]`    | Checked clear of refrigerator topper, shelves and right wall                 |

Table anchors are not utensil hinges. Storage-cabinet wheel axles are local Z;
sink doors are local Y and its drawer travels along local +Z. Character stations
use the clear aisle at `z=0`, and cross-room movement routes through that aisle.
Tests sample actual posed bounds against the table, stove, sink, refrigerator and
left wall. This covers the preset station transitions, not a general navigation
mesh or physics collision system.

## Current reference layout update

Refrigerator `2026-10-27-r2` is adopted. The independent `kitchen/utensil-rail`
uses `utensil-rail.glb`, a 20k-triangle / 1 MiB ceiling, four materials/primitives,
and `wall-plane-center-at-rail-axis` origin. It is placed at `[-0.9,1.72,-2.138]`
against the rear wall, with +Z facing into the room. Its lowest point is 1.050 m,
above the 0.90 m worktop. Do not recenter it or animate its prepared pivots.
Refrigerator x=2.1 gives a 65.6 mm gap beside the sink; the pendant at
`[1.65,0,-0.7]` remains separate from its topper.
See [layout verification](KITCHEN-LAYOUT-VERIFICATION.md).

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
Evidence and real ~/.dsh-test results: [cooking set verification](COOKING-SET-VERIFICATION.md).

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
Results: [material style verification](MATERIAL-STYLE-VERIFICATION.md).

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

## 当前采用：新水槽/鲸鱼娘（2026-10-27）

用户最新要求对应的摆放：桌子仍靠右，先按灶台中线再向外移动0.40m，最终 `[1.45,0,0.55]`；两凳 `[0.95,0.025,1.43]` / `[1.98,0.025,1.43]`。地毯 `[-0.95,0.0255,2.42]` 避开桌椅与活动通道。旧“前排Z1.72”和中线试摆Z0.15均为历史，当前坐标唯一源是插件 `src/office/kitchen-layout.ts`，完整回执 `sync/receipts/kitchen-layout-2026-10-27-centered-v1.json`。

本轮新水槽 `kitchen/sink-cabinet/2026-10-27-r2`（37,971面，4,089,884字节，hash `9b13e43bc017fb7a2e73b7e0159625610d32f52173d0d766fbc0ce879584d238`）与新鲸鱼娘 `character/deepseek/2026-10-27-r2`（57,979面，4,179,544字节，hash `42cf4de8d70b9f2301342afe7979144a5bcf2568c4ed03a3f2578189cab26132`）已通过真实 `~/.dsh-test` 接入。原尺寸scale1；水槽根 `[-0.05,0,-1.463]` 不变。新角色源原件、打包Blender工程、贴图、独立渲染与修复记录都在 `character/deepseek/`；不覆盖旧工程或冻结交付。

水槽r2是静态单网格，没有旧门/抽屉枢轴；导入器按revision显式支持r2，并保留r1/style-r1回滚预算/节点。角色无骨骼与分肢动画，1.50m高、双脚中心原点；原件深蓝身份保留，不用旧角色重染替代。87个UV退化三角形继承自源，局部重建/绘制光影仍在，不宣称完美拓扑或去光照。活动路线在桌子左侧，检索时朝冰箱方向；不是已经实现开冰箱/拿取物品。

实际全量79项测试、build/typecheck/lint/workspace/patch通过；逐帧路径与初始化/转身检查、实际家具BVH及真实浏览器空房/单间/双角色/检索/离屏重建通过。双墙拼角保留41对共同表面接触，其余家具无表面相交。相机/光照/CSS及其余16件GLB保持。18件共34,564,548bytes（32.96MiB），未压缩Client47,583,876bytes。OS减少动态未手动切换；无一般导航/人物互避。plugin-only，无commit/push/publish，测试服务 http://127.0.0.1:3088/ 留在运行。证据 `sync/evidence/2026-10-27-centered-layout`。

## 冰箱行走（2026-10-28）

桌椅再向外20cm：桌子[1.45,0,1.15]、两凳[.95,.025,2.03]/[1.98,.025,2.03]，仍靠右；相对灶台中线累计外移1.00m。找食材预览已增加绕桌走向冰箱前、停留朝冰箱及返回原活动的整体行走动画。角色仍为静态网格，通过转身、平移、轻微起伏表达行走；没有新增骨骼、开门或拿取动画。真实Session的检索分类仍未接入，当前用本地预览入口验收。

最终米制站位、路线策略及验证结果见 `sync/receipts/kitchen-layout-2026-10-28-fridge-walk-v1.json` 的layout/motionAudit。插件布局/运动纯函数为唯一运行时来源，Blender场景与组件工程不内嵌世界坐标；本次不改18件GLB/manifest、材质、相机和全局光照。旧outward/centered回执为历史，不覆盖冻结交付。验收见 `docs/FRIDGE-WALK-VERIFICATION.md`。

## 当前采用：置物柜替换与水槽填角 · 2026-10-28

新版置物柜 `2026-10-28-r1` 已替换旧style-r1，29342面/4069316字节/单静态mesh+primitive+材质/3张内嵌贴图，hash `0eeb04aabea9d090ffc0dab2279c55027ae72cc54611335493f962496ef86e55`。保留原件盆栽、调料、蔬菜、筐和轮子；无旧轮轴/独立食材动作。根位置[-1.715,.024499213707168,1.55]，scale1，轮底对齐地板Y=.025。旧revision节点规则与30k/8MiB/单材质预算保留可回滚，未覆盖冻结快照。

用户明确授权水槽在导入后由场景设置大小以填满转角：采用原r2 GLB字节不变，scale[1.8667534820395086,1,1.2303512683915283]，根[-.75,.024960769226163,-1.4]，世界宽3.08m、深.80m，总高约1.35m，台面高度仍约.925m（含地板修正）。左侧接近左墙转角，右侧与冰箱约50mm缝，后侧距墙约15mm。此为明确非等比场景fit例外，整体总成包括龙头/毛巾/瓶罐同步横向拉宽，不声称重新建模或保持所有细节原始比例。manifest仍描述原始资产尺寸，场景缩放唯一源KITCHEN_SCALE，不写回GLB/Blender工程。

桌子[1.45,0,1.15]、凳Z2.03、其余16件GLB与水槽GLB/manifest、相机/CSS、冰箱行走策略保持；用户后续授权的Cycles预览灯光迁移另见光照文档与回执。扩大后的水槽参与实际变换碰撞检查；置物柜与挂杆只有粗包围重叠，实际三角面无交，不为包围盒误报移动家具或忽略断言。Blender全家具BVH仅双墙41对共同接触，其余无表面交。新源图集既有烘焙明暗/台面轻微三角明暗保留；真实页面已查看，不宣称完全去光照。

100项测试、build/typecheck/lint通过，实际~/.dsh-test总览/单间/双角色/走到冰箱/末间与离屏重建通过，浏览器状态详见回执 `sync/receipts/kitchen-layout-2026-10-28-storage-sink-v1.json`。plugin-only；服务 http://127.0.0.1:3088/ 保留运行，无commit/push/publish。

插件验收 `docs/STORAGE-SINK-VERIFICATION.md`。

## 新灶台L形总成 · 2026-10-28（当前采用）

用户新源已归档 `kitchen/stove/source/灶台总成_原始_20261028.glb`；当前交付 `kitchen/stove/deliveries/2026-10-28-r6/manifest.json`。可编辑工程 `kitchen/stove/work/2026-10-28-r6/厨房灶台_加长L形总成.blend`；全厨房验证工程同目录 `L形接缝验证.blend`，脚本与纹理位于该组件，旧工程/交付不覆盖。

用户明确拒绝短版1.812m，并确认置物架应靠底板左前边缘。最终台面长3.247109664m（超过原件按柜高换算2.277416295m）、进深.999625942m对齐水槽左柜实测宽，整体非等比拟合；柜体高按真实台面设置，不按含瓶罐总高归一化。静态2网格/2primitive/2材质/3张1024内嵌图，12655面/2847448bytes。保留原纹理与UV造型；源specularColorFactor2去除、normal强度.35。79part合并同材质，末120mm后凸部分压回台面背沿，防止灶架入墙。

灶台右端与水槽L形相接：柜体侧面WorldZ=-.997，避开突出把手；仅薄矩形奶油收口延伸到Z=-1.064，厚.9mm，底Y=.915754，水槽在该实际足迹下最大Y=.913569，最小竖向间隔2.185mm。视觉留自然接缝，不宣称零间隙实体焊接；没有灶台/水槽全对碰撞豁免。冻结manifest旧说明“shaped profile”应理解为历史候选描述，最终实现是固定薄矩形cap，以上实测和work验收记录为准。

最终场景布局唯一源插件kitchen-layout.ts；库内scene-layout.json已同步。灶台[-1.7901838578,.0252,.6407950015]，烟机Z=.961455086对左灶眼；置物架Z=2.636866053，前沿Z2.99、距底板前缘约1cm、与灶台末端10mm。挂杆留左墙Z2.45以避烟机；地毯X=-.379889624避置物架，桌椅不动。两cook站位[-.82,.961455086]/[-.82,1.361455086]，站位通道与冰箱往返通过实际角色逐帧三角面检查。

新总成没有旧独立门轴/抽屉、炒锅/食材或蓝火焰，不虚构活动能力；做饭活动仍是角色状态表现，不新增手臂/拿取/开火。旧stove交付规则保留回滚，r6使用独立静态规则。原图集烘焙明暗、锅架棱角和细碎重建瑕疵保留，不作为完成材质推广或模型精修。

按最终18实例/57primitive/源hash和布局重新64sample Metal烘焙2K墙地面r15，OIDN为r16，UV20832bytes/16MiB atlas预算，s1环境/相机/四面光/曝光不变。r2/r3/r4/r5和r13/r14保留候选历史，不列当前accepted。实际构建、231项测试、typecheck、lint与~/.dsh-test总览/单间/双角色/冰箱往返/末间/离屏重建通过；视觉最终认可待用户。材质推广暂停，阶段3未开始。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

回执 `sync/receipts/kitchen-stove-2026-10-28-r6.json`，证据 `sync/evidence/2026-10-28-stove-long-l/`；测试服务 http://127.0.0.1:3088/ 保留运行。

## Current kitchen integration · 2026-10-28 Stage2B

New range-hood/wall-cabinet r3 are static single-mesh revisions, with dedicated importer overrides; historical node/budget rules remain. Hood r3 permits30k/4MiB, wall-cabinet stays10k/2MiB; both1material/primitive/3images. Stove, sink and storage candy-r1 explicitly inherit their already-adopted static contracts. Refrigerator ceiling and door constraints remain untouched. Window uses its own ID/file/origin and30k/4MiB/1material/primitive rule, not a refrigerator or wall alias.

Current material/profile/source/position/acceptance are in [verification](KITCHEN-CANDY-S2B-VERIFICATION.md), the Spec/Plan and the library catalog. The original new user GLBs are archived under their corresponding component source directories; immutable deliveries remain unchanged. Source geometry/UV/COLOR/baseColor protection is independently audited for14 material descendants. Lighting validates all19 static instances, including the shared two-chair source and the window.

## W01–W05 wall decorations · 2026-10-28

whale-mitt/wall-clock/board-cloth/wall-plant/wall-calendar are independently imported r1 deliveries. Source originals and editable Blender projects remain in office/kitchen/<component>. Five assets add six scene instances because wall-plant is reused on two walls. kitchenAssetName is the common resource identity mapping for import/export; KITCHEN_INSTANCE_GROUPS supplies the runtime clone groups. Each room parses the plant once and shares geometry/material/textures, disposing them once. The plant transforms face the two walls (Y90°/0°) while keeping upright backplates.

The production bake provider decodes inline base64/JSON first, then checks all current source IDs and instance keys plus resource aliases before downloading or applying the atlas. A missing plant cannot let the shell commit early. Imported r20 validates25instances/40primitives and their source hashes, transforms and exact geometry signatures. Clock/calendar are decorative, no real-time information or interaction capability is inferred.
