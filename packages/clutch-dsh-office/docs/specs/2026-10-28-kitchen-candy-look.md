# Kitchen 饱满玩具质感 · Spec v1

当前状态（2026-10-29）：阶段1光照、阶段2B全场表面及阶段3A烟机法线样板均已通过技术验收并部署 ~/.dsh-test。当前烟机normal-r1、光照r38（四处局部暖光/保留拿取布局）；264tests通过。阶段3尚未整体完成，壁钟法线样板等后续待做，最终美术认可待用户。对应Spec/Plan以本文最新采用回执为准；下文早期基线和未采用记录是历史。

## 目标与观察样本

主参考唯一源：`kitchen/references/kitchen-reference.png`（插件镜像`assets/references/kitchen/kitchen-reference.png`），sha256 `a9fd9e7a5a539b31efa70471d774fd70091ce9ea97ed8e6eabaacabf0d5411cb`。目标为柔和蓝、奶油与蜂蜜木的小手办厨房：背光面保有颜色；亮部宽柔而有方向；转角明暗连续；接触处有阴影、物件仍立得住。参考图是美术目标，不宣称有一套精确物理参数可直接恢复它。

固定样本：冰箱门/侧壳及顶部鲸鱼、两把凳子的蓝色坐垫/木腿；同时观察白盘/浅色台面、深色烟机和墙角作为反例，防止冲白、泛黄、灰雾和丢失接触阴影。每轮记录相同相机、布局、视口、空房状态的前后截图，并检查双角色与冰箱行走。

## 三阶段边界

| 阶段                   | 本阶段允许                                                                                  | 必须保持                                                               | 完成信号                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1 · 间接受光与环境反射 | 运行时低分辨率环境捕获、柔和反弹光配比；替换旧漫反弹近似，避免重复叠加                      | 原GLB/UV0/材质参数/布局/相机/曝光/四盏直射面光及阴影预算；2K墙地面bake | 冰箱/鲸鱼/凳子背光面更有颜色，反射有宽柔层次；墙角柔影保留；无新UV黑线/运行时告警 |
| 2 · 分材质表面响应     | 按搪瓷/鲸鱼玩具、木、布、叶、金属分别调整roughness/normal/少量clearcoat；组件新revision交付 | 阶段1采用照明、布局/相机、角色身份；源贴花和分区                       | 样本高光更饱满；木与布仍哑光，金属可辨，不把全场统一塑料化                        |
| 3 · 必要的倒角与法线   | 针对经阶段1/2仍扁硬的具体组件修倒角、平滑法线与局部轮廓，必要时重烘法线                     | 组件尺寸/锚点/通道/身份/面数预算；其他已通过资产                       | 原视角轮廓更圆润，无阴影断层/穿插；geometry变化后完整重烘场景光照                 |

阶段2已推广并完成技术验收；阶段3A由用户本轮继续授权开始，先做单件诊断与样板。后续实施前先读前一阶段结果；不因阶段1尚未变成最终糖果感而偷偷改粗糙度、替换角色、加面数或调曝光。每阶段只采用有证据改善的部分。

## 性能与集成硬边界

- 全程plugin-only，DSH源码只读；工作于现有`wt-office-0.1.0/release`，保留已有dirty修改，不擅自commit/push/publish。
- 保持二进制按需加载、Client <3MiB；不恢复大Base64包，不增加HDR下载。2K光照RGBA预算16MiB、UV20832bytes和runtime模型贴图最长边1024保持。
- 环境PMREM捕获仍128，房间创建时生成一次、离屏释放；不新增每帧环境捕获、后处理、实时GI或阴影贴图。空房按需重绘，角色最多30FPS。
- 原始18件GLB/manifest、布局/运动/CSS、相机、曝光和墙地面bake字节为阶段1冻结基线，采用前后做hash校验。运行时环境补偿是家具GI近似，baked diffuse覆盖后不重复叠到墙地面上。
- 若更改源模型/材质/布局或烘焙直射照明，必须新revision重烘；runtime环境补偿不能宣称已同步改变冻结Cycles场景。

## 验收与变更规则

1. Spec先于实现落盘；Plan记录当前范围、基线、假设、实测、采用参数、遗留差异和下一步。
2. 每完成一个小部分立即写Plan结果。标记区分`进行中`、`技术验证通过/待视觉审阅`、`用户认可`；没有用户反馈不得写已认可。
3. 前后对照先看三个样本，再看全景和保护样本；不以整体曝光/饱和度提升代替受光改善。截图评价属于视觉证据，自动测试不冒充美术认可。
4. 修改范围匹配的typecheck/build/test/lint、资源释放/失败清理及预算检查必须通过；真实`~/.dsh-test`验收，保留服务供查看。
5. 每阶段结束同步插件文档、素材库Spec/Plan镜像、lighting/HANDOFF与验收回执。目标变化先记原因、影响及新边界，再实施。

## 当前记录

- 基线：`2026-10-28-cycles-shell-r8`，Client2011763bytes、226tests、128环境为constant linear.05，另有弱Hemisphere补偿，四直射面光，墙地面bake。
- 阶段1：采用方向性、低对比的被动室内反射环境，替代旧constant世界+Hemisphere组合。保持直射灯与材质不变；先验证方向性环境是否改善暗面与宽柔反射。实际采用值及结果以Plan追加记录为准。

- 阶段1结果：`kitchen-candy-indirect-s1-v1`已部署真实测试profile并完成场景回归，228tests/typecheck/lint通过；44个冻结文件与直射灯/曝光保持。暗面颜色改善，完整玩具高光及圆润轮廓仍归阶段2/3。采用参数、截图诊断及局限已写回Plan；尚无用户视觉认可。

## 阶段2A授权与样板边界 · 2026-10-28

用户认为第一步区别不明显，同意进入第二步。第一步记录为技术通过、视觉改善有限，不记录最终认可。先做冰箱搪瓷壳与顶部鲸鱼：roughness约.27/.30，定向削弱细碎normal，涂层<=.15且仅限涂装蒙版。允许在原非AO纹理的闲置R通道打包涂层蒙版；保持3图片/1材质/5primitive与几何UV/层级，baseColor字节保留。此样板覆盖旧统一规范冰箱/鲸鱼roughness.40–.50下限及局部法线强度约束，其他材料保留。灯光、环境、相机、曝光、布局与角色冻结。源材质变化必须新GLB revision及新墙地面bake，不能仅改hash套旧图。

