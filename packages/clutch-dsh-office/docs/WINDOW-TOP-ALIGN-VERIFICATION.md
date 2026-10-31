# 窗顶与蓝柜对齐、置物架左移验收

## 当前采用：窗顶对齐蓝柜、右侧低架左移 · 2026-10-28

按用户最后两次补充：窗X=-1.78贴近左墙内侧，Y=1.8800518369674686、Z=-1.808；窗顶与蓝色吊柜顶实际同为2.6236367m，左侧窗框距墙表面约9.92mm。双层置物架[-.10,.15,-1.813]，在右侧降低24cm的基础上再左移20cm；挂历[-1.35,2.72,-1.807]上移让出窗框。只改这三件实例位置，所有模型GLB/manifest/材质/UV/尺寸、其他布局、角色站位路径、相机、四灯/曝光及s1环境保持。

全场实际BVH只有双墙拼角41对既有接触，无新增家具穿插；固定机位完整预览已查看。完整25实例/40primitive真实Cycles64sample Metal重烘r29，OIDN为2026-10-28-window-top-shell-r30；源hash/Three几何签名/布局严格校验，2K RGBM8、UV20832bytes与16MiB预算保持。r23至r28是用户连续调整期间的中间试摆，保留历史、不代表最终采用；外退15cm候选未采用。

最终build/lint、布局Prettier、git diff --check通过；最新资源/光照/几何导出针对回归96pass/0fail。左右互换基线全套256pass/0fail在前一轮已实际执行，本次微调未重复全套，避免把旧结果称为最新全量测试。真实 ~/.dsh-test http://127.0.0.1:3088/ 已重启并查看总览、单间及重建，最终1canvas/0alert，Office冷加载后warn/error0。

回执sync/receipts/kitchen-layout-2026-10-28-window-top-align-v1.json；证据sync/evidence/2026-10-28-window-top-align/；完整可编辑验证工程kitchen/lighting/lookdev/2026-10-28-window-top-align/厨房_场景验证.blend。catalog、组件HANDOFF、双语README、Spec/Plan和光照文档双向同步。accepted为技术验收，最终用户视觉认可待审。阶段3其余任务仍待做。全程plugin-only，无DSH源码/生产profile修改，无commit/push/publish。
