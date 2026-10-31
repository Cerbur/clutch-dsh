# W01–W05 厨房挂件接入

## W01–W05挂件接入 · 技术验收通过 / 待视觉审阅

2026-10-28新增五件独立r1：whale-mitt（鲸鱼隔热垫）、wall-clock（木质壁钟）、board-cloth（砧板与抹布）、wall-plant（壁挂盆）、wall-calendar（鲸鱼挂历）。原始GLB逐字节存各组件source，可编辑工程/脚本/纹理/渲染在各自work/2026-10-28-r1，不放插件。交付全为1mesh/1material/3张1024内嵌图，独立命名与预算；不借用冰箱合同，冰箱30k/8MiB和门轴约束保持。挂历与木钟为静态装饰，不显示真实日期/时间。

最终摆放（Three米/Y-up）：隔热垫[-2.307,2.14,2.83]、壁钟[-2.307,2.94,2.62]和左挂盆[-2.302,2.18,2.49]均yaw90°上左前墙；挂历[.43,1.94,-1.807]在水槽右；砧板抹布[2.26,2.13,-1.807]及右挂盆[2.26,1.65,-1.802]在冰箱右侧空墙，yaw0。砧板原放备餐墙被既有物件投影遮住，已明确改到右空墙完整可见，不采用历史试摆坐标。所有新件避开完整灶台/烟机热区，不把随意转盆背穿墙当变化；两盆随两面墙方向差90°、保持竖直，用同一GLB一次parse共享geometry/material/textures并释放一次。

真实Blender全场最终BVH只有两墙拼角41对既有共同表面，其余非地板家具无相交；原桌椅/角色站位/通道/既有19源GLB及manifest38文件逐字节保持，相机/四面光/曝光/s1环境保持。完整活动对/转身/冰箱往返/中断/减少动态路径测试包括全部新挂件和两盆实际变换。新件为本轮尺寸/保UV减面/分材质表面处理，原图案保留；木布叶陶盆按stage2b分别处理，不统一塑料化。原重建棱角、色图烘焙光影/钟盘三角明暗仍在，阶段3未开始。

25实例/40primitive真实Cycles64sample Metal新烘焙r19，OIDN为r20；2K RGBM8、UV20832bytes、RGBA16MiB保持，PNG2680850bytes。24件源GLB共51580792bytes(49.19MiB)，Client2013877bytes，新增挂件源8771568bytes，复用盆只新增一个source和两个绘制实例。1024运行时图、PMREM128、空闲按需/角色最多30FPS、离屏释放保持；未测FPS、加载时延或实测VRAM，不宣称性能零成本。

重复实例由kitchenAssetName和KITCHEN_INSTANCE_GROUPS统一导出/导入/运行时映射。生产bundle入口先解析inline base64/JSON，再验证完整25来源ID/实例集合和assetId；缺右盆、重复/额外ID、错误别名不能让shell提前提交，失败走原fallback。原有部分内存fixture是单元验证，生产守卫不提供可关闭字段。

实际检查：build、typecheck、lint、Prettier、check:workspace、check:patches、git diff --check通过；node --test --test-concurrency=1 test/*.test.mjs共256pass/0fail，含五件独立导入、热区留白、绿植parse一次/释放一次、base64真实入口和失败清理。已有!!js YAML warning保留。真实~/.dsh-test http://127.0.0.1:3088/已安装并重启：5空闲厨房、单间五件全可见、双角色及气泡、冰箱到达与回程、末间与首间重建通过；最终1canvas/0alert，13:26UTC后warn/error0；重启过程旧连接警告单列历史。OS减少动态未手动切换，自动路径/生命周期通过。

回执sync/receipts/kitchen-wall-hangings-2026-10-28-r1.json，证据sync/evidence/2026-10-28-wall-hangings；最终场景工程kitchen/lighting/lookdev/2026-10-28-wall-hangings-layout/厨房_场景验证.blend。catalog、组件HANDOFF、双语README、Spec/Plan和光照规范已更新，技术接受与用户视觉认可分别记录。全程plugin-only，不改DSH源码/生产profile，不commit/push/publish；服务保留供查看。