- 阶段2A结果：采用refrigerator/2026-10-28-candy-r2及真实重烘candy-shell-r12；1材质/3图片/29499triangles保持。原baseColor、全部几何/UV/COLOR/节点/primitive材质分配字节保持，金属G/B和法线像素保持，coat在金属区域为0。230tests、typecheck、lint和真实profile验收通过。第一步用户评价差异有限；本样板最终美术认可仍待用户。阶段2其他组件和阶段3未执行。

## 用户插入任务覆盖 · 新灶台L形接入

2026-10-28用户授权新源灶台及L形对齐，随后明确长度不得压缩、置物架靠底板左前边缘。此任务允许新灶台几何/尺寸/静态契约、烟机/挂杆/置物架/地毯位置与cook站位调整及依赖重烘；冰箱样板与其他源资产保持，材质推广暂停，阶段3未开始。实际采用r6加长3.247m，r16光照，技术检查通过，用户视觉认可待定。详见Plan新灶台章节，不再按旧“所有布局冻结”误解本轮授权。

## 当前授权覆盖 · 新烟机/吊柜/窗户与全场材质 · 2026-10-28

用户提供两个新原件，授权更新range-hood和wall-cabinet及source原件，烟机仅按火灶区域宽度对齐（排除旁柜）；加入水槽上方window，并按主参考移动吊灯与挂画。保留r6加长灶台、L形接缝、桌椅和行走通道。窗户为实墙前不透明静态装饰，无开窗/玻璃/窗外能力，不改墙洞。

用户同时授权阶段2材质推广到所有已接入组件，覆盖此前“其他资产暂停”。按组件语义分别调整roughness/normal/适量局部coat；原底色/贴花、geometry/UV/COLOR/层级/枢轴和角色身份保护，新revision交付，木布/陶盆/叶片/金属保持区别；已通过冰箱样板与无纹理哑光墙评估后保留，不为改而改。阶段3几何修形不在本次范围。相机、曝光、s1环境和四直射灯冻结。最后按19实例的新模型/材质/布局重新烘焙墙地面并OIDN，不能复用旧hash光图。

- [x] 新原件识别、源库归档和独立交付
- [x] 独立window规则/加载/布局及全场穿插/路径验证
- [x] 全场分材质派生与保护检查、固定灯机位对照
- [x] 依赖重烘、build/typecheck/lint/test、真实~/.dsh-test回归
- [x] 双向交接、回执与实际截图；技术通过和用户视觉批准分别记录

## 新组件与全场材质阶段2B · 技术验收通过 / 待用户视觉审阅

2026-10-28：完成两个新原件识别（877fc508为壁柜、d6351445为烟机）、source原件归档及r3独立静态交付。烟机仅按实测火灶平板1.374324739m宽对齐，排除两侧柜；source宽.910972118，场景localX scale1.508635348，中心WorldZ.636263588。保留加长灶台3.247m、L形薄收口、桌椅及角色站位。

窗户采用独立window/candy-r2，原尺寸1.049972×.743585×.260559m、scale1、位置[-.68,1.39,-1.808]。首轮穿插已修复，层架上移14cm至rootY.39以给窗留空间；吊柜[-2.113,1.86,-.7]，挂画[.9,2.79,-1.813]，吊灯[1.95,.6,-1.48]。真实Blender全场BVH只有双墙拼角41对接触，其余家具表面无相交；完整角色往返/中断/转身/减少动态路径测试通过。窗片不透明，无墙洞/透光/室外/开窗动画，也未新增窗光。

全场阶段2分材质推广：14个材质后代（含保留冰箱样板和字节不变地毯审查revision）独立核验所有accessor含COLOR、geometry/UV/节点/材质分配、原baseColor字节保持。新烟机/吊柜是用户授权的几何替换。木、布、金属、叶、食物、皮肤眼睛和图案保护；地板、双墙与已采用冻结GLB逐字节一致。最终26材质/34primitive/47图片，未增加任一既有组件的材质/图片/批次。原色图烘焙明暗、局部三角棱角仍在，第三步几何修形未做。

19实例/34primitive按冻结三AREA、World.05、相机/曝光真实Cycles64sample Metal烘焙r17、OIDN为r18，运行时s1环境/第四前面光保持。仅三墙地接收者2K RGBM8，atlas2709174bytes、UV20832bytes、RGBA16MiB；源GLB42809224bytes(40.83MiB)，Client2004019bytes。二进制白名单按需加载、1024模型贴图、PMREM128、空房按需/角色30FPS、离屏释放保持。新增Physical响应有shader成本，未测FPS/加载耗时，不宣称性能零成本。

