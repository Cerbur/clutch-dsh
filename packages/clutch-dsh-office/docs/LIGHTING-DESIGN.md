# Kitchen · 轻量 Cycles 墙地面 + 实时柔光

## 性能覆盖 · 2026-10-31

后续全尺寸30FPS路径将静态PBR颜色以原分辨率HDR缓存；每帧仍绘制精确MSAA家具深度、
角色、烤箱玻璃与接收动态阴影的墙地面。灯位、材质、光强、阴影采样和原始素材不变。
缓存重建时仍使用原MSAA采样数，临时多重采样目标完成后释放，常驻仅保留解析颜色和背景掩码。
数值对照、显存估算和完整帧测量见[全尺寸30FPS验证](FULL-RESOLUTION-30FPS-2026-10-31.md)。

软阴影改为八个稳定、平衡的采样点，保持原半径、接收面深度修正、灯位和强度。
四个零强度 Spot 继续提供阴影贴图与坐标，但跳过不会贡献光照的原生 Spot BRDF 循环。
后续画质修复将画布调整为 DPR2／八百万像素预算，至少保持 CSS 分辨率，角色最多30FPS、
空房按需绘制保持。小道具512px，
大表面与角色1024px；文字气泡不降分辨率。阴影边缘和放大纹理精细度有明确取舍。

全尺寸检查发现垃圾桶斑纹来自实时阴影，并非图片纹理。接收深度校正对齐最近纹素中心，
并限制为不向接收面后方外推；静态投影 depth bias 为 -0.0004，角色专属投影仍为 -0.00015。
这会适度弱化掠射角下很薄的遮挡；保留阴影、光强、模型、材质及烘焙来源，未重新标记旧 bake。

正式传输使用独立 lossless WebP 派生GLB。生成器逐像素验证PNG解码结果，逐字节保留
几何/压缩几何流、材质与UV；构建校验来源和传输hash，运行时校验传输hash再匹配原bake
source，并照常验证每个primitive的几何签名。不是把改过几何/材质的文件重新标成旧来源。
因此当前r56光照仍对应同一物理场景，无需重烘；任何未来非无损素材变更仍须重新烘焙。
详见 [性能实施计划](plans/2026-10-31-performance.md)。

## 动态鲸鱼娘专属提亮 · 2026-10-31

用户保留当前厨房交付，只要求鲸鱼娘更明亮。角色原PBR shader在tone mapping之前增加
`totalDiffuse×.25 + diffuseColor.rgb×.22`，局限于`buildDeepSeek`加载后的私有角色材质。
原光照/阴影hook保留，镜面不放大；暗部补偿沿用贴图与顶点色，避免白色常量洗掉蓝发和眼睛。
这是动态人物的美术补偿，不是新增世界光、物理GI或bloom。静态33实例来源、材质、布局及
r56图集保持；人物不参与静态烘焙，因此无需重烘。本轮不合并场景GLB、不继续减面。

## 当前覆盖 · 2026-10-31 模型降面与窗光修复

当前工作区采用 `2026-10-31-meshopt-shell-r56`，完整33实例/49primitive中档几何实际参加
Cycles64sample CPU重烘（r55）及OIDN（r56）；不是复用历史图并修改hash。2K RGBM8、
20,832bytes UV、16MiB解码预算保持，最终PNG大小以manifest为准。source/hash和Three几何签名
来自构建同一runtime-models选择器；原始素材与旧交付不改。

`kitchen-warm-practicals-v3`仅修改窗光：发光蒙版深度.09–.105m、正向法线smoothstep，
|X|≤.425m、Y.135–.635m，linear[1,.78,.48]×.32；窗口AREA移到根局部[0,.372,.105]，
目标[0,.372,1.1]、8W、同色、.78×.46m。旧前置.27m/向下16W灯直接照亮木框和吊柜，
导致粉色亮边；新灯位与真实窗片一致。其他局部灯、主softbox、环境、曝光、机位和布局保持。

底板命名网格`圆角木框`保留实时PBR，避免薄倒角lightmap岛接缝；仍校验其来源/几何并参加
静态遮挡反弹。瓷砖与双墙继续接收烘焙；不会取消整间光照或放松失败回退。
烟机采用独立派生漆面材质，见[优化记录](MODEL-OPTIMIZATION.md)。以下旧revision均为历史。

当前bake采用 `2026-10-29-practical-shell-r38`（四处局部暖光，详见末节；更早revision为历史），运行时环境采用 `kitchen-candy-indirect-s1-v1`（见末节，覆盖旧constant世界+半球补偿）。用户要求保留墙角柔和光照，清除椅子/碗沿黑色碎线，减轻加载和渲染开销，并增加弱正面面光。旧 r6 全家具碎片光照UV方案保留历史，不再作为当前采用方案。

