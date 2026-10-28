# clutch-dsh-office

Follow the repository AGENTS.md and docs/RELEASING.md. This plugin is strictly
plugin-only: never modify DeepSeek Harness source or patch its private DOM to
provide an Office feature. The DSH checkout is a read-only integration reference.

- Package: `@cerbur/clutch-dsh-office`; release name: `office`.
- Initial MVP work is authorized directly in `wt-office-0.1.0/release`.
- Subsequent features use `wt-office-<version>/feat-<name>` from the matching
  release baseline, with the repository clean/rebase/merge gates.
- Commit, push, publish, and installation into a user's DSH profile still require
  explicit authorization. No such authorization is implied by this document.
- Read both READMEs and `docs/plans/2026-10-26-office-mvp.md` before behavior changes.
- Keep DSH adaptation, Office projection, action scheduling, and Three.js rendering
  separate. Never retain or activate Sessions just to draw a character.
- Runtime session facts stay native; the Office projection is disposable Client
  presentation state. No extra model requests, prompt injection, or Session-log writes.
- MVP renders every native workspace in a single vertical list, at most two active
  Session characters per kitchen. Idle kitchens remain visible without characters.
  Unknown/disconnected state must not be presented as successful completion.
- All public behavior changes update README.md and README.zh.md together.
- Do not commit lib/, node_modules/, browser fixtures' generated output, or credentials.
- Before any Kitchen modeling or visual scene/material/lighting change, open
  `assets/references/kitchen/kitchen-reference.png` and its `reference.json`.
  This user-designated original is mandatory for the entire kitchen; procedural
  whiteboxes, previous renders and component crops do not replace it. Keep its
  library mirror and revision/hash aligned as described in `docs/BLENDER-ASSETS.md`.
- Blender source library: `/Users/yuancheng/Documents/blender/office`; hierarchy is
  `office/<scene>/<component>` with cross-scene art under `office/character/<id>`.
  Kitchen currently includes floor, refrigerator, table, storage-cabinet, left-wall, right-wall,
  pendant-light, sink-cabinet, utensil-rail, stove, wall-cabinet, range-hood, wall-shelf, wall-art, chair, rug and trash-can components plus `character/deepseek`. Read
  `docs/BLENDER-ASSETS.md` before importing art. Import immutable deliveries through
  `assets:import`; commit only the reviewed runtime GLB and manifest, never .blend
  sources. Return a revision/hash acceptance receipt to the library after verification.

- Read `docs/ART-DIRECTION.md` before art/material changes. Its Blender library source
  and `assets/styles/office-soft-toy-v1.json` define the shared palette/PBR language.
  Material-only revisions preserve geometry, UVs, semantic hierarchy and layout.

- Runtime lighting uses `scene/lighting.ts`; read `docs/LIGHTING-DESIGN.md` before tuning.
  Keep generated environment/shadow resources owned by the scene and disposed offscreen.

Latest kitchen wall override: textureless matte cream slabs, nominal0.285m thick (floor-matched), single wall_panel mesh with front_anchor. Older tile/crown/skirting contracts are historical. Four new decor assets are independently adopted; two chairs share one parsed GLB per room. See docs/DECOR-VERIFICATION.md.

Current aligned layout: floor r2/left-wall r4/right-wall r3/trash-can r2. Wall exterior flush with platform; rounded ceramic insert52triangles. User authorized reference-based whole-room rearrangement, including refrigerator/sink shifts for right-side bin; see docs/REFERENCE-LAYOUT-VERIFICATION.md. Preserve old frozen deliveries.

Latest accepted sink/character:2026-10-27-r2. Table[1.45,0,1.15],stoolsZ2.03,rug[-.95,.0255,2.42]; supersedes prior aligned placement. Sink r2 static single mesh without old door/drawer pivots; old revisions remain rollback-compatible. See docs/UPDATED-KITCHEN-VERIFICATION.md and library sync/receipts/kitchen-layout-2026-10-28-fridge-walk-v1.json.

Current fridge-walk motion/acceptance: docs/FRIDGE-WALK-VERIFICATION.md. Preserve route clearance and static character capability.

Latest override: storage-cabinet2026-10-28-r1 static mesh, old wheel pivots absent. Sink uses KITCHEN_SCALE rear-counter fit[1.8667534820395086,1,1.2303512683915283] at[-.75,.024960769226163,-1.4]; user explicitly overrides original-size scene assumption. Keep GLB frozen bytes. See docs/STORAGE-SINK-VERIFICATION.md and library sync/receipts/kitchen-layout-2026-10-28-storage-sink-v1.json.

## Cycles审核光照迁移（2026-10-28）

