# 蓝白条纹脚垫接入验收

## 蓝白条纹脚垫 · 2026-10-31（技术验收通过）

独立采用kitchen/floor-mat/2026-10-29-r1，原GLB 1427356bytes/hashc4c982fcbe133b70cb3e534bc5a2a66186f0ea3f1b06695289af9b37f035059f，1900tri/1mesh/1primitive/1material/两张1024嵌图。6000tri/4MiB独立上限，冰箱30k/8MiB预算不变。原织物roughness约.70、metallic0、normal.50、coat0与原几何/贴图保持；不替换鲸鱼地毯。最终Three位置[1.4,.0255,-.37]、yaw0、scale1，垫最高面Y.0435m，底面距地板约.5mm；既有家具、站位/路线、相机、暖光及全部既有模型文件不动。

薄垫为可走地面，不添加导航阻挡。kitchenActorGroundY按垫的半宽.675/半深.385加保守鞋底触及范围.35m提供最高面+1mm支撑；现有roaming根高.054m不降低，旧低脚底路径接近垫沿时整体抬高，程序白模另保留12mm起伏余量。这是防穿插支撑，不是逐足IK或精确踩踏形变，垫边有小幅保守提前抬高。真实骨骼角色冰箱往返/停留/转身/中断与四人通道网格回归均通过；当前共享会话UI不恢复历史的单间/找食材按钮，浏览器验证双人/四人游走，旧冰箱动作通过Node实际模型检查。

Blender全场BVH只有双墙41对历史拼角接触，无新增家具穿插。33实例/49primitive按现有r42几何基线和practical-v2灯位重新Cycles64sample CPU烘焙r47、OIDN为2026-10-31-floor-mat-shell-r48；仅三墙地面receiver、2K RGBM8、UV20832bytes与16MiB atlas预算保持。运行时家具仍PBR，新垫增加1900tri/一绘制批/两图及1.36MiB源数据，不宣称无性能成本。

实际build/TypeScript/lint/格式通过；全套330项首跑329通过，唯一失败为旧生产GLB数量28的断言；新增独立脚垫后门禁改为29并断言脚垫仅注册一次，该项单独重跑1pass/0fail。修改仅测试期待，不改产品或放宽JS/贴图预算，未重复四分钟全套。补充接触/runtime14项通过，初轮组件/角色几何92项通过。完整日志保留，不能将首跑描述为330项一次全绿。

真实~/.dsh-test内置浏览器查看新垫/暖光、双击Tag预览四人/双人、离开Office时canvas0、返回重建canvas1、0alert，最终刷新后无warn/error。最终留真实活跃会话页面，空闲0人仍显示完整厨房。回执sync/receipts/kitchen-floor-mat-2026-10-29-r1.json，证据sync/evidence/2026-10-31-floor-mat/。组件原delivery不改，ready指交付阶段，current采用以catalog和本回执为准；最终美术审阅待用户。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。