## 光照与材质

原Blender三个AREA、World节点linear .05/strength1、Neutral曝光0、相机及场景布局保持。Three相机[8,7,8.5]→[0,1.3,.5]、ORTHO8.1。原三AREA参数：Blender[5,-7,8]/950W/size6/linear[1,.86,.75]；[-4,-2,5]/250W/size5/[.78,.85,1]；[3,5,6]/250W/size4/[1,.89,.78]，target[0,0,1]。Three坐标(x,z,-y)，初始LTC功率P/(πA)。

新增Three正面柔光位置[5,4.5,7]、size5、80W等效输入、linear[1,.94,.86]，看向[0,1,0]。不新增阴影贴图，弱补光仅影响实时家具/角色及镜面，墙地面漫反射保持原Cycles结果。原三灯与其shadow proxy固定排序，第四rect不借用角色shadow map。

仅floor/left-wall/right-wall接收Cycles DIFFUSE+DIRECT+INDIRECT、关闭COLOR的2048²烘焙；全场家具仍参与遮挡与反弹。Metal64samples，光照UV间距.003、padding8px，再用Blender OIDN降噪。RGBM8原始数值，B=E/π；shader在nativeAO后只乘一次effective diffuseColor，保留specular/emissive。4texel分别解码再插值、无mipmap/预乘/Gamma。家具保留原PBR和UV0，取消碎片lightmap，解决新增黑缝；不声称重建了原始素材。

只有5208个墙地面三角角点创建私有nonindexed几何。`uv.scope=receivers`仅接收者有offset；仍验证全部25遮挡实例/40primitive的sourcehash、布局、几何签名。旧无scope的全UV交付仍兼容。源GLB、材质、UV0、布局、运动、CSS不改。

## 加载与GPU预算

生产构建把二进制替换为内容hash描述符，生成lib/asset-index.json。Host通过公开`ctx.connection.fetch.register`注册精确 `/api/clutch-dsh-office/assets` GET/HEAD；Connection负责owner鉴权，仅可读取生成索引中的固定包内路径，错误ID/hash/方法拒绝。响应private immutable缓存；不开放文件系统目录或新端口。

Client按需请求二进制、校验hash与长度、共用CPU字节Promise缓存；下载/完整GLB管线并发上限2、请求20s超时、离屏撤销消费者，失败移除缓存可重试。光照bundle首次使用才加载。独立preview仍支持inline素材，生产Client不包含GLB/Base64大段。Host与Client分开编译，避免connection类型扩展互相污染。

GLB解析后、GPU上传前，将私有ImageBitmap的最长边限制为1024并保持比例；共享Source/bitmap去重替换，保留颜色空间、UV、法线和PBR参数，失败保留原图，晚到资源释放。源工程/贴图不缩小；极端放大时运行时纹理细节减少。

空厨房按需重绘；有角色时最多30FPS，delta按实际绘制间隔推进。三张家具阴影图仅在场景资产变化时更新，排除角色，避免留下旧人影；角色专用key-shadow随绘制更新。家具仍投影到人物、人物投影到烘焙墙地面；动态角色对实时家具的阴影和自身阴影目前省略。这是明确的性能取舍。

每可见房间拥有自己的GPU图片、材质、几何、PMREM和阴影目标，离屏释放。性能回归同时验证空闲不循环RAF、动画上限、阴影更新、取消/超时/重试、真实source签名与预算。

| 项目             |             旧r6 |            当前 |
| ---------------- | ---------------: | --------------: |
| Client脚本       | 79,997,814 bytes | 2,011,763 bytes |
| 光照PNG          | 16,157,943 bytes | 2,682,891 bytes |
| 光照UV           |  4,302,456 bytes |    20,832 bytes |
| 光照RGBA显存预算 |            64MiB |           16MiB |

脚本减小不等于总下载量只剩2MB：18件源GLB仍约38.04MB，按需单独传输并缓存。RGBA+mip按每源唯一图片一次计算约355→179MiB，非实测VRAM。原始模型面数不变；尚无移动端性能认证。

## 素材交接与验证

主工程`kitchen/lighting/lookdev/2026-10-28-cycles-shell-r7/厨房_Cycles光照烘焙.blend`；r8为降噪合成辅助工程。脚本归组件scripts，派生新revision前更新路径/版本，禁止覆盖冻结deliveries。更改任何遮挡模型/材质/位置/灯光后重烘，`lighting:geometry`导出实际Three几何签名，`lighting:import`显式采用交付，再build/test并重启DSH Host以更新索引。

