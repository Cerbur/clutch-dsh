# clutch-dsh-office

Follow the repository AGENTS.md and docs/RELEASING.md. This plugin is strictly
plugin-only: never modify DeepSeek Harness source or patch its private DOM to
provide an Office feature. The DSH checkout is a read-only integration reference.

- Package: `@cerbur/clutch-dsh-office`; release name: `office`.
- Initial MVP work is authorized directly in `wt-office-0.1.0/release`.
- New feature worktrees follow the current root convention `wt-office/feat-<name>` from main. This ongoing user-authorized final MVP continues in the existing release without merging dirty worktrees.
- Commit, push, publish, and installation into a user's DSH profile still require
  explicit authorization. No such authorization is implied by this document.
- Read both READMEs and `docs/plans/2026-10-26-office-mvp.md` before behavior changes.
- Read [Office maintenance constraints](docs/CONSTRAINTS.md) before changing behavior
  or assets. Keep implementation constraints, asset revisions and iteration notes
  there or in its linked specialist documents; the bilingual READMEs are the public
  product introduction, installation and usage guide.
- Keep DSH adaptation, Office projection, action scheduling, and Three.js rendering
  separate. Never retain or activate Sessions just to draw a character.
- Runtime session facts stay native; the Office projection is disposable Client
  presentation state. No extra model requests, prompt injection, or Session-log writes.
- Current MVP is one shared Session kitchen, maximum four characters, plus the complete recent native Session list. Running, pending-interaction and native unread completion qualify; workspace multi-kitchen design is historical.
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

## 当前采用：窗顶对齐蓝柜、右侧低架左移 · 2026-10-28

按用户最后两次补充：窗X=-1.78贴近左墙内侧，Y=1.8800518369674686、Z=-1.808；窗顶与蓝色吊柜顶实际同为2.6236367m，左侧窗框距墙表面约9.92mm。双层置物架[-.10,.15,-1.813]，在右侧降低24cm的基础上再左移20cm；挂历[-1.35,2.72,-1.807]上移让出窗框。只改这三件实例位置，所有模型GLB/manifest/材质/UV/尺寸、其他布局、角色站位路径、相机、四灯/曝光及s1环境保持。

全场实际BVH只有双墙拼角41对既有接触，无新增家具穿插；固定机位完整预览已查看。完整25实例/40primitive真实Cycles64sample Metal重烘r29，OIDN为2026-10-28-window-top-shell-r30；源hash/Three几何签名/布局严格校验，2K RGBM8、UV20832bytes与16MiB预算保持。r23至r28是用户连续调整期间的中间试摆，保留历史、不代表最终采用；外退15cm候选未采用。

最终build/lint、布局Prettier、git diff --check通过；最新资源/光照/几何导出针对回归96pass/0fail。左右互换基线全套256pass/0fail在前一轮已实际执行，本次微调未重复全套，避免把旧结果称为最新全量测试。真实 ~/.dsh-test http://127.0.0.1:3088/ 已重启并查看总览、单间及重建，最终1canvas/0alert，Office冷加载后warn/error0。

回执sync/receipts/kitchen-layout-2026-10-28-window-top-align-v1.json；证据sync/evidence/2026-10-28-window-top-align/；完整可编辑验证工程kitchen/lighting/lookdev/2026-10-28-window-top-align/厨房_场景验证.blend。catalog、组件HANDOFF、双语README、Spec/Plan和光照文档双向同步。accepted为技术验收，最终用户视觉认可待审。阶段3其余任务仍待做。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 当前采用：双层置物架再左移20cm · 2026-10-28

用户追加要求只移动wall-shelf：[-.10,.15,-1.813]→[-.30,.15,-1.813]，精确再左移20cm。高度、深度、旋转与scale不变；窗户与蓝柜顶对齐、贴左墙的细缝、挂历和其他实例位置及全部GLB/manifest/材质/光机/角色路径保持。实际全场BVH只保留双墙拼角41对既有接触，无新增家具穿插。