用户指定的审核图已作为实时光照基准迁移：三softbox灯位/尺寸/线性光色、深灰背景、Neutral曝光和低强度棚拍反射。非Cycles逐像素复制，阴影/间接光为实时近似，含弱半球漫反弹补偿。参数唯一源插件lighting.ts；双向规范docs/LIGHTING-DESIGN.md ↔ 素材库docs/实时光照设计.md，实际回执sync/receipts/kitchen-lighting-2026-10-28-cycles-review-v1.json。审核图和真实脚本长期归档sync/evidence/2026-10-28-cycles-lighting，原厨房主参考不替换。

## 当前渲染覆盖：Cycles review v2（2026-10-28）

用户明确授权相机/光照一起对齐审核图，覆盖旧相机冻结：Three相机[8,7,8.5]→[0,1.3,.5]、ORTHO8.1、俯角26.739586°；三AREA尺寸/位置/linear色与source一致，P/(πA)起点；移除额外方向光和重复反射灯板，3个零强度shadow-only Spot提供LTC遮挡。Poisson16tap/接收平面深度修正，非VSM；没有底板外接影平面。官方Blender5.2.3探针更正旧环境推断：useNodes=true，真正Background .05/Strength1，world.color .18未生效。保留明确的弱暖bounce GI近似，不宣称Cycles逐像素一致。

GLB/manifest/布局/运动/CSS原字节保持，所有冻结交付与旧回执留档。当前双向规范为插件docs/LIGHTING-DESIGN.md ↔ 素材库docs/实时光照设计.md；回执sync/receipts/kitchen-lighting-2026-10-28-cycles-review-v2.json，真实测试证据sync/evidence/2026-10-28-cycles-lighting-v2。已部署~/.dsh-test供用户审阅；视觉批准待用户。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 当前光照覆盖：Cycles静态漫反射 · 2026-10-28-cycles-bake-r6

用户继续要求审核图墙角与柔和表面。现用真实Blender AREA/World/场景烘焙+OIDN，16个实例采用静态diffuse/indirect；冰箱/桶保持实时PBR以避免UV黑缝，角色与镜面仍实时。模型/布局/UV0/CSS/路线不变，新增光照UV和纹理由每房间私有管理。改模型/材质/位置/光后必须重烘，全部18源实例/71primitive签名验证后才替换；旧纯实时v2墙角中心投影方案为历史。规范docs/LIGHTING-DESIGN.md ↔ 素材库docs/实时光照设计.md；源组件kitchen/lighting，回执sync/receipts/kitchen-lighting-2026-10-28-cycles-bake-r6.json。~/.dsh-test已部署，视觉审阅待用户；plugin-only，无commit/push/publish。

## 轻量光照覆盖 · 2026-10-28-cycles-shell-r8

用户要求清除新增黑缝、保留墙角柔光并优化性能。当前仅墙地面使用2K Cycles/OIDN、家具原PBR，增加无阴影弱正面面光；UV仅20,832bytes，仍验证全部18来源/71primitive。二进制素材通过插件自有鉴权路由按需加载，Client约2MB；贴图运行时最长边1024，空房按需重绘、角色最多30FPS、静态阴影缓存。原GLB/UV0/布局/路线/CSS保持。明确取舍与重烘要求见插件docs/LIGHTING-DESIGN.md ↔ 库docs/实时光照设计.md；回执sync/receipts/kitchen-lighting-2026-10-28-cycles-shell-r8.json。旧r6为历史；~/.dsh-test已实际验证，视觉批准待用户。plugin-only，无commit/push/publish。

当前糖果感三阶段改进以插件docs/specs/2026-10-28-kitchen-candy-look.md、docs/plans/2026-10-28-kitchen-candy-look.md与素材库docs/厨房糖果感-Spec.md、docs/厨房糖果感-Plan.md为准；本轮只执行阶段1间接补光/环境反射，完成部分后回写计划。阶段2材质、阶段3倒角/法线暂不执行。

2026-10-28最新授权覆盖：用户同意进入糖果感阶段2A，仅冰箱与顶部鲸鱼材质样板；阶段1视觉改善有限，灯光/环境/相机/曝光/布局冻结。允许独立新材质revision及依赖重烘，具体以厨房糖果感Spec/Plan最新段落为准；其他组件和阶段3暂不执行。

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

## 新组件与全场材质阶段2B · 技术验收通过 / 待用户视觉审阅

2026-10-28：完成两个新原件识别（877fc508为壁柜、d6351445为烟机）、source原件归档及r3独立静态交付。烟机仅按实测火灶平板1.374324739m宽对齐，排除两侧柜；source宽.910972118，场景localX scale1.508635348，中心WorldZ.636263588。保留加长灶台3.247m、L形薄收口、桌椅及角色站位。