本轮实际~/.dsh-test验证总览、单间、双角色、冰箱行走、末间与离屏重建；226tests/typecheck/lint通过。测试曾被多个重复DSH开发页占满HTTP1连接槽，关闭重复页后正常；没有提取登录token或修改DSH源码。临时诊断移除，证据与回执`sync/receipts/kitchen-lighting-2026-10-28-cycles-shell-r8.json`，`sync/evidence/2026-10-28-lightweight-lighting/`。视觉最终认可待用户，无commit/push/publish。

## 糖果感阶段1 · 方向性间接受光

本轮只改变运行时环境，将constant linear.05与弱Hemisphere替换成低频室内反射球；原Blender World.05保留在冻结工程和r8 bake中。运行时参数与冻结工程明确分开，不宣称已把环境改动写回Cycles。三盏原AREA和80W正面柔光、曝光0、相机、全部GLB/UV0/材质/布局、墙地面bake保持。

linear底色[.085,.083,.079]，上方/木地面/宽前方/后墙四瓣，完整值见 `plans/2026-10-28-kitchen-candy-look.md` 和 `src/client/scene/lighting.ts`。球体BackSide、线性顶点色、MeshBasic、toneMapped=false，只用于一次128PMREM捕获；捕获后释放球体，房间释放PMREM。没有额外HDR下载、直射灯或阴影图，不重复加Hemisphere。环境为家具漫反射和镜面提供宽柔层次；baked墙地漫反射仍仅用bake，镜面随环境变化。

全局无空间遮挡环境可能抬亮柜内/底面，不能还原完整Cycles GI。一次初始化捕获几何由12面盒变为约2208面球；没有每帧捕获，但未测初始化时长。Client2,011,948bytes（+185），2K/16MiB、UV20832bytes、4张shadow map、模型1024贴图和按需调度保持。44项冻结hash与直接照明/曝光一致，228tests/typecheck/lint通过。

真实 `~/.dsh-test` 总览/单间/双角色/冰箱行走/末间/离屏重建已查看；冷重载后零warn/error。固定截图取样冰箱暗侧约+17%、鲸鱼+7%、木腿+10%，保护墙地不到1%，仅作截图诊断。第一步技术验证通过，待用户视觉审阅；材质与轮廓留待阶段2/3。Spec/Plan已双向同步；回执 `sync/receipts/kitchen-look-2026-10-28-candy-s1-v1.json`。无源资产变化，无需重烘本轮冻结bake。

## 阶段2A材质依赖重烘

refrigerator/2026-10-28-candy-r2采用后，以同三AREA/World.05、相机和布局重新64sample Metal烘焙2K墙地面（r11），OIDN为r12。运行时s1环境与第四正面柔光保持。只有源材质变更与其反弹依赖，不能复用旧bake或仅换hash。新atlas PNG约2.65MB（精确值以manifest为准）、16MiB、UV20832bytes；18源/71primitive验证。首个r1候选误覆盖金属，未采纳，r9/r10为其历史bake。最终样板逐像素保护检查和实际profile证据见糖果感Plan与素材库回执kitchen-look-2026-10-28-candy-s2a-r2.json。230tests通过，视觉批准待用户。

## 加长灶台L形接入依赖重烘

用户新灶台r6和相关布局变化后，真实重烘r15/OIDN r16；18实例/57primitive全部来源与最终布局验证（新stove替代旧16primitive为2primitive），只有三件shell接收光照。相机、s1环境和四盏直射面光/曝光保持。原短版r13/r14不是最终光照；不只改source hash套旧bake。2K/16MiB/UV20832bytes/128PMREM预算不变，资源生命周期回归通过。当前精确采用见manifest和kitchen-stove-2026-10-28-r6回执。

## 当前全场材质与新组件依赖 · r18

本轮range-hood/wall-cabinet新原件、window和全场材质阶段2B已接入；按最终19实例/34primitive真实Cycles64sample Metal重烘r17，再OIDN为r18。三AREA、World.05、runtime s1环境/第四前面光、相机/曝光均保持。新窗为实墙前不透明贴墙组件，未给窗新增发光、光源或开墙洞；原参考窗光不是本轮新增能力。全部source hash/布局/原始Three几何签名严格匹配；三接收者UV20832bytes、2K RGBM8/16MiB与1024模型贴图预算不变。

