# 厨房挂件拿取高度与窗下绿植验收

## 当前采用：拿取高度与窗下三盆 · 2026-10-29

隔热垫[-2.307,1.43,1.75]移至左墙橙色挂杆右边，挂点约1.811m；砧板抹布[-2.307,1.12,-.70]、yaw90°、scale1.2，置蓝柜下备餐台上方，顶1.72m、底1.12m。备餐区允许可拿取挂件，实际火灶/烟机热柱仍留空，覆盖早期整条柜台禁止装饰的粗约束。挂历[2.26,1.08,-1.807]移至冰箱右侧墙、原盆栽下方，顶1.56m、垂直间隙90mm。

窗下三个wall-plant实例X[-2.12,-1.78,-1.44]、Y1.4/Z-1.802，scale.85，间距34cm，顶约1.7575m、距窗底约12.25cm。保留原左右两盆，五盆同一GLB一次parse，共享geometry/material/textures且只释放一次，显式重置每实例旋转/缩放。只增加实例，没有复制源资源或修改现有模型/材质。窗顶对齐蓝柜、右架X-.30、桌椅/活动站位/相机/四灯/曝光及s1环境保持。

实际Blender全场BVH只有双墙拼角41对既有接触，无新增家具穿插；固定机位预览及可编辑工程在kitchen/lighting/lookdev/2026-10-29-kitchen-reach/。完整28实例/43primitive真实Cycles64sample Metal重烘r33，OIDN为2026-10-29-reach-shell-r34；2K RGBM8、atlas2695451bytes/hash88d7ab438cfa6cc1713eadf9d8c3d089f7ac777dd65eca257f0ea8a6eea77846，UV20832bytes、16MiB预算保持。新三盆增加3绘制实例/35697三角形，未做FPS/VRAM/加载时延基准。

最终build/typecheck/lint、源代码与测试Prettier通过，全套node --test --test-concurrency=1 test/*.test.mjs为256pass/0fail，包括五盆身份完整性、parse/释放一次和实际角色路径。真实 ~/.dsh-test 页面结果见回执browser字段与截图：总览、单间、本地双角色与冰箱行走，最终单canvas/无alert/Office光照无fallback。初次浏览器曾有光图fetch超时，图片直接打开后重载成功；根因未确认，不宣称代码修复，不改传输/超时/源代码边界。最终重启后检查独立记录；其他插件连接重试日志不冒充Office错误，也不宣称全页面历史零告警。

回执sync/receipts/kitchen-layout-2026-10-29-reach-v1.json，证据sync/evidence/2026-10-29-kitchen-reach/。当前调整为静态视觉拿取高度，不包含骨骼拿取或人体工学认证；阶段3壁钟法线等仍待后续，最终美术批准待用户。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。测试服务http://127.0.0.1:3088/保留供查看。