完整25实例/40primitive按真实新位置重烘Cycles64sample Metal r31，OIDN为2026-10-28-shelf-left-shell-r32；全部source hash/布局/Three几何签名导入通过，2K RGBM8/UV20832bytes/16MiB预算保持。build/lint/布局Prettier/git diff --check、最新资源与光照定向回归96pass/0fail；本次位置微调未重复此前全量256项，二者不混称。真实 ~/.dsh-test http://127.0.0.1:3088/ 已重启并查看，最终1canvas/0alert、冷加载warn/error0。

回执sync/receipts/kitchen-layout-2026-10-28-shelf-left20-v1.json；证据sync/evidence/2026-10-28-shelf-left20/；完整验证工程kitchen/lighting/lookdev/2026-10-28-shelf-left20/厨房_场景验证.blend。catalog、双语README截图、Spec/Plan与HANDOFF已对齐，accepted为技术验收，用户视觉认可待审。此前新基线提交由用户/外部流程创建，本轮不提交/推送/发布；仅在现有release保留小范围变更。plugin-only，无DSH源码或生产profile修改。

## 当前采用：拿取高度与窗下三盆 · 2026-10-29

隔热垫[-2.307,1.43,1.75]移至左墙橙色挂杆右边，挂点约1.811m；砧板抹布[-2.307,1.12,-.70]、yaw90°、scale1.2，置蓝柜下备餐台上方，顶1.72m、底1.12m。备餐区允许可拿取挂件，实际火灶/烟机热柱仍留空，覆盖早期整条柜台禁止装饰的粗约束。挂历[2.26,1.08,-1.807]移至冰箱右侧墙、原盆栽下方，顶1.56m、垂直间隙90mm。

窗下三个wall-plant实例X[-2.12,-1.78,-1.44]、Y1.4/Z-1.802，scale.85，间距34cm，顶约1.7575m、距窗底约12.25cm。保留原左右两盆，五盆同一GLB一次parse，共享geometry/material/textures且只释放一次，显式重置每实例旋转/缩放。只增加实例，没有复制源资源或修改现有模型/材质。窗顶对齐蓝柜、右架X-.30、桌椅/活动站位/相机/四灯/曝光及s1环境保持。

实际Blender全场BVH只有双墙拼角41对既有接触，无新增家具穿插；固定机位预览及可编辑工程在kitchen/lighting/lookdev/2026-10-29-kitchen-reach/。完整28实例/43primitive真实Cycles64sample Metal重烘r33，OIDN为2026-10-29-reach-shell-r34；2K RGBM8、atlas2695451bytes/hash88d7ab438cfa6cc1713eadf9d8c3d089f7ac777dd65eca257f0ea8a6eea77846，UV20832bytes、16MiB预算保持。新三盆增加3绘制实例/35697三角形，未做FPS/VRAM/加载时延基准。