全场材质来源及实际保护见厨房糖果感Spec/Plan和KITCHEN-CANDY-S2B-VERIFICATION；原18件/71或57primitive统计为历史。当前19件源GLB42,809,224bytes(40.83MiB)，Client2,004,019bytes，PNG及hash以manifest为准。更多Physical材质会增加shader工作，不因draw次数减少便宣称FPS提升；未做加载耗时/FPS/实测VRAM基准。源工程kitchen/lighting/lookdev/2026-10-28-kitchen-candy-shell-r17/厨房_Cycles光照烘焙.blend，r18为降噪辅助工程。

## W01–W05挂件依赖重烘 · r20

新增五种挂件及两墙复用盆栽后，按25实例/40primitive真实重烘r19（Cycles64samples Metal），OIDN为r20。相机、三AREA、World.05、runtime第四前面光和s1环境保持，既有19源GLB/manifest完全不改；不是把新hash套在旧图上。2K RGBM8、UV20832bytes/16MiB显存预算仍保持，atlas2680850bytes；24件源GLB51580792bytes(49.19MiB)、Client2013877bytes。新挂件共6个静态绘制primitive，绿植不重复解析或创建贴图；未测FPS/实测VRAM/加载耗时。主工程kitchen/lighting/lookdev/2026-10-28-hangings-shell-r19/厨房_Cycles光照烘焙.blend；最终25实例核验工程lookdev/2026-10-28-wall-hangings-layout/厨房_场景验证.blend。

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

## 当前采用：冰箱本体与鲸鱼精修、原绿植精确保护 · 2026-10-30

用户四张新参考归kitchen/refrigerator/work/2026-10-29-refined-r1/references，hash入清单；主厨房参考不替换。新采用2026-10-29-refined-r1，hash4b9c6615a097d5cddf93e8c60742621377153437cdb7fd4a9eb36a30b3669ce4，2696828bytes/26848tri/5mesh/5primitive/2material/6内嵌图。仍30ktri/8MiB，旧candy-r2及更早delivery保留。真实Blender重建平整圆角壳、上下门、银色弧形把手、规整便笺与鲸鱼磁贴、圆润鲸鱼主体/连续白肚皮/黑眼高光/粉色腮红/侧鳍/翘尾/喷水饰。非仅调粗糙度或假装修复贴图，未做微细肚皮刻线，便笺与照片是简化造型而非逐像素重现参考。

用户明确要求绿植不变，原参考图陶土盆栽9300tri单独保护：顶点/索引/UV/法线/材质参数/三张原嵌图逐字节复用，root/top/plant世界变换原样，花盆/叶片没有重拓扑、缩放、改色或移动。原图集保留供盆栽，新增本体鲸鱼共享的三张1024图；GLB原字节拼接脚本scripts/merge-plant.py重定位资源索引，plant-protection.json与测试使用真实parent证明内容相等。上下门原local-Y右铰链translation及extras原JSON精确保留；新门板为各pivot子mesh，仍闭合静态展示，无内胆/开门活动交付。源工程kitchen/refrigerator/work/2026-10-29-refined-r1/中文冰箱_本体鲸鱼精修.blend，隐藏可编辑零件保留。

原盆栽位置不动；新壳顶约低于盆底1mm，鲸鱼缩至90%并移到不碰原叶片的位置，独立最终GLB审阅证实plant与壳/门/鲸鱼零表面交。新白肚皮通过连续球面UV底色呈现，没有拼接半球接缝。原盆栽旧贴图里的光影与形体瑕疵按用户要求保留，不宣称去光照；新壳/鲸鱼色板不烘焙摄影棚明暗。同机位/同灯光32sampleCPU四视图前后已实际渲染，独立回导零退化三角面/零无效法线。

房间布局、冰箱根坐标、水槽/垃圾桶/吊灯位置、桌椅与角色站位/路线、相机/曝光和practical-v2灯位保持。全厨房真实BVH仅双墙41对历史共同面，无新增家具相交。完整32实例/48primitive按新几何重烘Cycles64sampleCPU/OIDN，采用2026-10-29-fridge-refined-shell-r46（raw r45，r43 Metal未完成候选不采用），仅墙地面2K RGBM8，UV20832bytes/atlas16MiB预算保持；atlas2790317bytes/hash285e64ebd46634725dd256d68d07ee3c913a471e1724192175399b559d004b53。其他厨房GLB及manifest字节保持；并行角色/动画变化仅列入回执、不覆盖或归因本轮。新增三张模型贴图有内存成本，未做FPS/VRAM基准，不宣称零开销。