实际命令：pnpm --filter @cerbur/clutch-dsh-office build/typecheck/lint；node --test --test-concurrency=1 test/*.test.mjs（235passed/0failed）；pnpm run check:workspace、check:patches（通过，保留既有!!js YAML警告）、git diff --check。材质独立审计与两位只读集成复核无阻断问题。真实~/.dsh-test已安装、重启3088：5空房、单间、双角色气泡、走到冰箱及返回、末间与首间离屏重建通过；最终1canvas/0alert，冷刷新后12:03UTC起warn/error为0。服务重启前旧HMR多Three与连接中断日志为历史，未算成冷加载结果。OS减少动态未手动切换，自动路径/生命周期测试通过。

回执 `sync/receipts/kitchen-candy-s2b-2026-10-28.json`；证据 `sync/evidence/2026-10-28-kitchen-candy-s2b/`；全场验证工程 `kitchen/lighting/lookdev/2026-10-28-kitchen-candy-layout/厨房_最终材质场景验证.blend`。Spec/Plan、美术语言/JSON、光照规范、catalog和各组件HANDOFF已双向同步。阶段2B技术通过与用户视觉认可分开，最终美术批准待用户；阶段3未开始。全程plugin-only，主checkout和DSH源码干净；工作在既有dirty release，不commit/push/publish，不改生产profile。http://127.0.0.1:3088/保留供查看。

## W-01至W-05厨房挂件 · 2026-10-28（已完成技术验收）

用户新交付鲸鱼隔热垫、木质壁钟、木砧板与抹布、壁挂绿植、鲸鱼挂历。按office/kitchen/组件目录管理原件、Blender工程、脚本、纹理、预览与不可变delivery。独立ID：whale-mitt、wall-clock、board-cloth、wall-plant、wall-calendar。原件字节不改；仅新件可作尺寸、保UV减面及既有stage2b分材质表面优化。

摆放遵从主参考和功能逻辑：灶眼/烟机投影及热区不新增挂件，不挡水槽龙头、窗、层架和柜门；保留既有家具布局、行走通道、相机、四盏直射灯、曝光与s1环境。木钟/挂历为静态装饰，文字不绑定真实日期/时间。绿植少量复用同一资源，不重复下载/解析；放在不同墙面并旋转朝向，背板贴墙、盆体重力方向保持，不随机旋转穿墙。最终变换经真实三角面与画面审查后确定。

- [x] 新资产归档、原件hash、独立Blender工程与GLB预览/预算检查
- [x] 独立导入规则与五件加载，绿植共享资源/旋转实例
- [x] 功能区留白、挂件/家具穿插、角色路线与视觉验证
- [x] 新来源与布局真实重烘、测试、~/.dsh-test实机验收
- [x] 双向文档/catalog/逐件回执和实际截图

本次扩展是新挂件接入，不代表阶段3形体精修开始，不把旧材质/光照阶段历史冻结误作禁止本轮授权。全程plugin-only，不改DSH源码/生产profile、不commit/push/publish。

## W01–W05挂件接入 · 技术验收通过 / 待视觉审阅

2026-10-28新增五件独立r1：whale-mitt（鲸鱼隔热垫）、wall-clock（木质壁钟）、board-cloth（砧板与抹布）、wall-plant（壁挂盆）、wall-calendar（鲸鱼挂历）。原始GLB逐字节存各组件source，可编辑工程/脚本/纹理/渲染在各自work/2026-10-28-r1，不放插件。交付全为1mesh/1material/3张1024内嵌图，独立命名与预算；不借用冰箱合同，冰箱30k/8MiB和门轴约束保持。挂历与木钟为静态装饰，不显示真实日期/时间。

最终摆放（Three米/Y-up）：隔热垫[-2.307,2.14,2.83]、壁钟[-2.307,2.94,2.62]和左挂盆[-2.302,2.18,2.49]均yaw90°上左前墙；挂历[.43,1.94,-1.807]在水槽右；砧板抹布[2.26,2.13,-1.807]及右挂盆[2.26,1.65,-1.802]在冰箱右侧空墙，yaw0。砧板原放备餐墙被既有物件投影遮住，已明确改到右空墙完整可见，不采用历史试摆坐标。所有新件避开完整灶台/烟机热区，不把随意转盆背穿墙当变化；两盆随两面墙方向差90°、保持竖直，用同一GLB一次parse共享geometry/material/textures并释放一次。

真实Blender全场最终BVH只有两墙拼角41对既有共同表面，其余非地板家具无相交；原桌椅/角色站位/通道/既有19源GLB及manifest38文件逐字节保持，相机/四面光/曝光/s1环境保持。完整活动对/转身/冰箱往返/中断/减少动态路径测试包括全部新挂件和两盆实际变换。新件为本轮尺寸/保UV减面/分材质表面处理，原图案保留；木布叶陶盆按stage2b分别处理，不统一塑料化。原重建棱角、色图烘焙光影/钟盘三角明暗仍在，阶段3未开始。

25实例/40primitive真实Cycles64sample Metal新烘焙r19，OIDN为r20；2K RGBM8、UV20832bytes、RGBA16MiB保持，PNG2680850bytes。24件源GLB共51580792bytes(49.19MiB)，Client2013877bytes，新增挂件源8771568bytes，复用盆只新增一个source和两个绘制实例。1024运行时图、PMREM128、空闲按需/角色最多30FPS、离屏释放保持；未测FPS、加载时延或实测VRAM，不宣称性能零成本。

重复实例由kitchenAssetName和KITCHEN_INSTANCE_GROUPS统一导出/导入/运行时映射。生产bundle入口先解析inline base64/JSON，再验证完整25来源ID/实例集合和assetId；缺右盆、重复/额外ID、错误别名不能让shell提前提交，失败走原fallback。原有部分内存fixture是单元验证，生产守卫不提供可关闭字段。

实际检查：build、typecheck、lint、Prettier、check:workspace、check:patches、git diff --check通过；node --test --test-concurrency=1 test/*.test.mjs共256pass/0fail，含五件独立导入、热区留白、绿植parse一次/释放一次、base64真实入口和失败清理。已有!!js YAML warning保留。真实~/.dsh-test http://127.0.0.1:3088/已安装并重启：5空闲厨房、单间五件全可见、双角色及气泡、冰箱到达与回程、末间与首间重建通过；最终1canvas/0alert，13:26UTC后warn/error0；重启过程旧连接警告单列历史。OS减少动态未手动切换，自动路径/生命周期通过。

回执sync/receipts/kitchen-wall-hangings-2026-10-28-r1.json，证据sync/evidence/2026-10-28-wall-hangings；最终场景工程kitchen/lighting/lookdev/2026-10-28-wall-hangings-layout/厨房_场景验证.blend。catalog、组件HANDOFF、双语README、Spec/Plan和光照规范已更新，技术接受与用户视觉认可分别记录。全程plugin-only，不改DSH源码/生产profile，不commit/push/publish；服务保留供查看。

## 当前进度与阶段3A · 2026-10-28

用户要求继续原三阶段计划并确认进度。阶段1间接受光/环境反射、阶段2分材质表面及新挂件已技术验收；当前24源资产/25实例、r20光照、256tests。此前“仅冰箱样板/其余材质暂停/挂件进行中”是历史，现统一以本段及最近采用回执为准。用户尚未明确确认最终视觉完全达到主参考。

现在进入阶段3A单件试点：先诊断烟机的三角明暗，区分几何法线、normal贴图与原色图烘焙问题。允许仅本试点修平滑法线/必要局部倒角；先出固定灯/相机对照、保留贴花与原色图、不盲目提高面数、不改布局/灯光/曝光。尺寸、锚点、原点和通道保持，采用任何源修订后必须新revision和真实依赖重烘。吊柜/钟盘等列后续候选，暂不一起改。无视觉改善的候选不采纳，不把“进行中”写成完成。

- [x] 烟机逐层诊断与固定对照
- [x] 有证据的法线样板及位置/UV/面数保护审计（正式导出审计待做）
- [x] 本轮未采用；已记录样板证据与后续交付/重烘要求
- [x] 回写本Spec/Plan，明确阶段3仍待处理的组件

### 阶段3A本轮结果

烟机四组固定灯/机位对照已完成。关闭normal贴图不能消除烟囱三角明暗；清理自定义法线并重算加权法线明显改善，选作独立样板。evaluated mesh审计证明位置/UV/矩阵/28499三角形保持，角点法线改变。正式资产、灯光、布局与本轮起点哈希一致；没有部署新样板。结果不是阶段3全部完成，也不是用户最终视觉批准。

- [x] 烟机逐层诊断与固定对照
- [x] 法线样板与位置/UV/面数保护审计（尚未导出正式交付）
- [x] 双向Spec/Plan写回，诊断见 KITCHEN-CANDY-S3A-DIAGNOSIS.md；库内见 kitchen/range-hood/lookdev/2026-10-28-s3a-diagnosis/诊断结论.md
- [x] 烟机新revision正式导出与完整保护审计
- [ ] 壁钟局部法线样板（后续）
- [x] 新源依赖重烘与 ~/.dsh-test 验收、采用回执

后续优先壁钟表盘法线（部分平面顶点方向偏差约43–56度）；吊柜暂无同等级明确缺陷，不做无依据修改。

## 阶段3A正式部署 · 2026-10-28（技术验收通过）

用户明确要求将烟机法线样板部署到 ~/.dsh-test。本轮只采用烟机加权法线修正版；壁钟后续处理。法线修订以新不可变delivery交付，原位置/UV/索引/节点/材质/图片保护，导出后独立重导检查。布局、灯光、相机、曝光和其他模型不改。真实全依赖重烘r21、OIDN r22，不冒用旧光图hash；完成构建、针对性回归、真实页面验收与双向采用回执后才写完成。

- [x] 正式法线revision及导出保护审计
- [x] 烟机导入、r21/r22重烘和光照依赖校验
- [x] 构建/检查/回归与 ~/.dsh-test 实际页面验收
- [x] catalog/HANDOFF/Spec/Plan与采用回执同步

## 阶段3A烟机样板已部署 · 2026-10-28

用户授权部署后，采用range-hood/2026-10-28-normal-r1，sha256 edf10b059844b8fd0d6f973ea442d3994c4757baf68f8ab3919c5e3c5e47eb7c，2700820bytes/28499三角形。只更新原NORMAL二进制区间，JSON和全部非NORMAL字节（位置、UV、索引、材质、3张1024图片、节点锚点）保持r3原字节。24033顶点精确映射，3个角点分裂冲突按相邻面面积折中，以保留索引；最大小区域误差3.92958°已明确记录。没有新增倒角、拓扑或材质批次。

实际最终GLB已独立Blender回导、CPU固定灯渲染，并经过独立只读字节/法线复核。烟囱三角明暗明显减轻，原图集光影、边缝和细节瑕疵仍在，不声称全部模型精修完成。其他23件源GLB和manifest、布局、路径、相机、灯光参数及runtime s1环境不改。

按完整25实例/40primitive新来源实际Cycles64sample Metal重烘r21，OIDN为2026-10-28-normal-shell-r22。2K RGBM8、PNG2880121bytes、UV20832bytes与16MiB预算保持；来源hash/Three几何签名校验通过，不套用旧光图。新增revision导入白名单保留r3与旧烟机、冰箱等独立约束。

实际build、typecheck、lint、workspace/patches、sync-asset Prettier及git diff --check通过；node --test --test-concurrency=1 test/*.test.mjs为256pass/0fail。已重启明确使用DSH_HOME=/Users/yuancheng/.dsh-test的3088测试服务，真实页面查看5空房、单间、双角色气泡、冰箱到达/回程、末间和首间重建，最终1canvas/0alert，冷加载后warn/error0。未手动切换OS减少动态，自动运动/生命周期测试通过；未做FPS/VRAM/加载时间基准。

回执sync/receipts/kitchen-range-hood-2026-10-28-normal-r1.json；实际截图和日志sync/evidence/2026-10-28-kitchen-candy-s3a/。catalog/HANDOFF/Spec/Plan已双向同步，accepted表示技术验收，最终视觉批准待用户。阶段3A烟机正式部署完成；壁钟局部法线和其余有证据的轮廓修正尚待后续，不把阶段3整体勾为完成。全程plugin-only，不改DSH源码或生产profile，不commit/push/publish。服务http://127.0.0.1:3088/保留供查看。

## 置物架遮角缝与窗户净空 · 2026-10-28（历史试摆，已被后续采用覆盖）

用户要求右墙带绿植置物架向墙角移动，让藤蔓遮挡双墙接缝；窗户上移避水龙头，必要时右移。本轮只改实例位置，不改任何源模型、材质、尺寸或灯机参数，不作为新的材质/几何优化阶段。实际BVH试摆发现单独抬窗/右移会撞置物架支撑或挂历；最终候选wall-shelf[-1.4,.39,-1.813]、window[-.12,1.51,-1.808]、wall-calendar[.58,1.94,-1.807]，挂历仅让位15cm，架高度保持，其他位置和站位不改。候选三件对全部厨房非地板物件表面无相交。完整预览、真实重烘r23/r24、测试与 ~/.dsh-test 验收后再写完成。

## 用户最新布局：左窗、右侧降低的置物架 · 2026-10-28（历史试摆，已被后续采用覆盖）

用户随后反馈“太里面”，再明确提出窗户放左、置物架放右且降低。此方案替代前述遮角缝/r24试摆；外退15cm候选未正式采用。最终候选window[-1.35,1.51,-1.808]、wall-shelf[.10,.15,-1.813]（比原架降低24cm）；挂历让位到窗上方[-1.35,2.34,-1.807]，避免被架挡住。只改这三件实例位置，模型/材质/光机/站位/其他布局保持。候选实际BVH无新穿插；完整预览、r25/r26重烘及真实profile验收后写最终回执。r23/r24保留为中间试摆，不代表用户认可。

## 左窗贴近左墙边缘 · 2026-10-28（历史试摆，已被后续采用覆盖）

用户最新要求窗户继续左移，贴近左墙内侧边缘。本次仅window X -1.35→-1.78（左移43cm），Y1.51/Z-1.808保持；窗左框约X-2.304994，左墙内表面约X-2.315，名义约1cm净缝防穿墙。右侧低架与窗上方挂历保持。此微调替代r26中的窗X；验证/重烘使用新r27/r28，不覆盖历史deliveries。

## 当前最新授权：窗顶对齐蓝柜、右架左移 · 2026-10-28（技术验收通过）

用户进一步要求窗户上沿与蓝色吊柜同高，双层架向左微调平衡。保留窗X-1.78贴近左墙，按实际GLB尺寸计算窗底Y=1.8800518369674686，两者顶Y=2.623636648654938，不缩放；右架X.10→-.10（左20cm）、Y.15保持低架；挂历Y2.34→2.72让位，X-1.35不改。只更新这三件位置；以新r29/r30重烘验收替代r28及更早试摆。模型/材质/光机/其他布局/角色路径保持。

## 当前采用：窗顶对齐蓝柜、右侧低架左移 · 2026-10-28

按用户最后两次补充：窗X=-1.78贴近左墙内侧，Y=1.8800518369674686、Z=-1.808；窗顶与蓝色吊柜顶实际同为2.6236367m，左侧窗框距墙表面约9.92mm。双层置物架[-.10,.15,-1.813]，在右侧降低24cm的基础上再左移20cm；挂历[-1.35,2.72,-1.807]上移让出窗框。只改这三件实例位置，所有模型GLB/manifest/材质/UV/尺寸、其他布局、角色站位路径、相机、四灯/曝光及s1环境保持。

全场实际BVH只有双墙拼角41对既有接触，无新增家具穿插；固定机位完整预览已查看。完整25实例/40primitive真实Cycles64sample Metal重烘r29，OIDN为2026-10-28-window-top-shell-r30；源hash/Three几何签名/布局严格校验，2K RGBM8、UV20832bytes与16MiB预算保持。r23至r28是用户连续调整期间的中间试摆，保留历史、不代表最终采用；外退15cm候选未采用。

最终build/lint、布局Prettier、git diff --check通过；最新资源/光照/几何导出针对回归96pass/0fail。左右互换基线全套256pass/0fail在前一轮已实际执行，本次微调未重复全套，避免把旧结果称为最新全量测试。真实 ~/.dsh-test http://127.0.0.1:3088/ 已重启并查看总览、单间及重建，最终1canvas/0alert，Office冷加载后warn/error0。

回执sync/receipts/kitchen-layout-2026-10-28-window-top-align-v1.json；证据sync/evidence/2026-10-28-window-top-align/；完整可编辑验证工程kitchen/lighting/lookdev/2026-10-28-window-top-align/厨房_场景验证.blend。catalog、组件HANDOFF、双语README、Spec/Plan和光照文档双向同步。accepted为技术验收，最终用户视觉认可待审。阶段3其余任务仍待做。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 双层置物架追加左移20cm · 2026-10-28（技术验收通过）

用户要求双层置物架再左移20cm，仅wall-shelf X-.10→-.30，Y.15/Z-1.813保持；窗户与蓝柜顶面对齐、左墙细缝、挂历及其他布局不动。源GLB/材质/灯机不改；新r31/r32真实依赖重烘与实际 ~/.dsh-test验收后写回执。

## 当前采用：双层置物架再左移20cm · 2026-10-28

用户追加要求只移动wall-shelf：[-.10,.15,-1.813]→[-.30,.15,-1.813]，精确再左移20cm。高度、深度、旋转与scale不变；窗户与蓝柜顶对齐、贴左墙的细缝、挂历和其他实例位置及全部GLB/manifest/材质/光机/角色路径保持。实际全场BVH只保留双墙拼角41对既有接触，无新增家具穿插。

完整25实例/40primitive按真实新位置重烘Cycles64sample Metal r31，OIDN为2026-10-28-shelf-left-shell-r32；全部source hash/布局/Three几何签名导入通过，2K RGBM8/UV20832bytes/16MiB预算保持。build/lint/布局Prettier/git diff --check、最新资源与光照定向回归96pass/0fail；本次位置微调未重复此前全量256项，二者不混称。真实 ~/.dsh-test http://127.0.0.1:3088/ 已重启并查看，最终1canvas/0alert、冷加载warn/error0。

回执sync/receipts/kitchen-layout-2026-10-28-shelf-left20-v1.json；证据sync/evidence/2026-10-28-shelf-left20/；完整验证工程kitchen/lighting/lookdev/2026-10-28-shelf-left20/厨房_场景验证.blend。catalog、双语README截图、Spec/Plan与HANDOFF已对齐，accepted为技术验收，用户视觉认可待审。此前新基线提交由用户/外部流程创建，本轮不提交/推送/发布；仅在现有release保留小范围变更。plugin-only，无DSH源码或生产profile修改。

## 拿取高度与窗下三盆 · 2026-10-29（技术验收通过）

用户要求摆放考虑实际拿取：隔热垫降低并放橙杆右侧，砧板抹布放大并放蓝柜下备餐台上方，挂历移至冰箱右墙盆栽下，窗下增加三个一排盆栽。仅修改对应场景实例与显式缩放；既有GLB/manifest/材质和窗顶、架、桌椅/路径/灯机保持。新三盆复用wall-plant资源（缩至85%，不把源缩小），五盆同一GLB一次parse，共享资源且只释放一次；生产光图完整28实例集合及身份校验保持。

备餐台上方可放可拿取物件，此次授权覆盖早期“整条灶台上方均留白”粗约束；实际火灶/烟机热柱仍必须留空。挂点优先约1.7–1.8m，物件主体约1.1–1.7m，不声称精确人体工学认证。按实际网格与机位试摆，未经验证的初始位置不算最终采用。正式导出布局、r33/r34真实依赖重烘和 ~/.dsh-test验收后写回执。

## 当前采用：拿取高度与窗下三盆 · 2026-10-29

隔热垫[-2.307,1.43,1.75]移至左墙橙色挂杆右边，挂点约1.811m；砧板抹布[-2.307,1.12,-.70]、yaw90°、scale1.2，置蓝柜下备餐台上方，顶1.72m、底1.12m。备餐区允许可拿取挂件，实际火灶/烟机热柱仍留空，覆盖早期整条柜台禁止装饰的粗约束。挂历[2.26,1.08,-1.807]移至冰箱右侧墙、原盆栽下方，顶1.56m、垂直间隙90mm。

窗下三个wall-plant实例X[-2.12,-1.78,-1.44]、Y1.4/Z-1.802，scale.85，间距34cm，顶约1.7575m、距窗底约12.25cm。保留原左右两盆，五盆同一GLB一次parse，共享geometry/material/textures且只释放一次，显式重置每实例旋转/缩放。只增加实例，没有复制源资源或修改现有模型/材质。窗顶对齐蓝柜、右架X-.30、桌椅/活动站位/相机/四灯/曝光及s1环境保持。

实际Blender全场BVH只有双墙拼角41对既有接触，无新增家具穿插；固定机位预览及可编辑工程在kitchen/lighting/lookdev/2026-10-29-kitchen-reach/。完整28实例/43primitive真实Cycles64sample Metal重烘r33，OIDN为2026-10-29-reach-shell-r34；2K RGBM8、atlas2695451bytes/hash88d7ab438cfa6cc1713eadf9d8c3d089f7ac777dd65eca257f0ea8a6eea77846，UV20832bytes、16MiB预算保持。新三盆增加3绘制实例/35697三角形，未做FPS/VRAM/加载时延基准。

最终build/typecheck/lint、源代码与测试Prettier通过，全套node --test --test-concurrency=1 test/*.test.mjs为256pass/0fail，包括五盆身份完整性、parse/释放一次和实际角色路径。真实 ~/.dsh-test 页面结果见回执browser字段与截图：总览、单间、本地双角色与冰箱行走，最终单canvas/无alert/Office光照无fallback。初次浏览器曾有光图fetch超时，图片直接打开后重载成功；根因未确认，不宣称代码修复，不改传输/超时/源代码边界。最终重启后检查独立记录；其他插件连接重试日志不冒充Office错误，也不宣称全页面历史零告警。

回执sync/receipts/kitchen-layout-2026-10-29-reach-v1.json，证据sync/evidence/2026-10-29-kitchen-reach/。当前调整为静态视觉拿取高度，不包含骨骼拿取或人体工学认证；阶段3壁钟法线等仍待后续，最终美术批准待用户。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。测试服务http://127.0.0.1:3088/保留供查看。

## 局部暖光 · 2026-10-29（技术验收通过）

按用户指定主参考增加四处局部暖光：烟机下方灶面光、双层架底灯、窗户暖光、鲸鱼吊灯。保留家具布局、所有源GLB/材质、主三softbox、正面补光、相机及曝光；新增三矩形和一球形光源，不新增实时shadow map，不使用全局橙色滤镜。参数唯一源src/office/kitchen-practicals.ts，导出相同米制位置/方向/线性色/功率给Cycles，完成实际重烘后再采用。墙地面只接受新烘焙漫反射，实时灯只照亮家具/角色及镜面，避免双算。窗户目前是不透明静态总成，暖光不等于开洞或真实室外透光。完成画面验收后更新本节和回执。

## 当前采用：四处局部暖光 · 2026-10-29

按厨房主参考新增烟机下方、双层架下方、窗户、鲸鱼吊灯四处暖光。参数唯一源src/office/kitchen-practicals.ts（kitchen-warm-practicals-v2），编译后导出同一JSON供Blender，不手工维护两份灯位。烟机26W/1.12×.26m、层架22W/1.22×.12m、窗户16W/.78×.46m，线性色分别[1,.53,.22]/[1,.55,.24]/[1,.64,.32]；鲸鱼灯16W等效point、linear[1,.57,.25]、运行时范围1.6m，按light_anchor下移7cm置于不透明灯罩下方。

窗格用根局部坐标发光蒙版，不新建悬浮面片、不把木框/整物件涂黄。实际四窗格射线测得前表面深.097m，凸木框>.15m；采用depth≤.115m、|X|≤.455m、Y .10–.68m，linear[1,.64,.27]×.9发光。Four-pane真实GLB回归验证四块窗格均发光、木框不发光，原PBR/UV/贴图/材质批次保持。r35/r36初试蒙版只点亮部分窗格，为历史候选，不作为采用版本。

保留全部源GLB及manifest、28实例布局/几何签名、主三softbox、弱正面面光、相机、Neutral曝光1、s1反射与既有角色路线。Three新增3RectArea+1Point，合计7Rect/4shadow-only Spot/1Point；原前三面光与四阴影proxy排序保持，shadow shader只给前三光采样对应贴图，新增三光不借用角色shadow。点光由场景rig单一拥有，组件不重复创建。无新增shadow map，无额外模型贴图或绘制实例；多四盏灯增加BRDF成本，未做FPS/VRAM/加载基准。

按完整场景真实Cycles64samples Metal重烘r37，OIDN降噪采用2026-10-29-practical-shell-r38。仅墙地面漫反射接收2K RGBM8新图，UV20832bytes/atlas16MiB预算保持，PNG2852348bytes/hash5d596e85b1fdbc810ff122123b2434b58a43756243d6185b46bec65347d735ae。家具及角色接受实时暖光、镜面/发光保留，烘焙墙地面漫反射不再重复加实时光。Blender的面积/点光和Three等效标定在阴影、点光半径/距离截断上有引擎差异，不声称逐像素相同。窗户仍为不透明装饰总成，无墙洞、室外、透射或bloom。

实际build/typecheck/lint与源代码/测试Prettier通过，全套node --test --test-concurrency=1 test/*.test.mjs为264pass/0fail。真实 ~/.dsh-test 总览/单间/本地角色与找食材/离屏重建结果见回执browser字段和截图，最终1canvas/0alert、冷刷新后warn/error0。测试服务启动保留当时已有额外测试patch，未改其文件或其他插件。阶段3其余壁钟法线/几何工作仍待后续，本轮为灯光增强；最终美术认可待用户。

回执sync/receipts/kitchen-lighting-2026-10-29-practicals-v1.json；证据sync/evidence/2026-10-29-kitchen-practicals/；可编辑主工程kitchen/lighting/lookdev/2026-10-29-practical-shell-r37/厨房_Cycles光照烘焙.blend，脚本归kitchen/lighting/scripts。Spec/Plan、双语README、光照规范、catalog与四组件HANDOFF双向对齐。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。http://127.0.0.1:3088/保留运行。

## 左墙生活收纳四件 · 2026-10-29（技术验收通过，详见末节）

用户提供新小调味架、开放木格柜、黑挂钩杆和迷你墙面收纳盒；分别归kitchen/spice-rack、open-cubby、black-utensil-rail、wall-storage-box，独立GLB/清单/预算，不借用冰箱约束。源文件原字节、可编辑Blender工程、贴图与审阅图留素材库。按主参考与真实物件包围/表面验收位置，灶眼/烟机热区留白，拿取高度优先约1.4–1.9m；高格柜仅低频餐具，不能阻碍柜门/窗框/已有挂件。保持最新局部暖光、桌椅/角色路线；必要局部收纳重排记录新布局，最终全部实例参与重烘后再采用。当前计划不是已经完成的验收。

## 当前采用：左墙生活收纳四件 · 2026-10-29

四件独立交付均为2026-10-29-r1：小调味架spice-rack（.74×.703457×.269506m/20313tri）、开放木格柜open-cubby（.22×.737380×.157793m/5834tri）、黑挂钩杆black-utensil-rail（.82×.625123×.138354m/10622tri）、迷你收纳盒wall-storage-box（.38×.301498×.180226m/11649tri）。各单mesh/primitive/material、三张1024内嵌图、normal .35；独立25k/10k/15k/15k面和各4MiB上限，冰箱30k/8MiB约束保持。原始用户文件逐字节保存在各source，中文可编辑工程/脚本/纹理/审核图在work/2026-10-29-r1；冻结delivery不回写accepted状态，以本回执和catalog为准。四件原拓扑/UV保留，原图明暗及重建瑕疵仍在。

摆放唯一源src/office/kitchen-layout.ts：调味架[-2.307,2.06,2.45]、黑挂杆[-2.307,1.35,2.45]在左推车上方，挂杆顶1.975m、距调味架底约85mm；窄格柜[-2.307,1.86,-.18]紧邻蓝柜，顶2.597m为低频上层收纳。三者yaw90°/scale1。收纳盒原试摆在水槽右后方被冰箱遮挡，最终[2.26,1.65,-1.807]、yaw0/scale1，顶1.9515m；右挂盆升至Y2.15，挂历维持Y1.08，三者同列、两处净距约198.5/90mm。不采用隐藏的候选位置。

为留出新收纳空间，蓝柜后移14cm至Z-.84、砧板抹布至Z-.95且保留120%尺寸；旧橙杆移备餐区[-2.307,1.63,-.36]、等比45%，避免两套全尺寸挂杆重复；左挂盆移Z1.67。其余家具/窗户/桌椅/角色站位路线、相机/曝光/softboxes/practical-v2参数及全部既有GLB/manifest字节保持。灶眼和烟机实际热柱留空：左盆位于备餐侧的非火灶区域，覆盖旧“整条台面上空一律禁挂”的粗规则，保留两个fire anchor热柱反例检查。

全场真实Blender BVH仅双墙拼角41对既有接触，无新增非地面相交。最终32实例/47primitive全部参加Cycles64samples Metal光照计算；仅墙地面接收新2K RGBM8/OIDN，采用2026-10-29-left-decor-shell-r40（raw r39），UV20832bytes、atlas16MiB预算保持，PNG2766589bytes/hash1fbf55f5adb0cdeb14ef29dae92424dd1ca3731d4641f66d59d595eaee62d5b2。家具仍实时PBR，保留四处暖光，不增加shadow map。四新件增加48418tri/8556396bytes/四次静态绘制，未做FPS或加载基准，不宣称零成本。

实际build/typecheck/lint/Prettier/workspace/patches通过，完整含真实素材库校验290tests/0fail；角色双人绕桌、冰箱往返及中断碰撞检查覆盖32实例。真实~/.dsh-test总览/单间/本地预览/离屏重建与最终资源加载结果见browser字段；最终美术认可待用户，静态挂件不具备拿取/开门动画。回执sync/receipts/kitchen-left-decor-2026-10-29-r1.json，证据sync/evidence/2026-10-29-kitchen-left-decor/，主工程kitchen/lighting/lookdev/2026-10-29-left-decor-shell-r39/厨房_Cycles光照烘焙.blend。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 灶台几何精修 · 2026-10-29（技术验收通过，详见末节）

用户新增四张灶台正面/侧面/顶部参考，明确要求修复右侧畸形柜体与粗糙灶具，并落入Blender资产。允许本组件重建几何，覆盖仅材质阶段的冻结；保留3.247m加长台面、约1m进深、当前L接缝薄cap/锚点、火灶中心、桌椅与角色路线。重做规整左右门板抽屉、蓝色边框、奶油台面、双炉头铸铁支架及烤箱；不伪造旧门轴或开门动画。新工程work/2026-10-29-refined-r1，新delivery同revision，不覆盖历史。先Blender单件与全场BVH/渲染，再重烘依赖、插件导入、真实~/.dsh-test及回执。当前尚非验收完成。

## 当前采用：灶台规整柜体与双炉头精修 · 2026-10-29

用户四张新参考已长期保存kitchen/stove/work/2026-10-29-refined-r1/references，并记录原图hash。主厨房原参考继续保留。用户明确授权本组件重建几何，覆盖材质阶段对此件的形体冻结；当前delivery为2026-10-29-refined-r1，hash0f7756d88da214ff51f5a4e4601bfe1dcb928c97c59b34e8610b70580347e1a2，777032bytes，31532tri/3mesh/3primitive/3material/3张1024内嵌图，40ktri/4MiB上限未放宽，旧r6/candy快照保持不可变。独立refined契约不影响旧版门轴或其他组件。

重做蓝色柜体/脚块/封板、左右各.777m等宽奶油门板与抽屉、镜像中心±1.164m、统一分缝和暖金把手；右柜不再用被横向拉伸的重建表面。双炉头为规整黑搪瓷灶面、铸铁方形框/凸支架、金色炉圈、黑顶盖和暖金旋钮；烤箱重做金属面板/拉手、内搁架及单独烟色玻璃。真实圆角/加权法线，非单纯提高贴图锐度。基础色是无摄影棚明暗的分区色板，roughness/metallic按漆、搪瓷、铸铁、裸金属、标签和瓶身独立响应；不宣称已经烘焙高模法线。源图微细石纹/透明油瓶精度仍有差异，本版瓶罐为简化静态几何。

保留加长台面3.247109664m×.999625942m、work_surface高度.891553998m、现有stove根位置/yaw、全部历史安装锚点、实际接缝cap顶点世界坐标、烟机火灶中线、桌椅/水槽/挂件/角色站位与路线、相机/曝光/practical-v2灯位。burner锚点是安装工作平面，不是炉架顶或角色手部接触点。新的柜门只是闭合静态造型，没有runtime门轴、开门/拿取、炒锅或火焰能力；不能套旧r1动作。

中文可编辑工程kitchen/stove/work/2026-10-29-refined-r1/灶台_规整柜体双炉头.blend；隐藏“可编辑零件_不导出”collection保留单件参数，runtime仅opaque图集合批、烟色玻璃及既有cap三批。脚本同work/scripts/build.py，parent-stove.glb/parent-manifest.json保留精确前版，四视图前后在同灯光/相机32sample CyclesCPU渲染。最终独立GLB回导零退化三角面/零无效法线，非继承旧验证。正式delivery冻结后再从该路径导入。

真实全场Blender BVH仅双墙41对历史拼接接触，无新增家具穿插；完整角色路径测试覆盖新实体。32实例/48primitive重新Cycles64sample Metal、OIDN烘焙，当前2026-10-29-stove-refined-shell-r42（raw r41），仅墙地面2K RGBM8，UV20832bytes/atlas16MiB预算保持，PNG2782504bytes/hash5c8f2fde5c860e184a521cb790c76120783e34882992508e604494c66e494213；全部其他厨房GLB/manifest保持。本轮仅importer增加独立revision、替换灶台及依赖光照，不通过实时材质替换掩盖模型问题。收尾发现并行角色/动画文件变化，明确列入回执externalConcurrentChanges，保留不覆盖；本轮300tests与截图对应已构建的灶台集成产物，不把之后的角色源码修改冒充已验收。

实际完整300tests/0fail，build/typecheck/lint/Prettier/workspace/patches通过；真实~/.dsh-test单间/总览/本地双角色与冰箱活动、光照加载及浏览器结果见回执browser。最终美术批准待用户，Stage3仅灶台此子项技术完成，壁钟等其余几何修正仍未完成。回执sync/receipts/kitchen-stove-2026-10-29-refined-r1.json；证据sync/evidence/2026-10-29-stove-refined/。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 冰箱本体与鲸鱼精修 · 2026-10-29（技术验收通过，详见末节）

用户新增四视角参考，明确只修冰箱本体与鲸鱼，绿植不得变化。新建kitchen/refrigerator/work/2026-10-29-refined-r1，保留精确parent GLB与manifest，重做规整圆角壳、门缝/把手、鲸鱼；原盆栽mesh/UV/法线/索引、纹理/材质、变换通过GLB组合逐字节保护，不重拓扑不重新烘焙盆栽材质。上/下门pivot变换、房间layout与其余素材保持。预算仍30ktri/8MiB；新修形需实际单件/全场渲染、独立回导、plant保护证明、光照重烘、插件test及~/.dsh-test验收回执。当前非完成。

## 当前采用：冰箱本体与鲸鱼精修、原绿植精确保护 · 2026-10-30

用户四张新参考归kitchen/refrigerator/work/2026-10-29-refined-r1/references，hash入清单；主厨房参考不替换。新采用2026-10-29-refined-r1，hash4b9c6615a097d5cddf93e8c60742621377153437cdb7fd4a9eb36a30b3669ce4，2696828bytes/26848tri/5mesh/5primitive/2material/6内嵌图。仍30ktri/8MiB，旧candy-r2及更早delivery保留。真实Blender重建平整圆角壳、上下门、银色弧形把手、规整便笺与鲸鱼磁贴、圆润鲸鱼主体/连续白肚皮/黑眼高光/粉色腮红/侧鳍/翘尾/喷水饰。非仅调粗糙度或假装修复贴图，未做微细肚皮刻线，便笺与照片是简化造型而非逐像素重现参考。

用户明确要求绿植不变，原参考图陶土盆栽9300tri单独保护：顶点/索引/UV/法线/材质参数/三张原嵌图逐字节复用，root/top/plant世界变换原样，花盆/叶片没有重拓扑、缩放、改色或移动。原图集保留供盆栽，新增本体鲸鱼共享的三张1024图；GLB原字节拼接脚本scripts/merge-plant.py重定位资源索引，plant-protection.json与测试使用真实parent证明内容相等。上下门原local-Y右铰链translation及extras原JSON精确保留；新门板为各pivot子mesh，仍闭合静态展示，无内胆/开门活动交付。源工程kitchen/refrigerator/work/2026-10-29-refined-r1/中文冰箱_本体鲸鱼精修.blend，隐藏可编辑零件保留。

原盆栽位置不动；新壳顶约低于盆底1mm，鲸鱼缩至90%并移到不碰原叶片的位置，独立最终GLB审阅证实plant与壳/门/鲸鱼零表面交。新白肚皮通过连续球面UV底色呈现，没有拼接半球接缝。原盆栽旧贴图里的光影与形体瑕疵按用户要求保留，不宣称去光照；新壳/鲸鱼色板不烘焙摄影棚明暗。同机位/同灯光32sampleCPU四视图前后已实际渲染，独立回导零退化三角面/零无效法线。

房间布局、冰箱根坐标、水槽/垃圾桶/吊灯位置、桌椅与角色站位/路线、相机/曝光和practical-v2灯位保持。全厨房真实BVH仅双墙41对历史共同面，无新增家具相交。完整32实例/48primitive按新几何重烘Cycles64sampleCPU/OIDN，采用2026-10-29-fridge-refined-shell-r46（raw r45，r43 Metal未完成候选不采用），仅墙地面2K RGBM8，UV20832bytes/atlas16MiB预算保持；atlas2790317bytes/hash285e64ebd46634725dd256d68d07ee3c913a471e1724192175399b559d004b53。其他厨房GLB及manifest字节保持；并行角色/动画变化仅列入回执、不覆盖或归因本轮。新增三张模型贴图有内存成本，未做FPS/VRAM基准，不宣称零开销。

实际完整316tests/0fail（含真实parent植物字节/材质/变换与铰链校验）、build/typecheck/lint/Prettier/workspace/patches通过，真实~/.dsh-test页面加载/双角色与冰箱预览/控制台结果见browser。早期启动曾有冰箱与光图请求超时，临时诊断证实Host已完成读取；随后重载成功，根因未确认，不宣称已修复传输。临时诊断已移除，未改超时阈值或DSH源码，最终构建重启后无回退告警。此为技术验收，最终美术认可待用户。Spec/Plan只将冰箱本子项完成，其他Stage3几何工作不冒充完成。revision和证据目录保留开始制作的2026-10-29，技术验收于2026-10-30完成。回执sync/receipts/kitchen-refrigerator-2026-10-29-refined-r1.json；证据sync/evidence/2026-10-29-fridge-refined/。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 用户撤回冰箱精修：恢复前一版 · 2026-10-30

用户明确不接受本体/鲸鱼精修外观，当前恢复refrigerator/2026-10-28-candy-r2（SHA256 250242b0f81f83e1efbf1ac82f686eb464dfcba89b0ed2ff13138bda49e6b6c4），同时恢复与旧冰箱几何相符的2026-10-29-stove-refined-shell-r42光照。只撤回本轮冰箱，不撤回已精修灶台、新挂件、当前布局、暖光参数或并行角色动画改动。

2026-10-29-refined-r1及r46光图为已撤回候选，前一节技术测试通过不代表用户美术认可；不能再次默认采用。精修Blender工程和不可变交付保留为历史，catalog当前采用与插件资源恢复旧版。仅依赖被撤回形体的新增测试从当前回归移出，原文归sync/evidence/2026-10-30-fridge-rollback/rejected-refinement-test.mjs.txt，原candy材质回归恢复。不得自动回滚其他改动。当前回执sync/receipts/kitchen-refrigerator-2026-10-30-rollback-v1.json。全程plugin-only，无commit/push/publish。