最终build/typecheck/lint、源代码与测试Prettier通过，全套node --test --test-concurrency=1 test/*.test.mjs为256pass/0fail，包括五盆身份完整性、parse/释放一次和实际角色路径。真实 ~/.dsh-test 页面结果见回执browser字段与截图：总览、单间、本地双角色与冰箱行走，最终单canvas/无alert/Office光照无fallback。初次浏览器曾有光图fetch超时，图片直接打开后重载成功；根因未确认，不宣称代码修复，不改传输/超时/源代码边界。最终重启后检查独立记录；其他插件连接重试日志不冒充Office错误，也不宣称全页面历史零告警。

回执sync/receipts/kitchen-layout-2026-10-29-reach-v1.json，证据sync/evidence/2026-10-29-kitchen-reach/。当前调整为静态视觉拿取高度，不包含骨骼拿取或人体工学认证；阶段3壁钟法线等仍待后续，最终美术批准待用户。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。测试服务http://127.0.0.1:3088/保留供查看。

## 当前采用：四处局部暖光 · 2026-10-29

按厨房主参考新增烟机下方、双层架下方、窗户、鲸鱼吊灯四处暖光。参数唯一源src/office/kitchen-practicals.ts（kitchen-warm-practicals-v2），编译后导出同一JSON供Blender，不手工维护两份灯位。烟机26W/1.12×.26m、层架22W/1.22×.12m、窗户16W/.78×.46m，线性色分别[1,.53,.22]/[1,.55,.24]/[1,.64,.32]；鲸鱼灯16W等效point、linear[1,.57,.25]、运行时范围1.6m，按light_anchor下移7cm置于不透明灯罩下方。

窗格用根局部坐标发光蒙版，不新建悬浮面片、不把木框/整物件涂黄。实际四窗格射线测得前表面深.097m，凸木框>.15m；采用depth≤.115m、|X|≤.455m、Y .10–.68m，linear[1,.64,.27]×.9发光。Four-pane真实GLB回归验证四块窗格均发光、木框不发光，原PBR/UV/贴图/材质批次保持。r35/r36初试蒙版只点亮部分窗格，为历史候选，不作为采用版本。

保留全部源GLB及manifest、28实例布局/几何签名、主三softbox、弱正面面光、相机、Neutral曝光1、s1反射与既有角色路线。Three新增3RectArea+1Point，合计7Rect/4shadow-only Spot/1Point；原前三面光与四阴影proxy排序保持，shadow shader只给前三光采样对应贴图，新增三光不借用角色shadow。点光由场景rig单一拥有，组件不重复创建。无新增shadow map，无额外模型贴图或绘制实例；多四盏灯增加BRDF成本，未做FPS/VRAM/加载基准。

按完整场景真实Cycles64samples Metal重烘r37，OIDN降噪采用2026-10-29-practical-shell-r38。仅墙地面漫反射接收2K RGBM8新图，UV20832bytes/atlas16MiB预算保持，PNG2852348bytes/hash5d596e85b1fdbc810ff122123b2434b58a43756243d6185b46bec65347d735ae。家具及角色接受实时暖光、镜面/发光保留，烘焙墙地面漫反射不再重复加实时光。Blender的面积/点光和Three等效标定在阴影、点光半径/距离截断上有引擎差异，不声称逐像素相同。窗户仍为不透明装饰总成，无墙洞、室外、透射或bloom。

实际build/typecheck/lint与源代码/测试Prettier通过，全套node --test --test-concurrency=1 test/*.test.mjs为264pass/0fail。真实 ~/.dsh-test 总览/单间/本地角色与找食材/离屏重建结果见回执browser字段和截图，最终1canvas/0alert、冷刷新后warn/error0。测试服务启动保留当时已有额外测试patch，未改其文件或其他插件。阶段3其余壁钟法线/几何工作仍待后续，本轮为灯光增强；最终美术认可待用户。

回执sync/receipts/kitchen-lighting-2026-10-29-practicals-v1.json；证据sync/evidence/2026-10-29-kitchen-practicals/；可编辑主工程kitchen/lighting/lookdev/2026-10-29-practical-shell-r37/厨房_Cycles光照烘焙.blend，脚本归kitchen/lighting/scripts。Spec/Plan、双语README、光照规范、catalog与四组件HANDOFF双向对齐。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。http://127.0.0.1:3088/保留运行。

## 当前采用：左墙生活收纳四件 · 2026-10-29

四件独立交付均为2026-10-29-r1：小调味架spice-rack（.74×.703457×.269506m/20313tri）、开放木格柜open-cubby（.22×.737380×.157793m/5834tri）、黑挂钩杆black-utensil-rail（.82×.625123×.138354m/10622tri）、迷你收纳盒wall-storage-box（.38×.301498×.180226m/11649tri）。各单mesh/primitive/material、三张1024内嵌图、normal .35；独立25k/10k/15k/15k面和各4MiB上限，冰箱30k/8MiB约束保持。原始用户文件逐字节保存在各source，中文可编辑工程/脚本/纹理/审核图在work/2026-10-29-r1；冻结delivery不回写accepted状态，以本回执和catalog为准。四件原拓扑/UV保留，原图明暗及重建瑕疵仍在。

摆放唯一源src/office/kitchen-layout.ts：调味架[-2.307,2.06,2.45]、黑挂杆[-2.307,1.35,2.45]在左推车上方，挂杆顶1.975m、距调味架底约85mm；窄格柜[-2.307,1.86,-.18]紧邻蓝柜，顶2.597m为低频上层收纳。三者yaw90°/scale1。收纳盒原试摆在水槽右后方被冰箱遮挡，最终[2.26,1.65,-1.807]、yaw0/scale1，顶1.9515m；右挂盆升至Y2.15，挂历维持Y1.08，三者同列、两处净距约198.5/90mm。不采用隐藏的候选位置。

为留出新收纳空间，蓝柜后移14cm至Z-.84、砧板抹布至Z-.95且保留120%尺寸；旧橙杆移备餐区[-2.307,1.63,-.36]、等比45%，避免两套全尺寸挂杆重复；左挂盆移Z1.67。其余家具/窗户/桌椅/角色站位路线、相机/曝光/softboxes/practical-v2参数及全部既有GLB/manifest字节保持。灶眼和烟机实际热柱留空：左盆位于备餐侧的非火灶区域，覆盖旧“整条台面上空一律禁挂”的粗规则，保留两个fire anchor热柱反例检查。

全场真实Blender BVH仅双墙拼角41对既有接触，无新增非地面相交。最终32实例/47primitive全部参加Cycles64samples Metal光照计算；仅墙地面接收新2K RGBM8/OIDN，采用2026-10-29-left-decor-shell-r40（raw r39），UV20832bytes、atlas16MiB预算保持，PNG2766589bytes/hash1fbf55f5adb0cdeb14ef29dae92424dd1ca3731d4641f66d59d595eaee62d5b2。家具仍实时PBR，保留四处暖光，不增加shadow map。四新件增加48418tri/8556396bytes/四次静态绘制，未做FPS或加载基准，不宣称零成本。

实际build/typecheck/lint/Prettier/workspace/patches通过，完整含真实素材库校验290tests/0fail；角色双人绕桌、冰箱往返及中断碰撞检查覆盖32实例。真实~/.dsh-test总览/单间/本地预览/离屏重建与最终资源加载结果见browser字段；最终美术认可待用户，静态挂件不具备拿取/开门动画。回执sync/receipts/kitchen-left-decor-2026-10-29-r1.json，证据sync/evidence/2026-10-29-kitchen-left-decor/，主工程kitchen/lighting/lookdev/2026-10-29-left-decor-shell-r39/厨房_Cycles光照烘焙.blend。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 当前采用：灶台规整柜体与双炉头精修 · 2026-10-29

用户四张新参考已长期保存kitchen/stove/work/2026-10-29-refined-r1/references，并记录原图hash。主厨房原参考继续保留。用户明确授权本组件重建几何，覆盖材质阶段对此件的形体冻结；当前delivery为2026-10-29-refined-r1，hash0f7756d88da214ff51f5a4e4601bfe1dcb928c97c59b34e8610b70580347e1a2，777032bytes，31532tri/3mesh/3primitive/3material/3张1024内嵌图，40ktri/4MiB上限未放宽，旧r6/candy快照保持不可变。独立refined契约不影响旧版门轴或其他组件。

重做蓝色柜体/脚块/封板、左右各.777m等宽奶油门板与抽屉、镜像中心±1.164m、统一分缝和暖金把手；右柜不再用被横向拉伸的重建表面。双炉头为规整黑搪瓷灶面、铸铁方形框/凸支架、金色炉圈、黑顶盖和暖金旋钮；烤箱重做金属面板/拉手、内搁架及单独烟色玻璃。真实圆角/加权法线，非单纯提高贴图锐度。基础色是无摄影棚明暗的分区色板，roughness/metallic按漆、搪瓷、铸铁、裸金属、标签和瓶身独立响应；不宣称已经烘焙高模法线。源图微细石纹/透明油瓶精度仍有差异，本版瓶罐为简化静态几何。

保留加长台面3.247109664m×.999625942m、work_surface高度.891553998m、现有stove根位置/yaw、全部历史安装锚点、实际接缝cap顶点世界坐标、烟机火灶中线、桌椅/水槽/挂件/角色站位与路线、相机/曝光/practical-v2灯位。burner锚点是安装工作平面，不是炉架顶或角色手部接触点。新的柜门只是闭合静态造型，没有runtime门轴、开门/拿取、炒锅或火焰能力；不能套旧r1动作。

中文可编辑工程kitchen/stove/work/2026-10-29-refined-r1/灶台_规整柜体双炉头.blend；隐藏“可编辑零件_不导出”collection保留单件参数，runtime仅opaque图集合批、烟色玻璃及既有cap三批。脚本同work/scripts/build.py，parent-stove.glb/parent-manifest.json保留精确前版，四视图前后在同灯光/相机32sample CyclesCPU渲染。最终独立GLB回导零退化三角面/零无效法线，非继承旧验证。正式delivery冻结后再从该路径导入。

真实全场Blender BVH仅双墙41对历史拼接接触，无新增家具穿插；完整角色路径测试覆盖新实体。32实例/48primitive重新Cycles64sample Metal、OIDN烘焙，当前2026-10-29-stove-refined-shell-r42（raw r41），仅墙地面2K RGBM8，UV20832bytes/atlas16MiB预算保持，PNG2782504bytes/hash5c8f2fde5c860e184a521cb790c76120783e34882992508e604494c66e494213；全部其他厨房GLB/manifest保持。本轮仅importer增加独立revision、替换灶台及依赖光照，不通过实时材质替换掩盖模型问题。收尾发现并行角色/动画文件变化，明确列入回执externalConcurrentChanges，保留不覆盖；本轮300tests与截图对应已构建的灶台集成产物，不把之后的角色源码修改冒充已验收。

实际完整300tests/0fail，build/typecheck/lint/Prettier/workspace/patches通过；真实~/.dsh-test单间/总览/本地双角色与冰箱活动、光照加载及浏览器结果见回执browser。最终美术批准待用户，Stage3仅灶台此子项技术完成，壁钟等其余几何修正仍未完成。回执sync/receipts/kitchen-stove-2026-10-29-refined-r1.json；证据sync/evidence/2026-10-29-stove-refined/。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## Whale-girl animation integration · 2026-10-30

The working tree now imports character/deepseek 2026-10-29-face-blink-r2: 31-bone skin, skeletal Walk_InPlace and independent random morph blinking. The historical static-character restriction is superseded for this revision. Each actor owns its skeleton/morphs/mixer; speed .48m/s, stop fades to bind pose, sole support corrects interpolation dips. Reduced motion and hidden/offscreen cleanup are covered. Dynamic characters remain excluded from shell bake signatures; preserve the latest concurrent static furniture/bake changes. See docs/CHARACTER-ANIMATION-VERIFICATION.md. Integration is deployed to .dsh-test, with final in-app DSH binary cold-loading still timing out; do not mark the library revision accepted or claim full-suite success.

## 当前采用：冰箱本体与鲸鱼精修、原绿植精确保护 · 2026-10-30

用户四张新参考归kitchen/refrigerator/work/2026-10-29-refined-r1/references，hash入清单；主厨房参考不替换。新采用2026-10-29-refined-r1，hash4b9c6615a097d5cddf93e8c60742621377153437cdb7fd4a9eb36a30b3669ce4，2696828bytes/26848tri/5mesh/5primitive/2material/6内嵌图。仍30ktri/8MiB，旧candy-r2及更早delivery保留。真实Blender重建平整圆角壳、上下门、银色弧形把手、规整便笺与鲸鱼磁贴、圆润鲸鱼主体/连续白肚皮/黑眼高光/粉色腮红/侧鳍/翘尾/喷水饰。非仅调粗糙度或假装修复贴图，未做微细肚皮刻线，便笺与照片是简化造型而非逐像素重现参考。

用户明确要求绿植不变，原参考图陶土盆栽9300tri单独保护：顶点/索引/UV/法线/材质参数/三张原嵌图逐字节复用，root/top/plant世界变换原样，花盆/叶片没有重拓扑、缩放、改色或移动。原图集保留供盆栽，新增本体鲸鱼共享的三张1024图；GLB原字节拼接脚本scripts/merge-plant.py重定位资源索引，plant-protection.json与测试使用真实parent证明内容相等。上下门原local-Y右铰链translation及extras原JSON精确保留；新门板为各pivot子mesh，仍闭合静态展示，无内胆/开门活动交付。源工程kitchen/refrigerator/work/2026-10-29-refined-r1/中文冰箱_本体鲸鱼精修.blend，隐藏可编辑零件保留。

原盆栽位置不动；新壳顶约低于盆底1mm，鲸鱼缩至90%并移到不碰原叶片的位置，独立最终GLB审阅证实plant与壳/门/鲸鱼零表面交。新白肚皮通过连续球面UV底色呈现，没有拼接半球接缝。原盆栽旧贴图里的光影与形体瑕疵按用户要求保留，不宣称去光照；新壳/鲸鱼色板不烘焙摄影棚明暗。同机位/同灯光32sampleCPU四视图前后已实际渲染，独立回导零退化三角面/零无效法线。

房间布局、冰箱根坐标、水槽/垃圾桶/吊灯位置、桌椅与角色站位/路线、相机/曝光和practical-v2灯位保持。全厨房真实BVH仅双墙41对历史共同面，无新增家具相交。完整32实例/48primitive按新几何重烘Cycles64sampleCPU/OIDN，采用2026-10-29-fridge-refined-shell-r46（raw r45，r43 Metal未完成候选不采用），仅墙地面2K RGBM8，UV20832bytes/atlas16MiB预算保持；atlas2790317bytes/hash285e64ebd46634725dd256d68d07ee3c913a471e1724192175399b559d004b53。其他厨房GLB及manifest字节保持；并行角色/动画变化仅列入回执、不覆盖或归因本轮。新增三张模型贴图有内存成本，未做FPS/VRAM基准，不宣称零开销。

实际完整316tests/0fail（含真实parent植物字节/材质/变换与铰链校验）、build/typecheck/lint/Prettier/workspace/patches通过，真实~/.dsh-test页面加载/双角色与冰箱预览/控制台结果见browser。早期启动曾有冰箱与光图请求超时，临时诊断证实Host已完成读取；随后重载成功，根因未确认，不宣称已修复传输。临时诊断已移除，未改超时阈值或DSH源码，最终构建重启后无回退告警。此为技术验收，最终美术认可待用户。Spec/Plan只将冰箱本子项完成，其他Stage3几何工作不冒充完成。revision和证据目录保留开始制作的2026-10-29，技术验收于2026-10-30完成。回执sync/receipts/kitchen-refrigerator-2026-10-29-refined-r1.json；证据sync/evidence/2026-10-29-fridge-refined/。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 用户撤回冰箱精修：恢复前一版 · 2026-10-30

用户明确不接受本体/鲸鱼精修外观，当前恢复refrigerator/2026-10-28-candy-r2（SHA256 250242b0f81f83e1efbf1ac82f686eb464dfcba89b0ed2ff13138bda49e6b6c4），同时恢复与旧冰箱几何相符的2026-10-29-stove-refined-shell-r42光照。只撤回本轮冰箱，不撤回已精修灶台、新挂件、当前布局、暖光参数或并行角色动画改动。

2026-10-29-refined-r1及r46光图为已撤回候选，前一节技术测试通过不代表用户美术认可；不能再次默认采用。精修Blender工程和不可变交付保留为历史，catalog当前采用与插件资源恢复旧版。仅依赖被撤回形体的新增测试从当前回归移出，原文归sync/evidence/2026-10-30-fridge-rollback/rejected-refinement-test.mjs.txt，原candy材质回归恢复。不得自动回滚其他改动。当前回执sync/receipts/kitchen-refrigerator-2026-10-30-rollback-v1.json。全程plugin-only，无commit/push/publish。

## 当前最终MVP：共享会话看板 · 2026-10-31

用户明确覆盖旧workspace设计，当前计划docs/plans/2026-10-31-session-board.md优先。原生pending/running/completionUnread语义参照notification-bell；只取list.ids成员，排除空白/归档/subagent/catalog-only。原生子agent运行汇总父会话；Office不管理已读、不保留会话或读历史。单全宽厨房、最多4位稳定角色、常驻标题/workspace/右侧状态气泡，点击通过ctx.uiWorkspace.openSession导航。下方按更新时间降序完整列表，不限4条。此为公开行为覆盖，不恢复旧workspace页面。

用户指定角色2026-10-29-face-blink-r2，恢复原PBR，不应用后续anime/cel效果；每角色独立骨架/随机眨眼。为4人游走使用scene scale .75和真实网格验证通道，源GLB原尺寸不改；厨房GLB/布局/相机/光照保持。拒绝的冰箱精修继续仅作历史。

## 2026-10-31 用户补充：隐藏空闲会话

场景与下方列表统一仅展示运行、待确认/待回答/计划待审、未读完成会话；空闲行不展示。列表仍不受四角色上限限制，按更新时间降序保留完整身份信息。原生清已读或停止且无未读/待交互时，同步移除角色与列表行。顶部只显示一个活跃会话计数。此前包含全部空闲最近会话的说明和223行截图为历史。

## 当前页面收敛验收 · 2026-10-31

标题为“胡闹厨房”，品牌保持“DSH Office”，小Tag从package.json版本自动构建注入（当前v0.1.0），不新增版本常量。就绪场景移除左下角色数/溢出角标，异常与连接中提示仍保留；顶部全量活跃计数不变。底部仅title/workspace，移除路径/ID/普通更新时间，行点击导航及完整可访问标题保持。运行右侧旋转指示与每秒执行时长；未读完成为勾形图标与完成时间，完整日期在提示与time.dateTime；待确认/待回答/计划待审仍显示状态。减少动态偏好停止旋转，页面隐藏时暂停展示计时器。

时间参考wt-worktree-0.1.20/feat-notification-bell的activityClocks：首次使用原生updatedAt，观察到running切换时采用观察时刻，新prompt更新时间增加会重置运行计时；相同状态和重命名不重置。未观察到结束的完成行使用原生更新时间作基准，不宣称精准Host完成时间，不retain或读取历史。缺失时间明确未知；显示时钟仅内存且已退出会话被清理。

实际Host/Client TypeScript构建、Client bundle、ESLint与格式通过；node --test test/session-board.test.mjs test/native-slots.test.mjs test/runtime-demand.test.mjs为25pass/0fail，涵盖状态切换/新运行/更新时间/缺失时间/未来时间/秒分小时及SSR紧凑字段。内置浏览器~/.dsh-test验证真实0活跃空态、四状态本地预览、旋转transform变化、执行时长推进、完成时间稳定、标题/版本/无角标、1canvas/0alert与刷新后无warn/error；本轮未启动新模型任务，真实原生running->unread导航属于前轮历史验证，勿冒充本轮重跑。

回执sync/receipts/office-session-board-2026-10-31-compact-ui-v1.json，证据sync/evidence/2026-10-31-office-compact-ui/。README截图明确为本地模拟，最终内置浏览器返回真实Office。模型/布局/灯光与面数无改动，不重烘；plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

### 版本Tag预览入口验收 · 2026-10-31

本地预览按钮已移除；版本Tag双击进入/退出，单击不切换。内置浏览器~/.dsh-test实际验证：页头0按钮、单击仍为真实会话、双击显示4个模拟角色与4行、再次双击退出；最终1canvas/0alert，刷新后无warn/error。Client构建/类型/lint/格式通过，25项相关回归通过。模型与灯光未变。回执sync/receipts/office-session-board-2026-10-31-preview-tag-v1.json，证据sync/evidence/2026-10-31-office-preview-tag/。plugin-only，无commit/push/publish。

## 蓝白条纹脚垫 · 2026-10-31（技术验收通过）

独立采用kitchen/floor-mat/2026-10-29-r1，原GLB 1427356bytes/hashc4c982fcbe133b70cb3e534bc5a2a66186f0ea3f1b06695289af9b37f035059f，1900tri/1mesh/1primitive/1material/两张1024嵌图。6000tri/4MiB独立上限，冰箱30k/8MiB预算不变。原织物roughness约.70、metallic0、normal.50、coat0与原几何/贴图保持；不替换鲸鱼地毯。最终Three位置[1.4,.0255,-.37]、yaw0、scale1，垫最高面Y.0435m，底面距地板约.5mm；既有家具、站位/路线、相机、暖光及全部既有模型文件不动。

薄垫为可走地面，不添加导航阻挡。kitchenActorGroundY按垫的半宽.675/半深.385加保守鞋底触及范围.35m提供最高面+1mm支撑；现有roaming根高.054m不降低，旧低脚底路径接近垫沿时整体抬高，程序白模另保留12mm起伏余量。这是防穿插支撑，不是逐足IK或精确踩踏形变，垫边有小幅保守提前抬高。真实骨骼角色冰箱往返/停留/转身/中断与四人通道网格回归均通过；当前共享会话UI不恢复历史的单间/找食材按钮，浏览器验证双人/四人游走，旧冰箱动作通过Node实际模型检查。

Blender全场BVH只有双墙41对历史拼角接触，无新增家具穿插。33实例/49primitive按现有r42几何基线和practical-v2灯位重新Cycles64sample CPU烘焙r47、OIDN为2026-10-31-floor-mat-shell-r48；仅三墙地面receiver、2K RGBM8、UV20832bytes与16MiB atlas预算保持。运行时家具仍PBR，新垫增加1900tri/一绘制批/两图及1.36MiB源数据，不宣称无性能成本。

实际build/TypeScript/lint/格式通过；全套330项首跑329通过，唯一失败为旧生产GLB数量28的断言；新增独立脚垫后门禁改为29并断言脚垫仅注册一次，该项单独重跑1pass/0fail。修改仅测试期待，不改产品或放宽JS/贴图预算，未重复四分钟全套。补充接触/runtime14项通过，初轮组件/角色几何92项通过。完整日志保留，不能将首跑描述为330项一次全绿。

真实~/.dsh-test内置浏览器查看新垫/暖光、双击Tag预览四人/双人、离开Office时canvas0、返回重建canvas1、0alert，最终刷新后无warn/error。最终留真实活跃会话页面，空闲0人仍显示完整厨房。回执sync/receipts/kitchen-floor-mat-2026-10-29-r1.json，证据sync/evidence/2026-10-31-floor-mat/。组件原delivery不改，ready指交付阶段，current采用以catalog和本回执为准；最终美术审阅待用户。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。