窗户采用独立window/candy-r2，原尺寸1.049972×.743585×.260559m、scale1、位置[-.68,1.39,-1.808]。首轮穿插已修复，层架上移14cm至rootY.39以给窗留空间；吊柜[-2.113,1.86,-.7]，挂画[.9,2.79,-1.813]，吊灯[1.95,.6,-1.48]。真实Blender全场BVH只有双墙拼角41对接触，其余家具表面无相交；完整角色往返/中断/转身/减少动态路径测试通过。窗片不透明，无墙洞/透光/室外/开窗动画，也未新增窗光。

全场阶段2分材质推广：14个材质后代（含保留冰箱样板和字节不变地毯审查revision）独立核验所有accessor含COLOR、geometry/UV/节点/材质分配、原baseColor字节保持。新烟机/吊柜是用户授权的几何替换。木、布、金属、叶、食物、皮肤眼睛和图案保护；地板、双墙与已采用冻结GLB逐字节一致。最终26材质/34primitive/47图片，未增加任一既有组件的材质/图片/批次。原色图烘焙明暗、局部三角棱角仍在，第三步几何修形未做。

19实例/34primitive按冻结三AREA、World.05、相机/曝光真实Cycles64sample Metal烘焙r17、OIDN为r18，运行时s1环境/第四前面光保持。仅三墙地接收者2K RGBM8，atlas2709174bytes、UV20832bytes、RGBA16MiB；源GLB42809224bytes(40.83MiB)，Client2004019bytes。二进制白名单按需加载、1024模型贴图、PMREM128、空房按需/角色30FPS、离屏释放保持。新增Physical响应有shader成本，未测FPS/加载耗时，不宣称性能零成本。

