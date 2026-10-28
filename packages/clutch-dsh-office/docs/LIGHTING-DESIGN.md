# Kitchen · 轻量 Cycles 墙地面 + 实时柔光

当前bake采用 `2026-10-28-hangings-shell-r20`（材质样板依赖重烘，覆盖r8），运行时环境采用 `kitchen-candy-indirect-s1-v1`（见末节，覆盖旧constant世界+半球补偿）。用户要求保留墙角柔和光照，清除椅子/碗沿黑色碎线，减轻加载和渲染开销，并增加弱正面面光。旧 r6 全家具碎片光照UV方案保留历史，不再作为当前采用方案。

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