实际完整316tests/0fail（含真实parent植物字节/材质/变换与铰链校验）、build/typecheck/lint/Prettier/workspace/patches通过，真实~/.dsh-test页面加载/双角色与冰箱预览/控制台结果见browser。早期启动曾有冰箱与光图请求超时，临时诊断证实Host已完成读取；随后重载成功，根因未确认，不宣称已修复传输。临时诊断已移除，未改超时阈值或DSH源码，最终构建重启后无回退告警。此为技术验收，最终美术认可待用户。Spec/Plan只将冰箱本子项完成，其他Stage3几何工作不冒充完成。revision和证据目录保留开始制作的2026-10-29，技术验收于2026-10-30完成。回执sync/receipts/kitchen-refrigerator-2026-10-29-refined-r1.json；证据sync/evidence/2026-10-29-fridge-refined/。plugin-only，无DSH源码/生产profile修改，无commit/push/publish。

## 用户撤回冰箱精修：恢复前一版 · 2026-10-30

用户明确不接受本体/鲸鱼精修外观，当前恢复refrigerator/2026-10-28-candy-r2（SHA256 250242b0f81f83e1efbf1ac82f686eb464dfcba89b0ed2ff13138bda49e6b6c4），同时恢复与旧冰箱几何相符的2026-10-29-stove-refined-shell-r42光照。只撤回本轮冰箱，不撤回已精修灶台、新挂件、当前布局、暖光参数或并行角色动画改动。

2026-10-29-refined-r1及r46光图为已撤回候选，前一节技术测试通过不代表用户美术认可；不能再次默认采用。精修Blender工程和不可变交付保留为历史，catalog当前采用与插件资源恢复旧版。仅依赖被撤回形体的新增测试从当前回归移出，原文归sync/evidence/2026-10-30-fridge-rollback/rejected-refinement-test.mjs.txt，原candy材质回归恢复。不得自动回滚其他改动。当前回执sync/receipts/kitchen-refrigerator-2026-10-30-rollback-v1.json。全程plugin-only，无commit/push/publish。

## 蓝白条纹脚垫 · 2026-10-31（技术验收通过）

独立采用kitchen/floor-mat/2026-10-29-r1，原GLB 1427356bytes/hashc4c982fcbe133b70cb3e534bc5a2a66186f0ea3f1b06695289af9b37f035059f，1900tri/1mesh/1primitive/1material/两张1024嵌图。6000tri/4MiB独立上限，冰箱30k/8MiB预算不变。原织物roughness约.70、metallic0、normal.50、coat0与原几何/贴图保持；不替换鲸鱼地毯。最终Three位置[1.4,.0255,-.37]、yaw0、scale1，垫最高面Y.0435m，底面距地板约.5mm；既有家具、站位/路线、相机、暖光及全部既有模型文件不动。

薄垫为可走地面，不添加导航阻挡。kitchenActorGroundY按垫的半宽.675/半深.385加保守鞋底触及范围.35m提供最高面+1mm支撑；现有roaming根高.054m不降低，旧低脚底路径接近垫沿时整体抬高，程序白模另保留12mm起伏余量。这是防穿插支撑，不是逐足IK或精确踩踏形变，垫边有小幅保守提前抬高。真实骨骼角色冰箱往返/停留/转身/中断与四人通道网格回归均通过；当前共享会话UI不恢复历史的单间/找食材按钮，浏览器验证双人/四人游走，旧冰箱动作通过Node实际模型检查。

Blender全场BVH只有双墙41对历史拼角接触，无新增家具穿插。33实例/49primitive按现有r42几何基线和practical-v2灯位重新Cycles64sample CPU烘焙r47、OIDN为2026-10-31-floor-mat-shell-r48；仅三墙地面receiver、2K RGBM8、UV20832bytes与16MiB atlas预算保持。运行时家具仍PBR，新垫增加1900tri/一绘制批/两图及1.36MiB源数据，不宣称无性能成本。

实际build/TypeScript/lint/格式通过；全套330项首跑329通过，唯一失败为旧生产GLB数量28的断言；新增独立脚垫后门禁改为29并断言脚垫仅注册一次，该项单独重跑1pass/0fail。修改仅测试期待，不改产品或放宽JS/贴图预算，未重复四分钟全套。补充接触/runtime14项通过，初轮组件/角色几何92项通过。完整日志保留，不能将首跑描述为330项一次全绿。

真实~/.dsh-test内置浏览器查看新垫/暖光、双击Tag预览四人/双人、离开Office时canvas0、返回重建canvas1、0alert，最终刷新后无warn/error。最终留真实活跃会话页面，空闲0人仍显示完整厨房。回执sync/receipts/kitchen-floor-mat-2026-10-29-r1.json，证据sync/evidence/2026-10-31-floor-mat/。组件原delivery不改，ready指交付阶段，current采用以catalog和本回执为准；最终美术审阅待用户。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。