实际命令：pnpm --filter @cerbur/clutch-dsh-office build/typecheck/lint；node --test --test-concurrency=1 test/*.test.mjs（235passed/0failed）；pnpm run check:workspace、check:patches（通过，保留既有!!js YAML警告）、git diff --check。材质独立审计与两位只读集成复核无阻断问题。真实~/.dsh-test已安装、重启3088：5空房、单间、双角色气泡、走到冰箱及返回、末间与首间离屏重建通过；最终1canvas/0alert，冷刷新后12:03UTC起warn/error为0。服务重启前旧HMR多Three与连接中断日志为历史，未算成冷加载结果。OS减少动态未手动切换，自动路径/生命周期测试通过。

回执 `sync/receipts/kitchen-candy-s2b-2026-10-28.json`；证据 `sync/evidence/2026-10-28-kitchen-candy-s2b/`；全场验证工程 `kitchen/lighting/lookdev/2026-10-28-kitchen-candy-layout/厨房_最终材质场景验证.blend`。Spec/Plan、美术语言/JSON、光照规范、catalog和各组件HANDOFF已双向同步。阶段2B技术通过与用户视觉认可分开，最终美术批准待用户；阶段3未开始。全程plugin-only，主checkout和DSH源码干净；工作在既有dirty release，不commit/push/publish，不改生产profile。http://127.0.0.1:3088/保留供查看。

## W01–W05挂件接入 · 技术验收通过 / 待视觉审阅

2026-10-28新增五件独立r1：whale-mitt（鲸鱼隔热垫）、wall-clock（木质壁钟）、board-cloth（砧板与抹布）、wall-plant（壁挂盆）、wall-calendar（鲸鱼挂历）。原始GLB逐字节存各组件source，可编辑工程/脚本/纹理/渲染在各自work/2026-10-28-r1，不放插件。交付全为1mesh/1material/3张1024内嵌图，独立命名与预算；不借用冰箱合同，冰箱30k/8MiB和门轴约束保持。挂历与木钟为静态装饰，不显示真实日期/时间。

最终摆放（Three米/Y-up）：隔热垫[-2.307,2.14,2.83]、壁钟[-2.307,2.94,2.62]和左挂盆[-2.302,2.18,2.49]均yaw90°上左前墙；挂历[.43,1.94,-1.807]在水槽右；砧板抹布[2.26,2.13,-1.807]及右挂盆[2.26,1.65,-1.802]在冰箱右侧空墙，yaw0。砧板原放备餐墙被既有物件投影遮住，已明确改到右空墙完整可见，不采用历史试摆坐标。所有新件避开完整灶台/烟机热区，不把随意转盆背穿墙当变化；两盆随两面墙方向差90°、保持竖直，用同一GLB一次parse共享geometry/material/textures并释放一次。

真实Blender全场最终BVH只有两墙拼角41对既有共同表面，其余非地板家具无相交；原桌椅/角色站位/通道/既有19源GLB及manifest38文件逐字节保持，相机/四面光/曝光/s1环境保持。完整活动对/转身/冰箱往返/中断/减少动态路径测试包括全部新挂件和两盆实际变换。新件为本轮尺寸/保UV减面/分材质表面处理，原图案保留；木布叶陶盆按stage2b分别处理，不统一塑料化。原重建棱角、色图烘焙光影/钟盘三角明暗仍在，阶段3未开始。

25实例/40primitive真实Cycles64sample Metal新烘焙r19，OIDN为r20；2K RGBM8、UV20832bytes、RGBA16MiB保持，PNG2680850bytes。24件源GLB共51580792bytes(49.19MiB)，Client2013877bytes，新增挂件源8771568bytes，复用盆只新增一个source和两个绘制实例。1024运行时图、PMREM128、空闲按需/角色最多30FPS、离屏释放保持；未测FPS、加载时延或实测VRAM，不宣称性能零成本。

重复实例由kitchenAssetName和KITCHEN_INSTANCE_GROUPS统一导出/导入/运行时映射。生产bundle入口先解析inline base64/JSON，再验证完整25来源ID/实例集合和assetId；缺右盆、重复/额外ID、错误别名不能让shell提前提交，失败走原fallback。原有部分内存fixture是单元验证，生产守卫不提供可关闭字段。

实际检查：build、typecheck、lint、Prettier、check:workspace、check:patches、git diff --check通过；node --test --test-concurrency=1 test/*.test.mjs共256pass/0fail，含五件独立导入、热区留白、绿植parse一次/释放一次、base64真实入口和失败清理。已有!!js YAML warning保留。真实~/.dsh-test http://127.0.0.1:3088/已安装并重启：5空闲厨房、单间五件全可见、双角色及气泡、冰箱到达与回程、末间与首间重建通过；最终1canvas/0alert，13:26UTC后warn/error0；重启过程旧连接警告单列历史。OS减少动态未手动切换，自动路径/生命周期通过。

回执sync/receipts/kitchen-wall-hangings-2026-10-28-r1.json，证据sync/evidence/2026-10-28-wall-hangings；最终场景工程kitchen/lighting/lookdev/2026-10-28-wall-hangings-layout/厨房_场景验证.blend。catalog、组件HANDOFF、双语README、Spec/Plan和光照规范已更新，技术接受与用户视觉认可分别记录。全程plugin-only，不改DSH源码/生产profile，不commit/push/publish；服务保留供查看。

## 阶段3A烟机样板已部署 · 2026-10-28

用户授权部署后，采用range-hood/2026-10-28-normal-r1，sha256 edf10b059844b8fd0d6f973ea442d3994c4757baf68f8ab3919c5e3c5e47eb7c，2700820bytes/28499三角形。只更新原NORMAL二进制区间，JSON和全部非NORMAL字节（位置、UV、索引、材质、3张1024图片、节点锚点）保持r3原字节。24033顶点精确映射，3个角点分裂冲突按相邻面面积折中，以保留索引；最大小区域误差3.92958°已明确记录。没有新增倒角、拓扑或材质批次。

实际最终GLB已独立Blender回导、CPU固定灯渲染，并经过独立只读字节/法线复核。烟囱三角明暗明显减轻，原图集光影、边缝和细节瑕疵仍在，不声称全部模型精修完成。其他23件源GLB和manifest、布局、路径、相机、灯光参数及runtime s1环境不改。

按完整25实例/40primitive新来源实际Cycles64sample Metal重烘r21，OIDN为2026-10-28-normal-shell-r22。2K RGBM8、PNG2880121bytes、UV20832bytes与16MiB预算保持；来源hash/Three几何签名校验通过，不套用旧光图。新增revision导入白名单保留r3与旧烟机、冰箱等独立约束。

实际build、typecheck、lint、workspace/patches、sync-asset Prettier及git diff --check通过；node --test --test-concurrency=1 test/*.test.mjs为256pass/0fail。已重启明确使用DSH_HOME=/Users/yuancheng/.dsh-test的3088测试服务，真实页面查看5空房、单间、双角色气泡、冰箱到达/回程、末间和首间重建，最终1canvas/0alert，冷加载后warn/error0。未手动切换OS减少动态，自动运动/生命周期测试通过；未做FPS/VRAM/加载时间基准。

回执sync/receipts/kitchen-range-hood-2026-10-28-normal-r1.json；实际截图和日志sync/evidence/2026-10-28-kitchen-candy-s3a/。catalog/HANDOFF/Spec/Plan已双向同步，accepted表示技术验收，最终视觉批准待用户。阶段3A烟机正式部署完成；壁钟局部法线和其余有证据的轮廓修正尚待后续，不把阶段3整体勾为完成。全程plugin-only，不改DSH源码或生产profile，不commit/push/publish。服务http://127.0.0.1:3088/保留供查看。
